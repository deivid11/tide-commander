/**
 * Streaming-exec guard — classifies a Bash command an agent is about to run
 * DIRECTLY (through its harness's shell tool) and decides whether it should
 * have gone through Tide Commander's Streaming Exec API (`POST /api/exec`)
 * instead, so the user sees live output in the terminal card.
 *
 * The prompt already says so ("Streaming Execution (MANDATORY)"), but a
 * prompt is advice: agents routinely run polling loops, builds, tests and
 * downloads straight through Bash — the user then stares at a spinner for
 * minutes with no output. This module is the mechanical half: a Claude
 * `PreToolUse` hook (see exec-guard-hook.mjs) asks `POST /api/exec/guard`,
 * which runs `classifyDirectBashCommand` and, when it trips, DENIES the tool
 * call with a reason that contains the ready-to-run curl for the same command
 * — the agent simply re-issues it through the API.
 *
 * Design rules:
 *  - Fail OPEN. Anything not clearly long-running is allowed; a false positive
 *    costs the agent one round-trip, a false negative costs the user visibility
 *    — but blocking quick inspection commands would be far more annoying.
 *  - Never block the API itself (a curl to /api/exec or any Commander route).
 *  - Never block detached/background execution (`&`, nohup, setsid,
 *    run_in_background) — the exec API is synchronous and cannot host those.
 *  - Pure: no IO, no globals — unit-testable and reusable by every provider.
 */

export interface ExecGuardVerdict {
  /** True when the command should be re-issued through POST /api/exec. */
  block: boolean;
  /** Human-readable reasons that tripped (empty when allowed). */
  signals: string[];
}

export interface ExecGuardInput {
  command: string;
  /** Claude's Bash `run_in_background` flag — detached runs are never blocked. */
  runInBackground?: boolean;
}

/** `sleep N` at or above this many seconds trips on its own. */
const SLEEP_BLOCK_SECONDS = 2;
/** `timeout N …` at or above this many seconds trips on its own. */
const TIMEOUT_BLOCK_SECONDS = 5;

// ── Pattern tables ───────────────────────────────────────────────────────────
// Each entry: [regex over the whole command, signal text]. Anchored at a
// COMMAND POSITION (start / after `;`, `&&`, `||`, `|`, `(`, `$(`, backtick,
// or the inner command of `bash -c "…"`), optionally behind wrapper prefixes
// (`VAR=x`, `sudo`, `env`, `nice`, `time`, `command`, `stdbuf`), so a word
// inside an argument (e.g. `rg "npm run build" src/`, `echo "make sure"`)
// does not trip.
const POS = String.raw`(?:^|[;&|(\n]\s*|\$\(\s*|\`\s*|\b(?:ba|z|da)?sh\s+(?:-[a-zA-Z]+\s+)*-c\s+["'])`;
const PREFIX = String.raw`(?:(?:\w+=(?:"[^"]*"|'[^']*'|\S*)\s+)|sudo\s+(?:-\S+\s+)*|env\s+(?:-\S+\s+)*|nice\s+(?:-n\s*-?\d+\s+)?|time\s+|command\s+|stdbuf\s+-\S+\s+|caffeinate\s+(?:-\S+\s+)*|timeout\s+(?:-\S+\s+)*\d+(?:\.\d+)?[smhd]?\s+)*`;
// Tools are matched by NAME, optionally behind a directory path
// (`/x/llama.cpp/build/bin/llama-gguf`, `./gradlew`, `node_modules/.bin/tsc`).
const PATH = String.raw`(?:\S*\/)?`;
const cmd = (body: string): RegExp => new RegExp(`${POS}\\s*${PREFIX}${PATH}(?:${body})(?=\\s|$|[;&|)])`, 'i');

const LONG_TOOL_PATTERNS: Array<[RegExp, string]> = [
  // JS toolchain
  [cmd(String.raw`npm\s+(?:run(?:-script)?|test|t|ci|i|install|start|build|publish|exec|x)`), 'npm task/install'],
  [cmd(String.raw`(?:pnpm|yarn)\s+(?!pkg\b|--version\b|-v\b|config\b|why\b|list\b|ls\b|info\b|view\b)\S+`), 'pnpm/yarn task'],
  [cmd(String.raw`bun\s+(?:run|test|install|i|x|build|dev|start)`), 'bun task'],
  [cmd(String.raw`npx\s+(?!--version\b|-v\b)\S+`), 'npx'],
  [cmd(String.raw`(?:tsx|ts-node)\s+(?!--version\b|-v\b|-e\b|--eval\b)\S+`), 'script run (tsx/ts-node)'],
  [cmd(String.raw`node\s+(?:--\S+\s+)*(?!-e\b|--eval\b|-p\b|--print\b|-v\b|--version\b|-c\b|--check\b)\S+\.(?:[cm]?js|ts)`), 'script run (node file)'],
  [cmd(String.raw`deno\s+(?:run|test|task|compile|install)`), 'deno task'],
  [cmd(String.raw`(?:tsc|vite|webpack|esbuild|rollup|swc|next|astro|nuxt|ng|expo|eas|storybook|turbo|nx|lerna)`), 'build tool'],
  [cmd(String.raw`(?:vitest|jest|mocha|playwright|cypress|karma|ava|tap)`), 'test runner'],
  [cmd(String.raw`(?:eslint|prettier|biome|stylelint)(?=\s+(?!--version\b|-v\b))`), 'linter/formatter run'],
  // Python
  [cmd(String.raw`(?:python3?|py)\s+(?!(?:-\S+\s+)*-c\b)(?:-[a-zA-Z]+\s+)*(?:-m\s+(?:pytest|unittest|pip|http\.server|uvicorn|gunicorn|flask|django|torch|vllm|mkdocs|sphinx|build|twine|nuitka|pyinstaller)|\S+\.py\b)`), 'python script/module run'],
  [cmd(String.raw`(?:pytest|nose2?|tox|nox|uvicorn|gunicorn|flask\s+run|streamlit|jupyter|mkdocs|sphinx-build|pyinstaller|nuitka)`), 'python tool'],
  [cmd(String.raw`(?:pip3?|uv|poetry|pipx|conda|mamba)\s+(?:pip\s+)?(?:install|sync|run|add|update|upgrade|create|env|lock|build|download)`), 'python package manager'],
  // Compiled toolchains
  [cmd(String.raw`(?:make|cmake|ninja|meson|bazel|buck2?|scons|gradle|gradlew|\.\/gradlew|mvn|mvnw|\.\/mvnw|ant|sbt|lein|mix|rebar3|dotnet|msbuild|xcodebuild|swift\s+(?:build|test|run)|zig\s+(?:build|test)|nim\s+c)`), 'build system'],
  [cmd(String.raw`cargo\s+(?:build|test|run|install|clippy|bench|doc|check|publish|update)`), 'cargo'],
  [cmd(String.raw`go\s+(?:build|test|run|install|generate|mod\s+(?:download|tidy)|get|vet)`), 'go toolchain'],
  [cmd(String.raw`(?:gcc|g\+\+|clang(?:\+\+)?|rustc|javac|kotlinc|ghc|nvcc)(?=\s)`), 'compiler'],
  // Package managers / system
  [cmd(String.raw`(?:apt(?:-get)?|dnf|yum|zypper|pacman|apk|brew|snap|flatpak|port|nix(?:-env)?|choco|winget|scoop)\s+(?:-\S+\s+)*(?:install|update|upgrade|remove|purge|dist-upgrade|add|del|-S\w*|reinstall|build)`), 'system package manager'],
  [cmd(String.raw`(?:gem|composer|cpan|cpanm|luarocks|opam|stack|cabal|nuget|helm)\s+(?:install|update|require|build|upgrade)`), 'package manager'],
  // Containers / services / orchestration
  [cmd(String.raw`docker\s+(?:build|buildx|run|compose|pull|push|exec|create|save|load|image\s+build|system\s+prune)`), 'docker'],
  [cmd(String.raw`(?:docker-compose|podman|podman-compose|nerdctl|buildah|kind|minikube|k3d)`), 'container tool'],
  [cmd(String.raw`kubectl\s+(?:apply|rollout|exec|logs\s+(?:-f|--follow)|port-forward|wait|delete|drain|cp)`), 'kubectl'],
  [cmd(String.raw`(?:pm2)\s+(?:start|restart|reload|stop|delete|logs|flush|resurrect|monit)`), 'pm2'],
  [cmd(String.raw`(?:systemctl|service)\s+(?:--user\s+)?(?:start|restart|reload|stop)`), 'service control'],
  [cmd(String.raw`(?:terraform|tofu|pulumi|ansible(?:-playbook)?|vagrant|packer|serverless|sls|cdk|sam|amplify)`), 'infra tool'],
  // Network-heavy
  [cmd(String.raw`git\s+(?:-C\s+\S+\s+)?(?:clone|pull|push|fetch|lfs\s+(?:pull|fetch|push)|submodule\s+update|gc|fsck|bisect\s+run)`), 'git network/heavy op'],
  [cmd(String.raw`(?:wget|aria2c|axel|rsync|scp|sftp|lftp|rclone|yt-dlp|youtube-dl|gallery-dl|megadl|gdown|s3cmd|gsutil|az\s+storage|aws\s+s3|gcloud\s+storage)`), 'file transfer'],
  [cmd(String.raw`(?:huggingface-cli|hf)\s+(?:download|upload)`), 'model download'],
  [cmd(String.raw`gh\s+(?:run\s+watch|repo\s+clone|release\s+(?:upload|download)|pr\s+checks\s+--watch)`), 'gh long op'],
  [cmd(String.raw`(?:claude\s+(?:-\S+\s+)*(?:-p|--print)|codex\s+exec|opencode\s+run|grok\s+(?:-\S+\s+)*-p|pi\s+(?:-\S+\s+)*(?:-p|--prompt))`), 'nested agent CLI'],
  [cmd(String.raw`ollama\s+(?:run|pull|push|create|serve)`), 'ollama'],
  // Media / ML / CAD / long-running binaries
  [cmd(String.raw`(?:ffmpeg|handbrakecli|sox|lame|x264|x265|whisper(?:-cpp|\.cpp)?|piper|tts|espeak-ng\s+-f)`), 'media processing'],
  [cmd(String.raw`(?:llama-[a-z0-9-]+|llama\.cpp|koboldcpp|text-generation-launcher|vllm|sglang|lmstudio|comfyui|invokeai|stable-diffusion|sd\.cpp)`), 'LLM/model binary'],
  [cmd(String.raw`(?:blender|freecadcmd|freecad|openscad|prusa-slicer|orcaslicer|cura|kicad-cli|inkscape\s+--export|gs(?=\s)|libreoffice|soffice|pandoc\s.*\.pdf)`), 'CAD/office/render binary'],
  // Dev servers / follow modes / watchers
  [cmd(String.raw`(?:serve|http-server|live-server|browser-sync|php\s+-S|rails\s+s(?:erver)?|caddy|nginx\s+-g)`), 'dev server'],
  [cmd(String.raw`(?:tail|journalctl|less)\s+(?:-\S*\s+)*(?:-[a-zA-Z]*[fF][a-zA-Z]*|--follow)`), 'log follow'],
  [cmd(String.raw`(?:watch|entr|watchexec|nodemon|chokidar|inotifywait|fswatch)`), 'watcher'],
  // Archives / dumps / disk scans
  [cmd(String.raw`(?:pg_dump|pg_restore|mysqldump|mongodump|mongorestore|sqlite3\s+\S+\s+\.dump)`), 'database dump/restore'],
  [cmd(String.raw`(?:zip(?=\s+-r)|unzip(?=\s+(?!-l\b))|tar(?=\s+(?:-?[a-zA-Z]*[cx]|--(?:create|extract)))|7z(?=\s+[ax]\b)|gzip(?=\s+(?!-l\b))|xz(?=\s+(?!-l\b))|zstd(?=\s+(?!-l\b)))`), 'archive (de)compression'],
  [cmd(String.raw`(?:find|du|fdupes|ncdu)\s+(?:-\S+\s+)*(?:\/|~|\$HOME|\/home|\/var|\/usr|\/opt)`), 'filesystem-wide scan'],
];

/** `curl`/`wget`-style downloads: only trip on download-to-file flags or
 * obviously large artifact URLs — plain API curls (the Commander API, JSON
 * probes) must pass. */
const CURL_DOWNLOAD = /\bcurl\b(?=[^|;&]*(?:\s-[a-zA-Z]*O[a-zA-Z]*(?:\s|$)|\s-o\s+(?!\/dev\/null\b)\S|\s--output(?:\s|=)(?!\/dev\/null\b)|\s--remote-name\b|\s--continue-at\b|\s-C\s+-|https?:\/\/\S+\.(?:gguf|safetensors|bin|zip|tar(?:\.gz|\.xz|\.bz2|\.zst)?|tgz|iso|img|dmg|deb|rpm|apk|whl|jar|7z|rar|pt|onnx|mp4|mkv|mov)\b))/i;

/** `sleep N` (seconds; suffixes s/m/h) — captured so loops can use any value. */
const SLEEP_RE = /\bsleep\s+(\d+(?:\.\d+)?)([smhd])?\b/gi;
const TIMEOUT_RE = /\btimeout\s+(?:-\S+\s+)*(\d+(?:\.\d+)?)([smhd])?\b/i;
const LOOP_RE = /\b(?:for|while|until)\b[^;]*;\s*do\b|\bdo\s*$|\$\(\s*seq\s+\d/im;
const REPEAT_RE = /\b(?:seq\s+\d+\s+\d+|\{\d+\.\.\d+\})/;

/** Detached / background execution — the exec API cannot host it. */
const DETACHED_RE = /(?:^|[^&])&\s*(?:$|[;)]|(?:>|2>)\S*\s*$)|\b(?:nohup|setsid|disown)\b|\bscreen\s+-dm|\btmux\s+(?:new(?:-session)?\s+-d|send-keys)/;

const toSeconds = (n: string, unit?: string): number => {
  const v = parseFloat(n);
  switch ((unit || 's').toLowerCase()) {
    case 'm': return v * 60;
    case 'h': return v * 3600;
    case 'd': return v * 86400;
    default: return v;
  }
};

/**
 * Replace the CONTENT of quoted spans with spaces (quotes kept) and heredoc
 * BODIES with spaces, so the classifier never matches tool names, sleeps or
 * pipes that live inside string literals — `sed -i 's|/bin/llama-server…|'`,
 * `grep -E 'a|npm run build'`, `cat > x <<EOF … sleep 300 … EOF` are data,
 * not commands. `$(…)`/backticks stay visible (they DO execute).
 */
export function maskShellLiterals(command: string): string {
  const out = command.split('');
  const n = command.length;
  let i = 0;
  // Heredoc delimiters opened on the current line; their bodies start after
  // the next newline, in order.
  let pendingHeredocs: string[] = [];

  const maskHeredocBody = (from: number, delimiter: string): number => {
    let lineStart = from;
    while (lineStart < n) {
      let lineEnd = command.indexOf('\n', lineStart);
      if (lineEnd === -1) lineEnd = n;
      const line = command.slice(lineStart, lineEnd).replace(/^\t+/, '');
      if (line === delimiter) return lineEnd; // delimiter line kept visible
      for (let k = lineStart; k < lineEnd; k++) out[k] = ' ';
      lineStart = lineEnd + 1;
    }
    return n;
  };

  while (i < n) {
    const ch = command[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === "'") {
      const end = command.indexOf("'", i + 1);
      const stop = end === -1 ? n : end;
      for (let k = i + 1; k < stop; k++) out[k] = ' ';
      i = stop + 1;
      continue;
    }
    if (ch === '"') {
      let k = i + 1;
      while (k < n && command[k] !== '"') k += command[k] === '\\' ? 2 : 1;
      for (let m = i + 1; m < k && m < n; m++) out[m] = ' ';
      i = k + 1;
      continue;
    }
    if (ch === '<' && command[i + 1] === '<' && command[i + 2] !== '<') {
      // Heredoc opener <<[-] ['"]?DELIM['"]? (not the <<< herestring).
      const m = /^<<-?\s*(['"]?)([A-Za-z0-9_]+)\1/.exec(command.slice(i));
      if (m) {
        pendingHeredocs.push(m[2]);
        i += m[0].length;
        continue;
      }
    }
    if (ch === '\n' && pendingHeredocs.length > 0) {
      let pos = i + 1;
      for (const delimiter of pendingHeredocs) pos = maskHeredocBody(pos, delimiter);
      pendingHeredocs = [];
      i = pos;
      continue;
    }
    i++;
  }
  return out.join('');
}

/** Payloads of `sh|bash|zsh -c '…'/"…"` in the ORIGINAL command — classified
 * recursively, since their content is masked out of the top-level pass. */
function shellDashCPayloads(command: string): string[] {
  const payloads: string[] = [];
  const re = /\b(?:ba|z|da)?sh\s+(?:-[a-zA-Z]+\s+)*-[a-zA-Z]*c\s+(?:"((?:\\.|[^"\\])*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) {
    const payload = m[1] !== undefined ? m[1].replace(/\\(["\\$`])/g, '$1') : m[2];
    if (payload && payload.trim()) payloads.push(payload);
  }
  return payloads;
}

/** True when the command talks to the Commander API (any route) — never block. */
export function targetsCommanderApi(command: string): boolean {
  return /\/api\/exec\b/.test(command)
    || /\bcurl\b[^|;&]*(?:localhost|127\.0\.0\.1|\$\{?TIDE_SERVER\}?)[^|;&]*\/api\//i.test(command);
}

/**
 * Classify a direct Bash command. See the module header for the rules.
 */
export function classifyDirectBashCommand(input: ExecGuardInput, depth = 0): ExecGuardVerdict {
  const command = (input.command || '').trim();
  const allow: ExecGuardVerdict = { block: false, signals: [] };
  if (!command) return allow;
  if (input.runInBackground) return allow;
  if (targetsCommanderApi(command)) return allow;
  if (DETACHED_RE.test(command)) return allow;

  // Pattern checks run on the MASKED command: quoted strings and heredoc
  // bodies are data (sed/grep/echo arguments, scripts piped into a file or
  // interpreter), not commands — matching inside them produced the false
  // positives that made the guard noisy. `sh -c` payloads (real commands
  // hidden by the masking) are classified recursively below.
  const masked = maskShellLiterals(command);

  const signals: string[] = [];

  // sleep: long on its own, or any sleep inside a loop (a polling loop).
  const isLoop = LOOP_RE.test(masked) || REPEAT_RE.test(masked);
  let maxSleep = 0;
  for (const m of masked.matchAll(SLEEP_RE)) maxSleep = Math.max(maxSleep, toSeconds(m[1], m[2]));
  if (maxSleep >= SLEEP_BLOCK_SECONDS) signals.push(`sleep ${maxSleep}s`);
  else if (maxSleep > 0 && isLoop) signals.push('polling loop (sleep inside a loop)');

  const t = TIMEOUT_RE.exec(masked);
  if (t && toSeconds(t[1], t[2]) >= TIMEOUT_BLOCK_SECONDS) signals.push(`timeout ${toSeconds(t[1], t[2])}s wrapper`);

  if (CURL_DOWNLOAD.test(masked)) signals.push('curl download');

  for (const [re, label] of LONG_TOOL_PATTERNS) {
    if (re.test(masked)) {
      signals.push(label);
      // A loop around a long tool is still one signal family; keep the list short.
      if (signals.length >= 3) break;
    }
  }

  // A repeat/loop construct around any flagged tool is a stronger signal;
  // a loop on its own (e.g. `for f in *.ts; do wc -l "$f"; done`) is not.
  if (signals.length > 0 && isLoop && !signals.some((s) => s.startsWith('polling loop'))) {
    signals.push('inside a loop');
  }

  // `bash -c "npm run build"`: the payload is a real command the masking hid.
  if (depth < 2) {
    for (const payload of shellDashCPayloads(command)) {
      const inner = classifyDirectBashCommand({ command: payload }, depth + 1);
      for (const sig of inner.signals) {
        if (!signals.includes(sig)) signals.push(sig);
      }
    }
  }

  return signals.length > 0 ? { block: true, signals } : allow;
}

export interface DenyReasonContext {
  /** Agent id to prefill (falls back to YOUR_AGENT_ID). */
  agentId?: string;
  /** Commander base URL, e.g. http://localhost:5174. */
  baseUrl: string;
  /** Working directory the agent was in (Bash tool cwd), if known. */
  cwd?: string;
  /** Auth token for the Commander API; omitted → no auth header in the curl.
   * Embedding it leaks nothing new: every skill curl the agent runs already
   * carries it in the transcript. */
  authToken?: string;
}

/**
 * The text fed back to the model when a call is denied. It must let the agent
 * comply in ONE step: name the reason, then hand over the exact curl for the
 * same command (auth header included when the API needs one).
 */
export function buildExecGuardDenyReason(command: string, signals: string[], ctx: DenyReasonContext): string {
  const body: Record<string, unknown> = {
    agentId: ctx.agentId || 'YOUR_AGENT_ID',
    command,
  };
  if (ctx.cwd) body.cwd = ctx.cwd;
  body.tail = 40;
  // Single-quoted shell literal: escape embedded single quotes.
  const json = JSON.stringify(body).replace(/'/g, `'\\''`);
  const auth = ctx.authToken ? `-H "X-Auth-Token: ${ctx.authToken}" ` : '';
  return [
    `Tide Commander exec guard: this looks long-running (${signals.join(', ')}) — direct Bash hides its output from the user.`,
    `Re-run it through the Streaming Exec API (same command, live output card):`,
    `curl -s -X POST ${auth}${ctx.baseUrl}/api/exec -H "Content-Type: application/json" -d '${json}'`,
    `\`tail\` trims only the API response (the user's card keeps all output). Do NOT append | tail/| head to hide output, and do not retry the same command directly.`,
  ].join('\n');
}

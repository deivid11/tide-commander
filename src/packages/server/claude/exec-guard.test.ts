import { describe, it, expect } from 'vitest';
import { classifyDirectBashCommand, buildExecGuardDenyReason, targetsCommanderApi, maskShellLiterals } from './exec-guard.js';

const block = (command: string, runInBackground?: boolean) => classifyDirectBashCommand({ command, runInBackground }).block;
const signals = (command: string) => classifyDirectBashCommand({ command }).signals;

describe('exec guard — classifyDirectBashCommand', () => {
  it('blocks the reported polling loop (sleep in a for/seq loop + llama binary) and allows head/sort/uniq pipelines as command logic', () => {
    const userExample = `cd /home/riven/.cache/llama-opt/models; for i in $(seq 1 40); do S=$(stat -c '%s' Qwen3.8-27B-IQ4-MIX.gguf 2>/dev/null || echo 0); [ "$S" = "14111614400" ] && { echo "MIX COMPLETO"; break; }; sleep 10; done; echo "bytes: $(stat -c '%s' Qwen3.8-27B-IQ4-MIX.gguf)"; pkill -f 'curl.*MIX_GGUF' 2>/dev/null; echo "--- tensores del MIX (tipos por bloque, muestra):"; /home/riven/.cache/llama-opt/llama.cpp/build-hip/bin/llama-gguf Qwen3.8-27B-IQ4-MIX.gguf r n 2>/dev/null | grep -oE 'type = [A-Za-z0-9_]+' | sort | uniq -c | sort -rn | head -8`;
    const v = classifyDirectBashCommand({ command: userExample });
    expect(v.block).toBe(true);
    expect(v.signals).toContain('sleep 10s');
    expect(v.signals.some((s) => s.includes('LLM/model binary'))).toBe(true);
    // The trailing `| head -8` is part of the pipeline's logic — it is never a
    // reason on its own (only the loop / sleep / binary tripped).
    expect(block(`some-binary | sort | uniq -c | sort -rn | head -8`)).toBe(false);
  });

  it('allows quick inspection commands agents run constantly', () => {
    for (const c of [
      'git status',
      'git diff --stat',
      'git log --oneline -20',
      'git add -A && git commit -m "x"',
      'ls -la src/',
      'cat package.json',
      'sed -n 1,80p src/packages/server/index.ts',
      'rg -n "npm run build" src/ | head -20',
      'grep -rn "make sure" docs/',
      'echo "make it so"',
      'wc -l src/**/*.ts',
      'stat -c %s file.gguf',
      'pkill -f "curl.*MIX"; echo done',
      'npm pkg get version',
      'npm whoami',
      'node -e "console.log(JSON.parse(process.argv[1]).x)" \'{"x":1}\'',
      'node --version',
      "python3 -c 'import json,sys; print(json.load(open(\"a.py.json\"))[\"x\"])'",
      'python3 - <<EOF\nprint("hi")\nEOF',
      'python3 -m json.tool data.json',
      'curl -s https://api.github.com/repos/x/y | jq .stargazers_count',
      'curl -s -o /dev/null -w "%{http_code}" http://localhost:5174/api/agents',
      'which rg && rg --version',
      'sleep 1 && echo ok',
      'for f in *.ts; do wc -l "$f"; done',
      'find /home/riven/d/tide-commander/src -name "*.test.ts" | wc -l',
      'du -sh node_modules',
      'tail -n 50 server.log',
      'unzip -l bundle.zip',
      'docker ps',
      'kubectl get pods',
      'pm2 list',
      'gh pr view 123 --json state',
      'timeout 3 nc -z localhost 5174',
    ]) {
      expect(block(c), c).toBe(false);
    }
  });

  it('never blocks the Commander API itself (exec or any route, with auth header/env forms)', () => {
    for (const c of [
      `curl -s -X POST -H 'X-Auth-Token: abcd' http://localhost:5174/api/exec -H 'Content-Type: application/json' -d '{"agentId":"a","command":"npm run build"}'`,
      `curl -s -H "X-Auth-Token: abcd" http://localhost:5174/api/agents/x`,
      `curl -s -X POST "$TIDE_SERVER/api/notify" -d '{}'`,
      `curl -s http://127.0.0.1:5174/api/sessions/search?q=x`,
    ]) {
      expect(targetsCommanderApi(c), c).toBe(true);
      expect(block(c), c).toBe(false);
    }
  });

  it('never blocks detached / background execution the exec API cannot host', () => {
    expect(block('npm run dev &')).toBe(false);
    expect(block('nohup npm run dev > dev.log 2>&1 &')).toBe(false);
    expect(block('setsid node server.js')).toBe(false);
    expect(block('tmux new-session -d -s x "npm run dev"')).toBe(false);
    expect(block('npm run build', true)).toBe(false); // run_in_background
  });

  it('blocks builds, tests, installs and toolchain runs', () => {
    for (const [c, sig] of [
      ['npm run build', 'npm task/install'],
      ['cd /repo && npm ci', 'npm task/install'],
      ['npm test -- --run', 'npm task/install'],
      ['npx vitest run src/x.test.ts', 'npx'],
      ['npx tsc --noEmit', 'npx'],
      ['pnpm build', 'pnpm/yarn task'],
      ['yarn test', 'pnpm/yarn task'],
      ['bun run dev', 'bun task'],
      ['tsx scripts/migrate.ts', 'script run (tsx/ts-node)'],
      ['node scripts/build.mjs', 'script run (node file)'],
      ['make apk-release-nondev', 'build system'],
      ['CAP_SERVER_URL= make apk', 'build system'],
      ['./gradlew assembleDebug', 'build system'],
      ['mvn -q test', 'build system'],
      ['cargo build --release', 'cargo'],
      ['go test ./...', 'go toolchain'],
      ['pytest -q', 'python tool'],
      ['python3 -m pytest tests/', 'python script/module run'],
      ['python3 train.py --epochs 3', 'python script/module run'],
      ['pip install -r requirements.txt', 'python package manager'],
      ['uv sync', 'python package manager'],
      ['sudo apt-get install -y ffmpeg', 'system package manager'],
      ['brew install rg', 'system package manager'],
      ['docker build -t x .', 'docker'],
      ['docker compose up -d', 'docker'],
      ['pm2 restart tc-api', 'pm2'],
      ['git pull --rebase origin master', 'git network/heavy op'],
      ['git -C /repo fetch --all', 'git network/heavy op'],
      ['git clone https://github.com/x/y.git', 'git network/heavy op'],
      ['bash -c "npm run lint"', 'npm task/install'],
      ['time make -j8', 'build system'],
      ['sudo -E env FOO=1 make', 'build system'],
    ] as Array<[string, string]>) {
      const v = classifyDirectBashCommand({ command: c });
      expect(v.block, c).toBe(true);
      expect(v.signals, c).toContain(sig);
    }
  });

  it('blocks downloads, model binaries, media/CAD tools, dev servers, follows and watchers', () => {
    for (const [c, sig] of [
      ['curl -L -o model.gguf https://hf.co/x/model.gguf', 'curl download'],
      ['curl -O https://example.com/big.tar.gz', 'curl download'],
      ['curl -sL https://x/y/z.zip', 'curl download'],
      ['wget https://example.com/x.iso', 'file transfer'],
      ['rsync -av src/ host:/dst/', 'file transfer'],
      ['huggingface-cli download unsloth/Qwen3 --local-dir models', 'model download'],
      ['ollama pull llama3', 'ollama'],
      ['/x/llama.cpp/build/bin/llama-gguf model.gguf r n', 'LLM/model binary'],
      ['llama-server -m model.gguf --port 8080', 'LLM/model binary'],
      ['ffmpeg -i in.mp4 out.webm', 'media processing'],
      ['blender -b scene.blend -f 1', 'CAD/office/render binary'],
      ['freecadcmd script.py', 'CAD/office/render binary'],
      ['npm run dev', 'npm task/install'],
      ['tail -f /var/log/syslog', 'log follow'],
      ['journalctl -fu tide', 'log follow'],
      ['watch -n 2 pm2 list', 'watcher'],
      ['pg_dump db > dump.sql', 'database dump/restore'],
      ['tar -czf out.tgz dir/', 'archive (de)compression'],
      ['find / -name "*.gguf"', 'filesystem-wide scan'],
      ['du -sh /home', 'filesystem-wide scan'],
      ['gh run watch 123', 'gh long op'],
      ['claude -p "hello" --output-format json', 'nested agent CLI'],
    ] as Array<[string, string]>) {
      const v = classifyDirectBashCommand({ command: c });
      expect(v.block, c).toBe(true);
      expect(v.signals, c).toContain(sig);
    }
  });

  it('treats sleeps and timeouts by duration, and any sleep inside a loop as a polling loop', () => {
    expect(signals('sleep 30')).toContain('sleep 30s');
    expect(signals('sleep 2m')).toContain('sleep 120s');
    expect(block('sleep 1')).toBe(false);
    expect(signals('while ! nc -z localhost 3000; do sleep 1; done')).toContain('polling loop (sleep inside a loop)');
    expect(signals('until curl -sf localhost:8080/health; do sleep 0.5; done')).toContain('polling loop (sleep inside a loop)');
    expect(signals('timeout 30 npm run dev')).toEqual(expect.arrayContaining(['timeout 30s wrapper', 'npm task/install']));
    expect(block('timeout 2 curl -s localhost:5174/api/health')).toBe(false);
  });

  it('marks a flagged tool inside a loop, but not a loop of quick commands', () => {
    expect(signals('for d in a b c; do (cd $d && npm run build); done')).toContain('inside a loop');
    expect(block('for d in a b c; do (cd $d && git status --short); done')).toBe(false);
  });

  it('never matches inside quoted strings — the sed/grep/echo false positives that spammed agents', () => {
    // The reported case: a sed expression whose s|…|…| delimiter looks like a
    // pipe and whose replacement contains a model-binary path.
    const sed = "sed -i 's|^/home/riven/.cache/llama-opt/llama.cpp/build-hip/bin/llama-server -m $M|" +
      "${LLAMA_BIN:-/home/riven/.cache/llama-opt/llama.cpp/build-hip/bin/llama-server} -m $M|' bench/sweep.sh";
    expect(block(sed)).toBe(false);
    expect(block("grep -E 'error|npm run build|Linking' log.txt")).toBe(false);
    expect(block(`git commit -m "npm run build now passes; sleep 30 removed"`)).toBe(false);
    expect(block("echo 'timeout 900 cmake --build' > plan.txt")).toBe(false);
    expect(block(`awk '{print "docker build done"}' x`)).toBe(false);
  });

  it('never matches inside heredoc bodies — scripts piped into files/interpreters are data', () => {
    expect(block("cat > /tmp/x.sh <<'SH'\nsleep 300\nnpm run build\nSH")).toBe(false);
    expect(block('python3 - <<PYX\nimport time\n# make apk && sleep 60\nprint("ok")\nPYX')).toBe(false);
    // But a long command AROUND the heredoc still trips.
    expect(block("cat > x.txt <<'EOF'\nhello\nEOF\nnpm run build")).toBe(true);
  });

  it('still classifies sh -c payloads (real commands hidden by the quote masking)', () => {
    expect(signals('bash -c "sleep 30"')).toContain('sleep 30s');
    expect(signals("zsh -lc 'cargo build --release'")).toContain('cargo');
    expect(block(`bash -c "echo 'npm run build'"`)).toBe(false); // quoted INSIDE the payload too
  });

  it('does not trip on the tool name appearing inside an argument', () => {
    expect(block('rg -n "npm run build" src/')).toBe(false);
    expect(block('echo "run: make apk-release-nondev"')).toBe(false);
    expect(block('git log --grep="docker build" --oneline')).toBe(false);
  });
});

describe('exec guard — buildExecGuardDenyReason', () => {
  it('hands the agent a ready-to-run curl for the same command, cwd and agent id', () => {
    const reason = buildExecGuardDenyReason(`npm run build && echo 'done'`, ['npm task/install'], {
      agentId: 'ag1',
      baseUrl: 'http://localhost:5174',
      cwd: '/repo',
      authToken: 'tok',
    });
    expect(reason).toContain('exec guard');
    expect(reason).toContain('npm task/install');
    expect(reason).toContain(`-H "X-Auth-Token: tok" http://localhost:5174/api/exec`);
    // JSON body inside a single-quoted shell literal, embedded quote escaped.
    expect(reason).toContain(`"agentId":"ag1"`);
    expect(reason).toContain(`"cwd":"/repo"`);
    expect(reason).toContain(`echo '\\''done'\\''`);
    expect(reason).toContain('"tail":40');
    expect(reason).toContain('do not retry the same command directly');
  });

  it('omits the auth header when there is no token, and falls back to YOUR_AGENT_ID', () => {
    const reason = buildExecGuardDenyReason('make', ['build system'], { baseUrl: 'http://localhost:5174' });
    expect(reason).not.toContain('X-Auth-Token');
    expect(reason).toContain('"agentId":"YOUR_AGENT_ID"');
  });
});

describe('maskShellLiterals', () => {
  it('blanks quoted content but keeps structure, quotes and unquoted text', () => {
    expect(maskShellLiterals("echo 'a|b' x")).toBe("echo '   ' x");
    expect(maskShellLiterals('run "in \\" quo" tail')).toBe('run "         " tail');
    expect(maskShellLiterals("a\\'b 'c'")).toBe("a\\'b ' '");
  });

  it('blanks heredoc bodies up to the delimiter line, keeping the rest visible', () => {
    const cmd = "cat <<'EOF' > x\nsleep 9\nEOF\nnpm test";
    const masked = maskShellLiterals(cmd);
    expect(masked).not.toContain('sleep 9');
    expect(masked).toContain('npm test');
    expect(masked).toContain('EOF');
  });

  it('leaves herestrings and command substitution visible', () => {
    expect(maskShellLiterals('wc -l <<< abc')).toBe('wc -l <<< abc');
    expect(maskShellLiterals('echo $(make)')).toBe('echo $(make)');
  });
});

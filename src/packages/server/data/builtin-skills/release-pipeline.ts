import type { BuiltinSkillDefinition } from './types.js';

export const releasePipeline: BuiltinSkillDefinition = {
  slug: 'release-pipeline',
  name: 'TC Release Pipeline',
  description: 'Full release workflow: lint, type-check, test, version bump, changelog, build + APK artifact, git tag, GitHub release, npm public publish. Use when asked to release, publish, ship, or do a full build pipeline.',
  allowedTools: [
    'Bash(git:*)',
    'Bash(npm:*)',
    'Bash(make:*)',
    'Bash(gh:*)',
    'Bash(curl:*)',
    'Bash(npx:*)',
    'Read',
    'Edit',
    'Grep',
    'Glob',
  ],
  content: `# Release Pipeline

Full Tide Commander release: quality checks, version bump, changelog, web app + APK build, tag, push, GitHub release with the APK attached, public npm publish.

PHASE ORDER IS LOAD-BEARING: the version bump (Phase 3) MUST run BEFORE the build (Phase 5). The web bundle bakes \`__APP_VERSION__\` and the Android build reads versionName/versionCode from package.json at build time — bumping after building shipped APKs that reported the PREVIOUS version (the v1.150.6 release APK embedded 1.150.5), so freshly-updated phones immediately saw themselves as outdated again and the in-app updater looped forever.

## Execution Model: Sub-Agent Delegation

MANDATORY: You are the pipeline orchestrator. Delegate pipeline work to sub-agents via the Claude Code \`Agent\` tool — do NOT run build/lint/test/release commands yourself. Coordinate phases, gate on each sub-agent's result before proceeding, parallelize independent tasks (multiple Agent calls in one response), and report the overall result to the user.

Every sub-agent prompt MUST include: the exact commands from the phase descriptions below, the working directory (current project root), clear PASS/FAIL criteria, and instructions to use the Streaming Exec API for long-running commands:

\`\`\`
curl -s -X POST -H 'X-Auth-Token: abcd' http://localhost:5174/api/exec -H 'Content-Type: application/json' -d '{\"agentId\":\"YOUR_AGENT_ID\",\"command\":\"<COMMAND>\"}'
\`\`\`

Example sub-agent:
\`\`\`
Agent({
  description: "Run ESLint check",
  prompt: "Run ESLint on the Tide Commander project and report pass/fail. Use the Streaming Exec API: curl -s -X POST -H 'X-Auth-Token: abcd' http://localhost:5174/api/exec -H 'Content-Type: application/json' -d '{\"agentId\":\"YOUR_AGENT_ID\",\"command\":\"npm run lint\"}'. Check the output and exitCode. Report PASS if zero warnings and zero errors, otherwise report FAIL with the lint output. Do not attempt to fix any issues."
})
\`\`\`

## Core Principles

1. Fail fast — if any sub-agent reports FAIL, STOP the pipeline and report to the user. Do NOT attempt to fix issues automatically.
2. Never force push to shared branches (main, master, develop)
3. Never auto-resolve conflicts — report them to the user
4. Always verify the current branch before any operation
5. NEVER add Co-Authored-By trailers to commits

## Full Release Workflow

For "release", "ship", "publish", "do a full release", or similar:

### Phase 1: Pre-Flight Checks (run yourself — lightweight)

\`\`\`bash
git status
git branch --show-current
\`\`\`

Uncommitted & untracked files are ALWAYS included in the release commit (intentional pipeline default) — do NOT ask the user, do NOT stash. List them so the user sees what is about to ship, then proceed without confirmation. Warn if not on the expected branch (usually \`master\`).

\`\`\`bash
git pull --rebase origin $(git branch --show-current)
\`\`\`
On conflicts: STOP immediately and report. Do NOT auto-resolve.

Verify the changelog packaging contract (fail fast — before doing any build/publish work):

\`\`\`bash
npm pkg get files | grep -q '"CHANGELOG.md"' || echo "MISSING: CHANGELOG.md not in package.json files"
\`\`\`
\`CHANGELOG.md\` MUST be listed in package.json \`files\`. It ships in the npm tarball and is served by the server at \`GET /api/system/changelog\`; the in-app changelog (post-update banner + Settings → About) reads this local packaged file instead of the GitHub API, which 403'd on rate limits (60 req/hour). If the check prints \`MISSING\`: STOP and report — do NOT publish, or the in-app changelog breaks.

### Phase 1b: Secret & Artifact Scan (run yourself — MANDATORY, fail fast)

This repo is PUBLIC and every release is published to npm, so \`git add -A\` in Phase 6 is the moment a secret or a stray artifact becomes permanent. Scan what is about to ship BEFORE doing any other work — a leak caught here costs nothing, one caught after the push needs a history rewrite that force-pushes 400+ tags and still cannot purge GitHub's PR refs or forks.

Scan only the files this release will actually commit (tracked modifications + untracked), never the whole repo — whole-repo greps drown in test fixtures and placeholders:

Two ways this scan silently scans NOTHING while looking like it passed — a scan that cannot fail is worse than no scan, so verify both:

- **Run it from the repo root.** \`git status --porcelain\` prints repo-relative paths, but \`xargs grep\` resolves them against the CURRENT directory. Run from anywhere else (or with \`git -C\`) and every path misses.
- **Pipe the file list through \`xargs\`; never expand it from a shell variable.** This runs under zsh, which does not word-split an unquoted \`$FILES\`, so \`grep … $FILES\` passes every path as ONE filename and reports "No such file or directory".

If a scan prints nothing, confirm it had files to look at (\`git status --porcelain | wc -l\`) before calling it clean.

\`\`\`bash
git status --porcelain | awk '{print $NF}' | xargs -r grep -nIE "(sk-ant-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY|eyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,})"
\`\`\`

Then the three checks that catch what a regex cannot:

\`\`\`bash
# 1. Sensitive FILE TYPES about to be committed (.gitignore only covers what someone remembered)
git status --porcelain | grep -iE "\\.env($|\\.)|\\.pem$|\\.key$|\\.p12$|\\.pfx$|id_[rd]sa|credentials|auth\\.json|\\.private\\."

# 2. Stray build/scratch artifacts — git add -A sweeps these in silently
git status --porcelain --untracked-files=all | awk '{print $NF}' | xargs -r du -h 2>/dev/null | awk '$1 ~ /M|G/'
git status --porcelain | grep -iE "\\.(bundle|zip|apk|mp4|mov|stl|blend|pyc|log|sqlite|db)$|__pycache__|screen-capture|backup"

# 3. Internal infrastructure in NEW doc/skill content (private IPs, internal hosts, SSH targets)
# FOUR octets, always — "10\\.[0-9]+\\.[0-9]+" also matches semver, which buries the
# real hits under every "10.1.0" in package-lock.json. Lock files are excluded too.
git status --porcelain | awk '{print $NF}' | grep -v "package-lock.json" | xargs -r grep -nIE "(10|172\\.(1[6-9]|2[0-9]|3[01])|192\\.168)\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}|ssh +[a-z_-]+@|-J +[a-z_-]+@" 2>/dev/null | grep -viE "example|placeholder|localhost|127\\.0\\.0\\.1|192\\.168\\.1\\.100"
\`\`\`

Any hit: STOP and report it to the user with the file and line. Do NOT fix it yourself and do NOT decide it looks like a placeholder — the user decides what is real. Zero hits: say "secret scan clean" in one line and continue.

Judgement notes, from leaks this pipeline has actually shipped or nearly shipped:

- **Anything under \`public/\` reaches everyone.** It is copied into \`dist/\`, so it lands in the npm tarball, the web bundle AND the APK. A dev-only helper there (a page that seeds an auth token into localStorage, a fixture, a debug harness) is published to every user. Treat a new \`public/\` file as a release decision, not an implementation detail.
- **Built-in skills (\`src/packages/server/data/builtin-skills/\`) compile into \`dist\` and ship to npm.** Real chat ids, phone numbers, internal hostnames and document titles used as "examples" in skill text are published. Examples must be obviously fake.
- **A scratch file in the repo root is one \`git add -A\` from being permanent.** An 81 MB backup bundle written there by a mistyped \`cd\` was caught only by an explicit size check. Size + extension checks exist for exactly this.
- **The scan re-runs in Phase 6** because other agents commit into this tree while a release is in flight.

### Phase 2: Quality Gates (3 parallel sub-agents)

Spawn all 3 Agent calls in a single response, each using the curl template above with its command, checking output and exitCode, and instructed not to fix any issues:

| Sub-agent | Command | PASS criteria |
|-----------|---------|---------------|
| ESLint | \`npm run lint\` | zero warnings and zero errors |
| TypeScript type check | \`npm run lint:types\` | zero type errors |
| Tests | \`npm test\` | all tests pass |

On FAIL, the sub-agent reports the lint output / type errors / failing test details. If ANY of the 3 reports FAIL: STOP and report all failures. Proceed only if all 3 PASS.

### Phase 3: Version Bump (run yourself — requires judgment, sequential; MUST precede the build)

\`\`\`bash
npm pkg get version
\`\`\`

Analyze commits since the last tag and decide the bump yourself from conventional commit prefixes — do NOT ask the user:
- **patch** (0.0.X): only \`fix:\`, \`perf:\`, \`refactor:\`, \`chore:\`, \`docs:\`, \`style:\`, \`test:\` commits — no new user-facing features
- **minor** (0.X.0): at least one \`feat:\` or \`add:\` commit, or new files/modules/skills added — no breaking changes
- **major** (X.0.0): \`BREAKING CHANGE\` in the body, or \`feat!:\` / \`fix!:\` prefix

\`\`\`bash
npm version <patch|minor|major> --no-git-tag-version
\`\`\`

The Android versionCode/versionName derive automatically from package.json (android/app/build.gradle reads it at build time) — do NOT edit build.gradle and do NOT worry about versionCode; bumping package.json is enough.

### Phase 4: Update Changelog (run yourself)

\`\`\`bash
git log --oneline $(git describe --tags --abbrev=0 2>/dev/null || echo "HEAD~20")..HEAD
\`\`\`

Add the new version entry at the top of \`CHANGELOG.md\` (directly below the \`# Changelog\` header), Keep a Changelog format. Only include sections that have entries; write concise, user-facing descriptions. The changelog is a committed, packaged (package.json \`files\`), server-served artifact — it MUST be updated every release so the bundled file stays current.

\`\`\`markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- New features (from \`feat:\` or \`add:\` commits)

### Changed
- (from \`change:\`, \`update:\`, \`refactor:\`, \`perf:\` commits)

### Fixed
- (from \`fix:\` or \`bugfix:\` commits)

### Removed
- (from \`remove:\` or \`delete:\` commits)
\`\`\`

CRITICAL — keep the per-version header EXACTLY \`## [X.Y.Z] - YYYY-MM-DD\` (Keep a Changelog): one header per release, newest at the top. The in-app changelog modal extracts a single release by matching the line \`## [X.Y.Z]\`; any other header format breaks the per-version view (the full-changelog view still works). Do NOT drop the \`[\` \`]\` brackets, the version number, or change the \` - YYYY-MM-DD\` suffix.

### Phase 5: Build (ONE sub-agent, AFTER the version bump)

Spawn a single sub-agent: \`make apk-release-nondev\` — it clears CAP_SERVER_URL, builds the web app (\`npm run build\`), syncs Capacitor, and builds the APK. Output: android/app/build/outputs/apk/debug/app-debug.apk. PASS if exitCode 0 and the APK file exists, else FAIL with the error output.

Do NOT also run \`make apk\`, and NEVER run two APK builds in parallel: both write the same dist/ and the same output APK path (a race that can publish a corrupted or wrong artifact), and \`make apk\` inherits any ambient CAP_SERVER_URL — which bakes a private dev-server URL into a public release. \`make apk-release-nondev\` is the ONLY release artifact build.

(The npm tarball does not depend on this build — package.json \`prepack\` rebuilds dist at publish time.)

### Phase 6: Commit, Tag, Push (run yourself — sequential git ops)

RE-RUN the Phase 1b secret & artifact scan first. The tree has changed since then: other agents commit into it while a release is in flight, and the build itself writes files. This is the last moment before \`git add -A\` makes everything permanent.

\`\`\`bash
git add package.json package-lock.json CHANGELOG.md
git add -A  # MANDATORY: include all modified + untracked files in the release commit

git diff --cached --stat  # show what will be committed
\`\`\`

\`git add -A\` is mandatory — do not skip it, narrow it, or ask the user to confirm individual paths. The ONE exception is a Phase 1b hit: unstage it (\`git restore --staged <path>\`), report it, and let the user decide. Show the staged summary for visibility, then commit without waiting for approval:

\`\`\`bash
git commit -m "chore(release): v<VERSION>

- Summary of main changes
- Another change"

git tag -a v<VERSION> -m "Release v<VERSION>

Highlights:
- Main feature or fix
- Another highlight"

git push origin $(git branch --show-current)
git push origin v<VERSION>
\`\`\`

### Phase 7: Public Release (sub-agent)

\`\`\`
Agent({
  description: "Create GitHub release and publish to npm",
  prompt: "Create the GitHub release for Tide Commander v<VERSION> and publish to npm. Steps:

1. Create the GitHub release:
   gh release create v<VERSION> --title 'v<VERSION>' --notes '<RELEASE_NOTES>'

   Release notes format:
   ## What's New
   ### Added
   ### Changed
   ### Fixed
   ## Technical Details

2. Attach APK artifacts:
   gh release upload v<VERSION> android/app/build/outputs/apk/debug/app-debug.apk --clobber

3. Check if the publish workflow was triggered by the tag push:
   gh run list --workflow publish.yml --limit 5

   If the workflow is running or completed successfully, report that. If it is unavailable or failed, run manual publish:
   npm whoami
   npm publish --provenance --access public

Report PASS with the release URL if everything succeeded, or FAIL with the specific error (gh error, npm auth, 2FA, version exists, provenance, etc)."
})
\`\`\`

If the sub-agent reports FAIL: STOP and report the error to the user.

## Partial Workflows

- "check quality" / "run checks" / "lint and test" / "pre-release check": Phases 1b + 2 (secret scan, then the parallel sub-agents); report results without proceeding.
- "security check" / "check for leaks" / "audit secrets": Phase 1b only, reported without proceeding.
- "build" / "build everything" / "build apk": Phase 5 only (builds the current package.json version); skip version bump and release.
- "tag" / "create release" / "push release" (version already bumped): skip Phases 2-3; run Phases 4-6 directly (changelog, build, commit/tag/push), Phase 7 via sub-agent.

## Failure Handling

When any step or sub-agent fails: STOP, do NOT proceed or auto-fix, report the failure clearly, and wait for user instructions. Report specifics:
- Secret / artifact scan hit: the file, the line, and what matched — never the secret's value itself
- Lint / type / test failures: the failing output
- Build or APK failure: the error (APK failures are often SDK/Gradle issues)
- GitHub release failure: the \`gh\` error and current release/tag state
- npm publish failure: exact error (auth, 2FA, version exists, provenance)
- Git conflicts: list conflicting files; user resolves manually
- Push rejected: the rejection reason (likely needs pull first)
- Sub-agent failed to run or returned an ambiguous result: treat as FAIL

## Version Guidelines

0.x.x pre-release (API may change); 1.0.0 first stable; x.Y.0 new backwards-compatible features; x.x.Z bug fixes only. Decide the version type automatically from commit history; ask the user only if genuinely ambiguous (e.g., a mix of features and potential breaking changes).`,
};

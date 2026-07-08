import type { BuiltinSkillDefinition } from './types.js';

export const releasePipeline: BuiltinSkillDefinition = {
  slug: 'release-pipeline',
  name: 'TC Release Pipeline',
  description: 'Full release workflow: lint, type-check, test, build, APK artifacts, version bump, changelog, git tag, GitHub release, npm public publish. Use when asked to release, publish, ship, or do a full build pipeline.',
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

Full Tide Commander release: quality checks, web app + APK builds, version bump, changelog, tag, push, GitHub release with APKs attached, public npm publish.

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

### Phase 2: Quality Gates (3 parallel sub-agents)

Spawn all 3 Agent calls in a single response, each using the curl template above with its command, checking output and exitCode, and instructed not to fix any issues:

| Sub-agent | Command | PASS criteria |
|-----------|---------|---------------|
| ESLint | \`npm run lint\` | zero warnings and zero errors |
| TypeScript type check | \`npm run lint:types\` | zero type errors |
| Tests | \`npm test\` | all tests pass |

On FAIL, the sub-agent reports the lint output / type errors / failing test details. If ANY of the 3 reports FAIL: STOP and report all failures. Proceed only if all 3 PASS.

### Phase 3: Build (sub-agents; APK builds depend on web build output)

First spawn one sub-agent: \`npm run build\` — PASS if exitCode 0, else FAIL with the build error output.

If web build PASSED, spawn 2 APK sub-agents in parallel (one response):
- Debug APK: \`make apk\` (runs npx cap sync android + gradlew assembleDebug). Output APK: android/app/build/outputs/apk/debug/app-debug.apk
- Non-dev debug APK (signing-safe artifact): \`make apk-release-nondev\`. Output APK: android/app/build/outputs/apk/debug/app-debug.apk

Each reports PASS if exitCode 0, else FAIL with the error. If any build sub-agent FAILs: STOP and report.

### Phase 4: Version Bump (run yourself — requires judgment, sequential)

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

### Phase 5: Update Changelog (run yourself)

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

### Phase 6: Commit, Tag, Push (run yourself — sequential git ops)

\`\`\`bash
git add package.json package-lock.json CHANGELOG.md
git add -A  # MANDATORY: include all modified + untracked files in the release commit

git diff --cached --stat  # show what will be committed
\`\`\`

\`git add -A\` is mandatory — do not skip it, narrow it, or ask the user to confirm individual paths. Show the staged summary for visibility, then commit without waiting for approval:

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

- "check quality" / "run checks" / "lint and test" / "pre-release check": Phase 2 only (parallel sub-agents); report results without proceeding.
- "build" / "build everything" / "build apk": Phase 3 only; skip version bump and release.
- "tag" / "create release" / "push release" (version already bumped): skip Phases 2-4; run Phases 5-6 directly, Phase 7 via sub-agent.

## Failure Handling

When any step or sub-agent fails: STOP, do NOT proceed or auto-fix, report the failure clearly, and wait for user instructions. Report specifics:
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

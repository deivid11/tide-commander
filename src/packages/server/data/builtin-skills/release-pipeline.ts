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

Full release workflow for Tide Commander. Runs quality checks, builds web app + APK artifacts, bumps the version, updates the changelog, tags, pushes, creates a GitHub release with APKs attached, and publishes publicly to npm.

## Execution Model: Sub-Agent Delegation

**MANDATORY**: You are the pipeline orchestrator. You MUST delegate pipeline work to sub-agents using the Claude Code \`Agent\` tool. Do NOT run build/lint/test/release commands yourself. Your role is to:

1. **Coordinate** — decide which phase to run next based on previous results
2. **Delegate** — spawn sub-agents with clear, self-contained task descriptions
3. **Gate** — check each sub-agent's result before proceeding
4. **Parallelize** — run independent tasks concurrently by spawning multiple Agents in the same response
5. **Report** — summarize the overall pipeline result to the user

Each sub-agent prompt MUST include:
- The exact commands to run (copy them from the phase descriptions below)
- The working directory (use the current project root)
- Clear success/failure criteria so the sub-agent can report a definitive result
- Instructions to use the Streaming Exec API (\`curl -s -X POST -H "X-Auth-Token: abcd" http://localhost:5174/api/exec ...\`) for long-running commands

## Core Principles

1. **Fail fast** — If any sub-agent reports failure, STOP the pipeline and report to the user. Do NOT attempt to fix issues automatically.
2. **Never force push** to shared branches (main, master, develop)
3. **Never auto-resolve conflicts** — report them to the user
4. **Always verify** the current branch before any operation
5. **NEVER add Co-Authored-By trailers** to commits

---

## Full Release Workflow

When asked to "release", "ship", "publish", "do a full release", or similar:

### Phase 1: Pre-Flight Checks (run yourself)

This phase is lightweight — run it directly, no sub-agent needed.

\`\`\`bash
# Verify branch and current state
git status
git branch --show-current
\`\`\`

**Uncommitted & untracked files — ALWAYS include them in the release commit.** Do NOT ask the user whether to include them. Do NOT stash them. The release commit always bundles the current working tree (modified files + untracked files) along with the version bump and changelog. This is the intentional default for this pipeline.

- List the uncommitted/untracked files so the user can see what is about to ship, but proceed without asking for confirmation.
- If not on the expected branch (usually \`master\`), warn the user.

\`\`\`bash
# Pull latest to avoid conflicts
git pull --rebase origin $(git branch --show-current)
\`\`\`

**If conflicts occur:** STOP immediately and report to user. Do NOT auto-resolve.

---

### Phase 2: Quality Gates (delegate to parallel sub-agents)

Spawn **3 sub-agents in parallel** using the Agent tool. Send all 3 Agent calls in a single response so they run concurrently:

**Sub-agent 1 — ESLint:**
\`\`\`
Agent({
  description: "Run ESLint check",
  prompt: "Run ESLint on the Tide Commander project and report pass/fail. Use the Streaming Exec API: curl -s -X POST -H 'X-Auth-Token: abcd' http://localhost:5174/api/exec -H 'Content-Type: application/json' -d '{\"agentId\":\"YOUR_AGENT_ID\",\"command\":\"npm run lint\"}'. Check the output and exitCode. Report PASS if zero warnings and zero errors, otherwise report FAIL with the lint output. Do not attempt to fix any issues."
})
\`\`\`

**Sub-agent 2 — TypeScript Type Check:**
\`\`\`
Agent({
  description: "Run TypeScript type check",
  prompt: "Run TypeScript type checking on the Tide Commander project and report pass/fail. Use the Streaming Exec API: curl -s -X POST -H 'X-Auth-Token: abcd' http://localhost:5174/api/exec -H 'Content-Type: application/json' -d '{\"agentId\":\"YOUR_AGENT_ID\",\"command\":\"npm run lint:types\"}'. Check the output and exitCode. Report PASS if zero type errors, otherwise report FAIL with the errors. Do not attempt to fix any issues."
})
\`\`\`

**Sub-agent 3 — Tests:**
\`\`\`
Agent({
  description: "Run test suite",
  prompt: "Run the test suite for the Tide Commander project and report pass/fail. Use the Streaming Exec API: curl -s -X POST -H 'X-Auth-Token: abcd' http://localhost:5174/api/exec -H 'Content-Type: application/json' -d '{\"agentId\":\"YOUR_AGENT_ID\",\"command\":\"npm test\"}'. Check the output and exitCode. Report PASS if all tests pass, otherwise report FAIL with the failing test details. Do not attempt to fix any issues."
})
\`\`\`

**After all 3 return:** Check each result. If ANY sub-agent reported FAIL, STOP the pipeline and report all failures to the user. Only proceed to Phase 3 if all 3 reported PASS.

---

### Phase 3: Build (delegate to sub-agents)

First spawn a sub-agent for the web build. The APK builds depend on the web build output, so they must run after.

**Sub-agent — Web Build:**
\`\`\`
Agent({
  description: "Build web app",
  prompt: "Build the Tide Commander web app and report pass/fail. Use the Streaming Exec API: curl -s -X POST -H 'X-Auth-Token: abcd' http://localhost:5174/api/exec -H 'Content-Type: application/json' -d '{\"agentId\":\"YOUR_AGENT_ID\",\"command\":\"npm run build\"}'. Report PASS if exitCode is 0, otherwise report FAIL with the build error output."
})
\`\`\`

**If web build PASSED**, spawn **2 sub-agents in parallel** for APK builds (send both Agent calls in one response):

**Sub-agent — Debug APK:**
\`\`\`
Agent({
  description: "Build debug APK",
  prompt: "Build the Android debug APK for Tide Commander. Use the Streaming Exec API: curl -s -X POST -H 'X-Auth-Token: abcd' http://localhost:5174/api/exec -H 'Content-Type: application/json' -d '{\"agentId\":\"YOUR_AGENT_ID\",\"command\":\"make apk\"}'. This runs npx cap sync android + gradlew assembleDebug. Output APK: android/app/build/outputs/apk/debug/app-debug.apk. Report PASS if exitCode is 0, otherwise report FAIL with the error."
})
\`\`\`

**Sub-agent — Non-Dev Debug APK:**
\`\`\`
Agent({
  description: "Build non-dev debug APK",
  prompt: "Build the Android non-dev debug APK (signing-safe artifact) for Tide Commander. Use the Streaming Exec API: curl -s -X POST -H 'X-Auth-Token: abcd' http://localhost:5174/api/exec -H 'Content-Type: application/json' -d '{\"agentId\":\"YOUR_AGENT_ID\",\"command\":\"make apk-release-nondev\"}'. Output APK: android/app/build/outputs/apk/debug/app-debug.apk. Report PASS if exitCode is 0, otherwise report FAIL with the error."
})
\`\`\`

**If any build sub-agent reported FAIL**, STOP and report the error.

---

### Phase 4: Version Bump (run yourself)

This phase requires judgment and is sequential — run it directly.

Read the current version:
\`\`\`bash
npm pkg get version
\`\`\`

Analyze the commits since the last tag and **decide the version bump yourself** based on conventional commit prefixes. Do NOT ask the user which type to use.

Rules for automatic selection:
- **patch** (0.0.X): Only \`fix:\`, \`perf:\`, \`refactor:\`, \`chore:\`, \`docs:\`, \`style:\`, \`test:\` commits - no new user-facing features
- **minor** (0.X.0): At least one \`feat:\` or \`add:\` commit, or new files/modules/skills added - no breaking changes
- **major** (X.0.0): Commits containing \`BREAKING CHANGE\` in the body, or \`feat!:\` / \`fix!:\` prefix indicating breaking API/behavior changes

Bump the version:
\`\`\`bash
npm version <patch|minor|major> --no-git-tag-version
\`\`\`

---

### Phase 5: Update Changelog (run yourself)

This phase requires reading commits and writing markdown — run it directly.

Read recent commits since the last tag:

\`\`\`bash
git log --oneline $(git describe --tags --abbrev=0 2>/dev/null || echo "HEAD~20")..HEAD
\`\`\`

Update \`CHANGELOG.md\` with the new version entry at the top (below the header). Use the Keep a Changelog format:

\`\`\`markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- New features (from \`feat:\` or \`add:\` commits)

### Changed
- Changes to existing functionality (from \`change:\`, \`update:\`, \`refactor:\`, \`perf:\` commits)

### Fixed
- Bug fixes (from \`fix:\` or \`bugfix:\` commits)

### Removed
- Removed features (from \`remove:\` or \`delete:\` commits)
\`\`\`

Only include sections that have entries. Write concise, user-facing descriptions.

---

### Phase 6: Commit, Tag, Push (run yourself)

This phase is sequential git operations — run it directly.

#### Stage and Commit

Always stage the release metadata files **and** every modified/untracked file in the working tree. \`git add -A\` is mandatory — do not skip it, do not replace it with a narrower \`git add\`, and do not ask the user to confirm individual paths.

\`\`\`bash
git add package.json package-lock.json CHANGELOG.md
git add -A  # MANDATORY: include all modified + untracked files in the release commit

git diff --cached --stat  # show what will be committed
\`\`\`

Show the staged changes summary to the user for visibility, then proceed with the commit without waiting for approval on which files to include.

\`\`\`bash
git commit -m "chore(release): v<VERSION>

- Summary of main changes
- Another change"
\`\`\`

#### Create Annotated Tag

\`\`\`bash
git tag -a v<VERSION> -m "Release v<VERSION>

Highlights:
- Main feature or fix
- Another highlight"
\`\`\`

#### Push to Remote

\`\`\`bash
git push origin $(git branch --show-current)
git push origin v<VERSION>
\`\`\`

---

### Phase 7: Public Release (delegate to sub-agent)

Spawn a sub-agent to handle the GitHub release, APK attachment, and npm publish:

**Sub-agent — GitHub Release + npm Publish:**
\`\`\`
Agent({
  description: "Create GitHub release and publish to npm",
  prompt: "Create the GitHub release for Tide Commander v<VERSION> and publish to npm. Steps:

1. Create the GitHub release:
   gh release create v<VERSION> --title 'v<VERSION>' --notes '<RELEASE_NOTES>'

   Release notes format:
   ## What's New
   ### Added
   - Feature descriptions
   ### Changed
   - Changes and improvements
   ### Fixed
   - Bug fixes
   ## Technical Details
   - Implementation notes

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

**If the sub-agent reported FAIL**, STOP and report the error to the user.

---

## Partial Workflows

The skill also supports running individual phases:

### Quality Check Only

When asked to "check quality", "run checks", "lint and test", or "pre-release check":

Run Phase 2 only using parallel sub-agents as described above. Report results without proceeding further.

### Build Only

When asked to "build", "build everything", or "build apk":

Run Phase 3 only using sub-agents as described above. Skip version bump and release.

### Tag and Release Only

When asked to "tag", "create release", or "push release" (when version is already bumped):

Skip Phases 2-4, run Phases 5-7 (Phases 5-6 directly, Phase 7 via sub-agent).

---

## Failure Handling

- **Lint warnings/errors**: STOP, report the lint output, do NOT auto-fix
- **Type errors**: STOP, report the errors, do NOT auto-fix
- **Test failures**: STOP, report failing tests, do NOT auto-fix
- **Build failure**: STOP, report the build error
- **APK build failure**: STOP, report the error (often SDK/Gradle issues)
- **GitHub release failure**: STOP, report the \`gh\` error and current release/tag state
- **npm publish failure**: STOP, report exact publish error (auth, 2FA, version exists, provenance)
- **Git conflicts**: STOP, list conflicting files, ask user to resolve manually
- **Push rejected**: STOP, report the rejection reason (likely needs pull first)
- **Sub-agent failure**: If a sub-agent fails to run or returns an ambiguous result, treat it as a FAIL and report to the user

**Critical rule**: When any step or sub-agent fails, do NOT proceed to subsequent steps. Report the failure clearly and wait for user instructions.

---

## Quick Reference

| Phase | Command | Gate | Execution |
|-------|---------|------|-----------|
| Lint | \`npm run lint\` | Zero warnings | Sub-agent (parallel) |
| Types | \`npm run lint:types\` | Zero errors | Sub-agent (parallel) |
| Tests | \`npm test\` | All passing | Sub-agent (parallel) |
| Build | \`npm run build\` | Exit code 0 | Sub-agent |
| APK Debug | \`make apk\` | Exit code 0 | Sub-agent (parallel) |
| APK Non-Dev Debug | \`make apk-release-nondev\` | Exit code 0 | Sub-agent (parallel) |
| Version | \`npm version <type> --no-git-tag-version\` | - | Direct |
| Changelog | Edit \`CHANGELOG.md\` | - | Direct |
| Tag | \`git tag -a v<VER> -m "..."\` | - | Direct |
| Push | \`git push origin <branch> && git push origin v<VER>\` | - | Direct |
| GH Release | \`gh release create v<VER> --notes "..."\` | - | Sub-agent |
| Attach APKs | \`gh release upload v<VER> <apk-path> --clobber\` | - | Sub-agent |
| npm Publish | \`npm publish --provenance --access public\` | Exit code 0 | Sub-agent |

---

## Version Guidelines

- **0.x.x** - Pre-release, API may change
- **1.0.0** - First stable release
- **x.Y.0** - New features (backwards compatible)
- **x.x.Z** - Bug fixes only

Always decide the version type automatically based on the commit history. Only ask the user if the commits are genuinely ambiguous (e.g., a mix of features and potential breaking changes).`,
};

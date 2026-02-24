import type { BuiltinSkillDefinition } from './types.js';

export const releasePipeline: BuiltinSkillDefinition = {
  slug: 'release-pipeline',
  name: 'TC Release Pipeline',
  description: 'Full release workflow: lint, type-check, test, build, APK, version bump, changelog, git tag, GitHub release. Use when asked to release, publish, ship, or do a full build pipeline.',
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

Full release workflow for Tide Commander. Runs quality checks, builds everything, bumps the version, updates the changelog, tags, pushes, creates a GitHub release, and optionally attaches the APK.

## Core Principles

1. **Fail fast** - If any quality gate fails, STOP and report to the user. Do NOT attempt to fix issues automatically.
2. **Never force push** to shared branches (main, master, develop)
3. **Never auto-resolve conflicts** - report them to the user
4. **Always verify** the current branch before any operation
5. **NEVER add Co-Authored-By trailers** to commits

---

## Full Release Workflow

When asked to "release", "ship", "publish", "do a full release", or similar:

### Phase 1: Pre-Flight Checks

\`\`\`bash
# Verify branch and clean state
git status
git branch --show-current
\`\`\`

- If there are uncommitted changes, list them and ask the user if they should be included.
- If not on the expected branch (usually \`master\`), warn the user.

\`\`\`bash
# Pull latest to avoid conflicts
git pull --rebase origin $(git branch --show-current)
\`\`\`

**If conflicts occur:** STOP immediately and report to user. Do NOT auto-resolve.

---

### Phase 2: Quality Gates (ALL must pass)

Run each gate sequentially. If ANY gate fails, STOP and report the failure to the user. Do NOT try to fix issues.

Use the Streaming Exec API for all long-running commands so the user can see live output:

\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"COMMAND"}'
\`\`\`

#### Gate 1: ESLint (zero warnings)

\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"npm run lint"}'
\`\`\`

Check the output. If there are **any warnings or errors**, STOP and report them to the user.

#### Gate 2: TypeScript Type Check (zero errors)

\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"npm run lint:types"}'
\`\`\`

If there are type errors, STOP and report them.

#### Gate 3: Tests (all passing)

\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"npm test"}'
\`\`\`

If any tests fail, STOP and report them.

---

### Phase 3: Build

#### Build Web App

\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"npm run build"}'
\`\`\`

If the build fails, STOP and report the error.

#### Build Android APK (optional - ask user)

Ask the user: "Do you want to build the Android APK as part of this release?"

If yes, build the **release** APK:

\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"make apk-release"}'
\`\`\`

This runs: \`npm run build\` + \`npx cap sync\` + \`gradlew assembleRelease\`

Output APK location: \`android/app/build/outputs/apk/release/app-release-unsigned.apk\`

For a **debug** APK instead:

\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"make apk"}'
\`\`\`

Output: \`android/app/build/outputs/apk/debug/app-debug.apk\`

If the APK build fails, STOP and report the error.

---

### Phase 4: Version Bump

#### Determine Version Type

Read the current version:
\`\`\`bash
npm pkg get version
\`\`\`

Ask the user or infer from changes:
- **patch** (0.0.X): Bug fixes, small changes, performance tweaks
- **minor** (0.X.0): New features, non-breaking changes
- **major** (X.0.0): Breaking changes, major rewrites

#### Bump the Version

\`\`\`bash
npm version <patch|minor|major> --no-git-tag-version
\`\`\`

---

### Phase 5: Update Changelog

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

### Phase 6: Commit, Tag, Push

#### Stage and Commit

\`\`\`bash
git add package.json package-lock.json CHANGELOG.md
git add -A  # include any other changed files

git diff --cached --stat  # show what will be committed
\`\`\`

Show the staged changes summary to the user before committing.

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

### Phase 7: GitHub Release

Create the GitHub release using the \`gh\` CLI:

\`\`\`bash
gh release create v<VERSION> --title "v<VERSION>" --notes "<RELEASE_NOTES>"
\`\`\`

**Release notes format:**
\`\`\`markdown
## What's New

### Added
- Feature descriptions

### Changed
- Changes and improvements

### Fixed
- Bug fixes

## Technical Details
- Implementation notes
- Architecture changes
\`\`\`

#### Attach APK to Release (if built)

If an APK was built, attach it to the GitHub release:

\`\`\`bash
gh release upload v<VERSION> android/app/build/outputs/apk/release/app-release-unsigned.apk --clobber
\`\`\`

Or for debug APK:
\`\`\`bash
gh release upload v<VERSION> android/app/build/outputs/apk/debug/app-debug.apk --clobber
\`\`\`

---

## Partial Workflows

The skill also supports running individual phases:

### Quality Check Only

When asked to "check quality", "run checks", "lint and test", or "pre-release check":

Run Phase 2 only (lint, type-check, tests). Report results without proceeding further.

### Build Only

When asked to "build", "build everything", or "build apk":

Run Phase 3 only. Skip version bump and release.

### Tag and Release Only

When asked to "tag", "create release", or "push release" (when version is already bumped):

Skip Phases 2-4, run Phases 5-7 only.

---

## Failure Handling

- **Lint warnings/errors**: STOP, report the lint output, do NOT auto-fix
- **Type errors**: STOP, report the errors, do NOT auto-fix
- **Test failures**: STOP, report failing tests, do NOT auto-fix
- **Build failure**: STOP, report the build error
- **APK build failure**: STOP, report the error (often SDK/Gradle issues)
- **Git conflicts**: STOP, list conflicting files, ask user to resolve manually
- **Push rejected**: STOP, report the rejection reason (likely needs pull first)

**Critical rule**: When any step fails, do NOT proceed to subsequent steps. Report the failure clearly and wait for user instructions.

---

## Quick Reference

| Phase | Command | Gate |
|-------|---------|------|
| Lint | \`npm run lint\` | Zero warnings |
| Types | \`npm run lint:types\` | Zero errors |
| Tests | \`npm test\` | All passing |
| Build | \`npm run build\` | Exit code 0 |
| APK Debug | \`make apk\` | Exit code 0 |
| APK Release | \`make apk-release\` | Exit code 0 |
| Version | \`npm version <type> --no-git-tag-version\` | - |
| Tag | \`git tag -a v<VER> -m "..."\` | - |
| Push | \`git push origin <branch> && git push origin v<VER>\` | - |
| GH Release | \`gh release create v<VER> --notes "..."\` | - |
| Attach APK | \`gh release upload v<VER> <apk-path> --clobber\` | - |

---

## Version Guidelines

- **0.x.x** - Pre-release, API may change
- **1.0.0** - First stable release
- **x.Y.0** - New features (backwards compatible)
- **x.x.Z** - Bug fixes only

When unsure about version type, ask the user:
> "What type of release is this?
> - **patch** (bug fixes only)
> - **minor** (new features, no breaking changes)
> - **major** (breaking changes)"`,
};

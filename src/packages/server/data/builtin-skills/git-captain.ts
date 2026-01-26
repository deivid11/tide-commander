import type { BuiltinSkillDefinition } from './types.js';

export const gitCaptain: BuiltinSkillDefinition = {
  slug: 'git-captain',
  name: 'Git Captain',
  description: 'Use this skill for Git operations: committing changes, updating versions, managing changelogs, creating tags, pulling remote changes, and handling merge conflicts safely.',
  allowedTools: ['Bash(git:*)', 'Bash(npm:*)', 'Read', 'Edit', 'Grep', 'Glob'],
  content: `# Git Captain

A comprehensive Git workflow skill for version management, changelogs, tagging, and safe collaboration.

## Core Principles

1. **Never force push** to shared branches (main, master, develop)
2. **Never auto-resolve conflicts** - always report them to the user
3. **Always verify** the current branch before operations
4. **Always show diffs** before committing
5. **Keep changelogs organized** and human-readable

---

## Workflow: Upload Changes (Commit, Version, Changelog, Tag)

When asked to "upload changes", "release", "bump version", or similar:

### Step 1: Check Current State

\`\`\`bash
# Check we're on the right branch and have no conflicts
git status
git branch --show-current
\`\`\`

If there are untracked files or changes, list them for the user.

### Step 2: Pull Latest Changes First

\`\`\`bash
# Always pull before pushing to avoid conflicts
git pull --rebase origin $(git branch --show-current)
\`\`\`

**If conflicts occur:** STOP immediately and report to user:
> "Merge conflicts detected. Please resolve these manually:
> [list conflicting files]
> After resolving, run \`git add <files>\` and \`git rebase --continue\`"

### Step 3: Review Changes

\`\`\`bash
# Show what will be committed
git diff --stat
git diff
\`\`\`

Present a summary of changes to the user.

### Step 4: Determine Version Bump

Ask the user or infer from changes:
- **patch** (0.0.X): Bug fixes, small changes
- **minor** (0.X.0): New features, non-breaking changes
- **major** (X.0.0): Breaking changes, major rewrites

Read current version from \`package.json\`:
\`\`\`bash
cat package.json | grep '"version"'
\`\`\`

### Step 5: Update Version

\`\`\`bash
# Use npm version (updates package.json and creates git tag)
npm version <patch|minor|major> --no-git-tag-version
\`\`\`

Or manually edit package.json if npm is not available.

### Step 6: Update Changelog

Look for \`CHANGELOG.md\` in the project root. If it doesn't exist, create one.

**Changelog Format:**
\`\`\`markdown
# Changelog

All notable changes to this project will be documented in this file.

## [X.Y.Z] - YYYY-MM-DD

### Added
- New feature descriptions

### Changed
- Changes to existing functionality

### Fixed
- Bug fixes

### Removed
- Removed features

### Security
- Security-related changes

### Deprecated
- Features that will be removed in future versions
\`\`\`

**How to categorize commits:**
- \`feat:\` or \`add:\` -> Added
- \`fix:\` or \`bugfix:\` -> Fixed
- \`change:\` or \`update:\` or \`refactor:\` -> Changed
- \`remove:\` or \`delete:\` -> Removed
- \`security:\` -> Security
- \`deprecate:\` -> Deprecated

Read recent commits to summarize:
\`\`\`bash
git log --oneline -20
\`\`\`

### Step 7: Stage and Commit

\`\`\`bash
# Stage all changes including version and changelog
git add package.json CHANGELOG.md
git add -A  # or specific files

# Create commit with conventional format
git commit -m "chore(release): v<VERSION>

- Summary of main changes
- Another change

Co-Authored-By: Claude <noreply@anthropic.com>"
\`\`\`

### Step 8: Create Tag

\`\`\`bash
# Create annotated tag
git tag -a v<VERSION> -m "Release v<VERSION>

Highlights:
- Main feature or fix
- Another highlight"
\`\`\`

### Step 9: Push Changes and Tags

\`\`\`bash
# Push commits
git push origin $(git branch --show-current)

# Push tags
git push origin v<VERSION>
\`\`\`

### Step 10: Create GitHub Release

After pushing the tag, create a GitHub release to make it visible in the "Releases" tab:

\`\`\`bash
# Create GitHub release with notes
gh release create v<VERSION> --notes "<RELEASE_NOTES>"
\`\`\`

**Release notes format:**
\`\`\`markdown
## Highlights

### ✨ Feature Name
Brief description of what was added.

### 🐛 Bug Fixes
Description of bugs fixed.

## Changes
- Bullet point of changes
- Another change

## Technical Details
- Technical implementation note
- Architecture changes
\`\`\`

---

## Workflow: Download Changes (Pull/Sync)

When asked to "pull", "sync", "download changes", or "update from remote":

### Step 1: Stash Local Changes (if any)

\`\`\`bash
git status
# If there are uncommitted changes:
git stash push -m "Auto-stash before pull $(date +%Y%m%d-%H%M%S)"
\`\`\`

### Step 2: Fetch and Pull

\`\`\`bash
git fetch origin
git pull --rebase origin $(git branch --show-current)
\`\`\`

### Step 3: Handle Conflicts

**If conflicts occur:** STOP and report to user:

> "Merge conflicts detected during pull. The following files have conflicts:
>
> [list files from \`git diff --name-only --diff-filter=U\`]
>
> **Do not attempt to auto-resolve.** Please:
> 1. Open each file and look for \`<<<<<<<\`, \`=======\`, \`>>>>>>>\` markers
> 2. Decide which changes to keep
> 3. Remove the conflict markers
> 4. Run \`git add <resolved-files>\`
> 5. Run \`git rebase --continue\`
>
> If you want to abort: \`git rebase --abort\`"

### Step 4: Restore Stashed Changes

\`\`\`bash
# If we stashed earlier
git stash pop
\`\`\`

If stash pop causes conflicts, report to user.

---

## Workflow: Check Status

When asked about git status, branch info, or repository state:

\`\`\`bash
# Comprehensive status check
echo "=== Branch ===" && git branch -vv
echo ""
echo "=== Status ===" && git status -sb
echo ""
echo "=== Recent Commits ===" && git log --oneline -5
echo ""
echo "=== Remote ===" && git remote -v
\`\`\`

---

## Safety Rules

1. **NEVER run these commands without explicit user permission:**
   - \`git push --force\` or \`git push -f\`
   - \`git reset --hard\`
   - \`git clean -fd\`
   - \`git checkout .\` (discards all changes)
   - \`git branch -D\` (force delete branch)

2. **ALWAYS stop and report to user when:**
   - Merge conflicts are detected
   - Rebase conflicts occur
   - Push is rejected
   - Branch is behind remote by many commits (>10)

3. **ALWAYS verify before destructive operations:**
   - Confirm branch name before pushing
   - Show diff before committing
   - List files before \`git add -A\`

---

## Quick Reference Commands

| Action | Command |
|--------|---------|
| Check status | \`git status -sb\` |
| View diff | \`git diff\` |
| View staged diff | \`git diff --cached\` |
| Recent commits | \`git log --oneline -10\` |
| Current branch | \`git branch --show-current\` |
| List branches | \`git branch -a\` |
| List tags | \`git tag -l\` |
| Undo last commit (keep changes) | \`git reset --soft HEAD~1\` |
| Discard file changes | \`git checkout -- <file>\` |
| Create branch | \`git checkout -b <name>\` |
| Switch branch | \`git checkout <name>\` |

---

## Version Number Guidelines

- **0.x.x** - Pre-release, API may change
- **1.0.0** - First stable release
- **x.Y.0** - New features added (backwards compatible)
- **x.x.Z** - Bug fixes only

When in doubt about version type, ask the user:
> "What type of release is this?
> - **patch** (bug fixes only)
> - **minor** (new features, no breaking changes)
> - **major** (breaking changes)"`,
};

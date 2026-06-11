import type { BuiltinSkillDefinition } from './types.js';

export const gitCaptain: BuiltinSkillDefinition = {
  slug: 'git-captain',
  name: 'Git Captain',
  description: 'Use this skill for Git operations: committing changes, updating versions, managing changelogs, creating tags, pulling remote changes, and handling merge conflicts safely.',
  allowedTools: ['Bash(git:*)', 'Bash(npm:*)', 'Read', 'Edit', 'Grep', 'Glob'],
  content: `# Git Captain

Git workflow skill: version management, changelogs, tagging, safe collaboration.

## Core Principles

1. Never force push to shared branches (main, master, develop)
2. Never auto-resolve conflicts — report them to the user
3. Verify the current branch before operations
4. Show diffs before committing
5. Keep changelogs organized and human-readable
6. NEVER add Co-Authored-By trailers — commits are purely yours, no AI attribution

## Workflow: Upload Changes (Commit, Version, Changelog, Tag)

For "upload changes", "release", "bump version", or similar:

**1. Check state** — list any untracked/changed files for the user:
\`\`\`bash
git status
git branch --show-current
\`\`\`

**2. Pull first** to avoid conflicts:
\`\`\`bash
git pull --rebase origin $(git branch --show-current)
\`\`\`
On conflicts: STOP, report the conflicting files, and tell the user to resolve manually, then run \`git add <files>\` and \`git rebase --continue\`.

**3. Review changes** and summarize for the user:
\`\`\`bash
git diff --stat
git diff
\`\`\`

**4. Determine version bump** (ask the user or infer): patch (0.0.X) bug fixes/small changes; minor (0.X.0) new features, non-breaking; major (X.0.0) breaking changes/major rewrites. Read current version:
\`\`\`bash
cat package.json | grep '"version"'
\`\`\`

**5. Update version** (or edit package.json manually if npm is unavailable):
\`\`\`bash
npm version <patch|minor|major> --no-git-tag-version
\`\`\`

**6. Update changelog** — \`CHANGELOG.md\` in project root; create if missing:
\`\`\`markdown
# Changelog

All notable changes to this project will be documented in this file.

## [X.Y.Z] - YYYY-MM-DD

### Added
### Changed
### Fixed
### Removed
### Security
### Deprecated
\`\`\`
Categorize commits: \`feat:\`/\`add:\` → Added; \`fix:\`/\`bugfix:\` → Fixed; \`change:\`/\`update:\`/\`refactor:\` → Changed; \`remove:\`/\`delete:\` → Removed; \`security:\` → Security; \`deprecate:\` → Deprecated. Summarize from \`git log --oneline -20\`.

**7. Stage and commit:**
\`\`\`bash
git add package.json CHANGELOG.md
git add -A  # or specific files

git commit -m "chore(release): v<VERSION>

- Summary of main changes
- Another change"
\`\`\`

**8. Create annotated tag:**
\`\`\`bash
git tag -a v<VERSION> -m "Release v<VERSION>

Highlights:
- Main feature or fix
- Another highlight"
\`\`\`

**9. Push commits and tag:**
\`\`\`bash
git push origin $(git branch --show-current)
git push origin v<VERSION>
\`\`\`

**10. Create GitHub release** (makes it visible in the Releases tab):
\`\`\`bash
gh release create v<VERSION> --notes "<RELEASE_NOTES>"
\`\`\`
Notes format: \`## Highlights\` (feature/fix subsections), \`## Changes\` (bullets), \`## Technical Details\` (implementation/architecture notes).

## Workflow: Download Changes (Pull/Sync)

For "pull", "sync", "download changes", "update from remote":

1. \`git status\`; if uncommitted changes exist: \`git stash push -m "Auto-stash before pull $(date +%Y%m%d-%H%M%S)"\`
2. \`git fetch origin\` then \`git pull --rebase origin $(git branch --show-current)\`
3. On conflicts: STOP and report files from \`git diff --name-only --diff-filter=U\`. Do NOT auto-resolve. Tell the user to: open each file and resolve the \`<<<<<<<\` / \`=======\` / \`>>>>>>>\` markers, run \`git add <resolved-files>\`, then \`git rebase --continue\` (abort with \`git rebase --abort\`).
4. If stashed earlier: \`git stash pop\` (report any pop conflicts to the user).

## Workflow: Check Status

\`\`\`bash
echo "=== Branch ===" && git branch -vv
echo ""
echo "=== Status ===" && git status -sb
echo ""
echo "=== Recent Commits ===" && git log --oneline -5
echo ""
echo "=== Remote ===" && git remote -v
\`\`\`

## Safety Rules

1. NEVER without explicit user permission: \`git push --force\` / \`git push -f\`, \`git reset --hard\`, \`git clean -fd\`, \`git checkout .\` (discards all changes), \`git branch -D\` (force delete branch).
2. ALWAYS stop and report: merge/rebase conflicts, rejected push, branch behind remote by many commits (>10).
3. Before destructive operations: confirm branch name before pushing, show diff before committing, list files before \`git add -A\`.

## Quick Reference

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

## Version Guidelines

0.x.x pre-release (API may change); 1.0.0 first stable; x.Y.0 new backwards-compatible features; x.x.Z bug fixes only. When in doubt, ask the user: patch (bug fixes only) / minor (new features, no breaking changes) / major (breaking changes).`,
};

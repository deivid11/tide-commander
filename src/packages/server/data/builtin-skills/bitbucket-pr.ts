import type { BuiltinSkillDefinition } from './types.js';

export const bitbucketPR: BuiltinSkillDefinition = {
  slug: 'bitbucket-pr',
  name: 'Bitbucket PR',
  description: 'Create pull requests on Bitbucket using API token authentication (Basic auth). Use this skill when asked to create PRs, merge requests, or submit code for review on Bitbucket.',
  allowedTools: ['Bash(curl:*)', 'Bash(git:*)', 'Read', 'Grep', 'Glob'],
  content: `# Bitbucket Pull Request Creator

Create pull requests on Bitbucket Cloud via curl with API token authentication (HTTP Basic). Bitbucket deprecated App Passwords in September 2025; existing app passwords are disabled on June 9, 2026 — use API tokens with scopes.

## Required Secrets (Tide Commander Toolbox > Secrets)

- \`BITBUCKET_EMAIL\` — Atlassian account email
- \`BITBUCKET_TOKEN\` — Bitbucket API token with repo and PR scopes

**Create a token:** Bitbucket > Settings (cog) > Personal settings > Atlassian account settings > **Security** tab > **Create and manage API tokens** > **Create API token with scopes** > name + expiry > select **Bitbucket** as the app > minimum scopes:
- \`read:repository:bitbucket\` (view repo info/branches), \`write:repository:bitbucket\` (push branches)
- \`read:pullrequest:bitbucket\` (view PRs), \`write:pullrequest:bitbucket\` (create/merge/approve/decline/comment)

Copy the token immediately (shown only once); store as \`BITBUCKET_TOKEN\`, plus your email as \`BITBUCKET_EMAIL\`.

**Auth format:** HTTP Basic — \`Authorization: Basic <base64 of EMAIL:TOKEN>\`. In curl, use \`-u\` with the secret placeholders:
\`\`\`bash
curl -s -u "{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}" ...
\`\`\`

## IMPORTANT: All API Calls Must Use Streaming Exec

Secret placeholders \`{{BITBUCKET_EMAIL}}\` / \`{{BITBUCKET_TOKEN}}\` are ONLY replaced when commands run through the Streaming Exec API (\`/api/exec\`). Direct Bash curl sends raw placeholders and fails auth — a 401 most likely means curl ran outside \`/api/exec\`. Wrap every curl that uses \`{{SECRET}}\` placeholders, and also git push / other long-running operations:

\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"curl -s -u \\"{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}\\" https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests"}'
\`\`\`

## Variables

| Variable | Source | Used in |
|----------|--------|---------|
| \`WORKSPACE\`, \`REPO_SLUG\` | extracted from git remote URL | all API URLs |
| \`SOURCE_BRANCH\` | \`git branch --show-current\` | creating PR |
| \`TARGET_BRANCH\` | user input or default (main/master/dev) | creating PR |
| \`PR_TITLE\`, \`PR_DESCRIPTION\` | user input or context | creating PR |
| \`PR_ID\` | extracted from create-PR API response | merge/approve/decline URLs |
| \`{{BITBUCKET_EMAIL}}\` / \`{{BITBUCKET_TOKEN}}\` | secrets | \`-u\` flag in all curls |

\`\`\`bash
REMOTE_URL=$(git remote get-url origin)
# HTTPS: https://bitbucket.org/WORKSPACE/REPO.git — SSH: git@bitbucket.org:WORKSPACE/REPO.git
WORKSPACE=$(echo "$REMOTE_URL" | sed -E 's|.*[:/]([^/]+)/[^/]+\\.git$|\\1|')
REPO_SLUG=$(echo "$REMOTE_URL" | sed -E 's|.*[:/][^/]+/([^/]+)\\.git$|\\1|')
\`\`\`

Never hardcode placeholders: use bash variables (\`$WORKSPACE\`, \`$REPO_SLUG\`, \`$PR_ID\`) in URLs; \`{{...}}\` is for secrets only.

## Workflow: Create Pull Request

1. **Set variables** — extract \`WORKSPACE\`/\`REPO_SLUG\` as above; \`SOURCE_BRANCH=$(git branch --show-current)\`; pick \`TARGET_BRANCH\`; run \`git status\` to check for unpushed commits.
2. **Push the branch:** \`git push -u origin $(git branch --show-current)\`
3. **Gather PR details** (ask user or infer from context): title, description (markdown), target branch (usually \`main\`/\`master\`), optional reviewers (Bitbucket account IDs).
4. **MANDATORY — confirm before submitting:** present source branch, target branch, title, description, and reviewers to the user and wait for explicit approval (e.g. "yes", "go ahead"). Do NOT proceed without it.
5. **Create the PR:**
\`\`\`bash
RESPONSE=$(curl -s -X POST \\
  -u "{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}" \\
  -H "Content-Type: application/json" \\
  "https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests" \\
  -d "$(cat <<EOF
{
  "title": "$PR_TITLE",
  "description": "$PR_DESCRIPTION",
  "source": { "branch": { "name": "$SOURCE_BRANCH" } },
  "destination": { "branch": { "name": "$TARGET_BRANCH" } },
  "close_source_branch": true
}
EOF
)")
\`\`\`
6. **Parse the response**, then report the PR URL to the user:
\`\`\`bash
PR_ID=$(echo "$RESPONSE" | grep -o '"id": [0-9]*' | head -1 | grep -o '[0-9]*')
PR_URL=$(echo "$RESPONSE" | grep -o '"href": "https://bitbucket.org[^"]*' | sed 's/"href": "//')
\`\`\`
Use \`$PR_ID\` in place of \`{pr_id}\` in subsequent merge/approve/decline calls.

## Add Reviewers

Include in the create body:
\`\`\`json
{ "title": "PR Title", "reviewers": [ {"account_id": "557058:12345678-1234-1234-1234-123456789012"} ], ... }
\`\`\`
Find account IDs: \`GET https://api.bitbucket.org/2.0/workspaces/$WORKSPACE/members\`

## Other Endpoints

Base URL: \`https://api.bitbucket.org/2.0/repositories/{workspace}/{repo_slug}\`. All calls use \`-u "{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}"\` via /api/exec; POSTs with a body also need \`-H "Content-Type: application/json"\`.

| Action | Method + Path | Body |
|--------|---------------|------|
| Create PR | POST \`/pullrequests\` | see workflow |
| List open PRs | GET \`/pullrequests?state=OPEN\` | — |
| Get PR | GET \`/pullrequests/$PR_ID\` | — |
| Approve | POST \`/pullrequests/$PR_ID/approve\` | — |
| Merge | POST \`/pullrequests/$PR_ID/merge\` | \`{"merge_strategy":"squash","close_source_branch":true,"message":"Merged PR: Title"}\` |
| Decline | POST \`/pullrequests/$PR_ID/decline\` | — |
| Comment | POST \`/pullrequests/$PR_ID/comments\` | \`{"content":{"raw":"Your comment here"}}\` |

Merge strategies: \`merge_commit\` (standard), \`squash\` (squash all commits), \`fast_forward\` (fast-forward if possible).

## Error Handling

| HTTP | Meaning | Solution |
|------|---------|----------|
| 401 | Unauthorized | Check secrets are valid/not expired; confirm curl ran via /api/exec |
| 403 | Forbidden | Token lacks required repo/PR scopes |
| 404 | Not Found | Check workspace/repo slug |
| 400 | Bad Request | Check JSON payload format |
| 409 | Conflict | PR already exists for this branch |

Debug with \`curl -v\`.

## Safety Rules

1. NEVER commit credentials — always use \`{{SECRET}}\` placeholders.
2. ALWAYS verify the target branch and push the source branch before creating a PR.
3. CHECK for existing PRs before creating duplicates.
4. REQUIRE explicit user approval before creating a PR (workflow step 4), and confirm with the user before merging or declining.`,
};

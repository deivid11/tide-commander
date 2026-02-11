import type { BuiltinSkillDefinition } from './types.js';

export const bitbucketPR: BuiltinSkillDefinition = {
  slug: 'bitbucket-pr',
  name: 'Bitbucket PR',
  description: 'Create pull requests on Bitbucket using API token authentication (Basic auth). Use this skill when asked to create PRs, merge requests, or submit code for review on Bitbucket.',
  allowedTools: ['Bash(curl:*)', 'Bash(git:*)', 'Read', 'Grep', 'Glob'],
  content: `# Bitbucket Pull Request Creator

Create pull requests on Bitbucket Cloud using curl API requests with API token authentication (Basic auth).

> **Note:** Bitbucket deprecated App Passwords in September 2025. This skill uses the new API tokens with scopes.
> All existing app passwords will be disabled on June 9, 2026.

## Required Secrets

This skill requires the following secrets to be configured in Tide Commander's Toolbox > Secrets:

| Secret Key | Description |
|------------|-------------|
| \`BITBUCKET_EMAIL\` | Your Atlassian account email address |
| \`BITBUCKET_TOKEN\` | Bitbucket API token with repo and PR scopes |

**Setting up a Bitbucket API Token:**
1. Go to Bitbucket > Settings (cog icon) > Personal settings > Atlassian account settings
2. Select the **Security** tab
3. Click **Create and manage API tokens**
4. Click **Create API token with scopes**
5. Give it a name and expiry date, then select **Next**
6. Select **Bitbucket** as the app and continue
7. Choose these scopes (minimum required):
   - \`read:repository:bitbucket\` - View repo info and branches
   - \`write:repository:bitbucket\` - Push branches
   - \`read:pullrequest:bitbucket\` - View pull requests
   - \`write:pullrequest:bitbucket\` - Create, merge, approve, decline, comment on PRs
8. Review and click **Create token**
9. Copy the token immediately (it is only shown once)
10. Add it to Tide Commander secrets as \`BITBUCKET_TOKEN\`
11. Also add your Atlassian email as \`BITBUCKET_EMAIL\`

**Authentication format:** Bitbucket API tokens use HTTP Basic auth. The curl header is built as:
\`\`\`
Authorization: Basic <base64 of EMAIL:TOKEN>
\`\`\`

In curl commands, use the \`-u\` flag with the secret placeholders:
\`\`\`bash
curl -s -u "{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}" ...
\`\`\`

---

## Integration with Streaming Exec

For long-running git operations (like pushing large branches), use the **Streaming Command Execution** skill to stream output to the terminal. Example:

\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"git push -u origin feature-branch"}'
\`\`\`

---

## Key Variables Reference

Before making any API calls, agents must gather and set these shell variables:

| Variable | Source | Example | Used In |
|----------|--------|---------|---------|
| \`WORKSPACE\` | Extract from git remote URL | \`mycompany\` | All API URLs |
| \`REPO_SLUG\` | Extract from git remote URL | \`my-project\` | All API URLs |
| \`SOURCE_BRANCH\` | \`git branch --show-current\` | \`feature/new-ui\` | Creating PR |
| \`TARGET_BRANCH\` | User input or default | \`main\` | Creating PR |
| \`PR_TITLE\` | User input | \`feat: Add new feature\` | Creating PR |
| \`PR_ID\` | Extract from API response | \`42\` | Merge/Approve/Decline |
| \`{{BITBUCKET_EMAIL}}\` | Secret (Toolbox > Secrets) | \`user@example.com\` | All curl requests (-u flag) |
| \`{{BITBUCKET_TOKEN}}\` | Secret (Toolbox > Secrets) | \`ATATT3x...\` | All curl requests (-u flag) |

**How to extract workspace/repo from remote:**
\`\`\`bash
REMOTE_URL=$(git remote get-url origin)
# HTTPS: https://bitbucket.org/WORKSPACE/REPO.git
# SSH: git@bitbucket.org:WORKSPACE/REPO.git
WORKSPACE=$(echo "$REMOTE_URL" | sed -E 's|.*[:/]([^/]+)/[^/]+\\.git$|\\1|')
REPO_SLUG=$(echo "$REMOTE_URL" | sed -E 's|.*[:/][^/]+/([^/]+)\\.git$|\\1|')
\`\`\`

**How to extract PR_ID from create response:**
\`\`\`bash
# From create PR response, extract the PR ID
PR_ID=$(echo "$RESPONSE" | grep -o '"id": [0-9]*' | head -1 | grep -o '[0-9]*')
\`\`\`

---

## Workflow: Create Pull Request

When asked to "create PR", "make pull request", "submit for review" on Bitbucket:

### Step 1: Gather Information & Set Variables

First, collect the required information and set shell variables:

\`\`\`bash
# Get current branch
SOURCE_BRANCH=$(git branch --show-current)
echo "Source branch: $SOURCE_BRANCH"

# Get remote URL to extract workspace/repo
REMOTE_URL=$(git remote get-url origin)
echo "Remote URL: $REMOTE_URL"

# Extract workspace and repo slug from remote URL
# From HTTPS: https://bitbucket.org/WORKSPACE/REPO.git → WORKSPACE and REPO
# From SSH: git@bitbucket.org:WORKSPACE/REPO.git → WORKSPACE and REPO
WORKSPACE=$(echo "$REMOTE_URL" | sed -E 's|.*[:/]([^/]+)/[^/]+\\.git$|\\1|')
REPO_SLUG=$(echo "$REMOTE_URL" | sed -E 's|.*[:/][^/]+/([^/]+)\\.git$|\\1|')
TARGET_BRANCH="main"  # Or "master", "dev", etc.

echo "Workspace: $WORKSPACE"
echo "Repo: $REPO_SLUG"
echo "Target branch: $TARGET_BRANCH"

# Check for unpushed commits
git status
\`\`\`

**Variables set by agent before API calls:**
- \`WORKSPACE\`: Bitbucket workspace (extracted from remote URL)
- \`REPO_SLUG\`: Repository name (extracted from remote URL)
- \`SOURCE_BRANCH\`: Current branch being merged
- \`TARGET_BRANCH\`: Destination branch (main, master, dev, etc.)
- \`PR_ID\`: From previous API call response (for merge/approve/decline operations)

### Step 2: Ensure Branch is Pushed

\`\`\`bash
# Push current branch to remote
git push -u origin $(git branch --show-current)
\`\`\`

### Step 3: Gather PR Details

Ask the user for (or infer from context):
- **Title**: Brief description of the change
- **Description**: Detailed explanation
- **Target branch**: Usually \`main\` or \`master\`
- **Reviewers**: Optional, Bitbucket account IDs

### Step 4: Confirm with User Before Submitting

**MANDATORY:** Before sending the API request, present a summary to the user and wait for explicit approval:

- **Source branch:** \`$SOURCE_BRANCH\`
- **Target branch:** \`$TARGET_BRANCH\`
- **Title:** The PR title
- **Description:** The PR description
- **Reviewers:** If any

Do NOT proceed until the user explicitly confirms (e.g., "yes", "go ahead", "send it").

### Step 5: Create the Pull Request

\`\`\`bash
curl -s -X POST \\
  -u "{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}" \\
  -H "Content-Type: application/json" \\
  "https://api.bitbucket.org/2.0/repositories/{workspace}/{repo_slug}/pullrequests" \\
  -d '{
    "title": "PR_TITLE",
    "description": "PR_DESCRIPTION",
    "source": {
      "branch": {
        "name": "SOURCE_BRANCH"
      }
    },
    "destination": {
      "branch": {
        "name": "TARGET_BRANCH"
      }
    },
    "close_source_branch": true
  }'
\`\`\`

**Replace placeholders:**
- \`{workspace}\`: Bitbucket workspace (e.g., "mycompany")
- \`{repo_slug}\`: Repository name (e.g., "my-project")
- \`PR_TITLE\`: Title of the PR
- \`PR_DESCRIPTION\`: Description in markdown
- \`SOURCE_BRANCH\`: Your feature branch
- \`TARGET_BRANCH\`: Usually "main" or "master"

### Step 6: Parse Response & Extract PR ID

On success, extract the PR ID and URL from the response:

\`\`\`bash
# Save response to variable
RESPONSE=$(curl -s -X POST \\
  -u "{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}" \\
  -H "Content-Type: application/json" \\
  "https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests" \\
  -d '{...}')

# Extract PR ID from response (needed for merge/approve/decline)
PR_ID=$(echo "$RESPONSE" | grep -o '"id": [0-9]*' | head -1 | grep -o '[0-9]*')

# Extract PR URL
PR_URL=$(echo "$RESPONSE" | grep -o '"href": "https://bitbucket.org[^"]*' | sed 's/"href": "//')

echo "PR ID: $PR_ID"
echo "PR URL: $PR_URL"
\`\`\`

**For subsequent operations (merge, approve, decline), use:**
- \`$PR_ID\` to reference the created PR in later API calls
- Replace \`{pr_id}\` in URLs with the actual PR ID value

Report the PR URL to the user.

---

## Complete Example Script

\`\`\`bash
# Variables (gather these first)
WORKSPACE="myworkspace"
REPO_SLUG="myrepo"
SOURCE_BRANCH=$(git branch --show-current)
TARGET_BRANCH="main"
PR_TITLE="feat: Add new feature"
PR_DESCRIPTION="## Summary\\n\\n- Added X\\n- Fixed Y\\n\\n## Testing\\n\\n- Ran unit tests"

# Create PR using Basic auth (API token)
curl -s -X POST \\
  -u "{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}" \\
  -H "Content-Type: application/json" \\
  "https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests" \\
  -d "$(cat <<EOF
{
  "title": "$PR_TITLE",
  "description": "$PR_DESCRIPTION",
  "source": {
    "branch": {
      "name": "$SOURCE_BRANCH"
    }
  },
  "destination": {
    "branch": {
      "name": "$TARGET_BRANCH"
    }
  },
  "close_source_branch": true
}
EOF
)"
\`\`\`

---

## Add Reviewers

To add reviewers, include them in the request:

\`\`\`json
{
  "title": "PR Title",
  "reviewers": [
    {"account_id": "557058:12345678-1234-1234-1234-123456789012"},
    {"account_id": "557058:abcdefgh-abcd-abcd-abcd-abcdefghijkl"}
  ],
  ...
}
\`\`\`

**Find reviewer account IDs:**
\`\`\`bash
# List workspace members
curl -s -u "{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}" \\
  "https://api.bitbucket.org/2.0/workspaces/$WORKSPACE/members"
\`\`\`

---

## Other Useful API Endpoints

### List Open PRs

\`\`\`bash
curl -s -u "{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}" \\
  "https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests?state=OPEN"
\`\`\`

### Get PR Details

\`\`\`bash
curl -s -u "{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}" \\
  "https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests/$PR_ID"
\`\`\`

### Approve a PR

\`\`\`bash
curl -s -X POST \\
  -u "{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}" \\
  "https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests/$PR_ID/approve"
\`\`\`

### Merge a PR

\`\`\`bash
curl -s -X POST \\
  -u "{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}" \\
  -H "Content-Type: application/json" \\
  "https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests/$PR_ID/merge" \\
  -d '{
    "merge_strategy": "squash",
    "close_source_branch": true,
    "message": "Merged PR: Title"
  }'
\`\`\`

**Merge strategies:**
- \`merge_commit\`: Standard merge
- \`squash\`: Squash all commits
- \`fast_forward\`: Fast-forward if possible

### Decline a PR

\`\`\`bash
curl -s -X POST \\
  -u "{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}" \\
  "https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests/$PR_ID/decline"
\`\`\`

### Add Comment to PR

\`\`\`bash
curl -s -X POST \\
  -u "{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}" \\
  -H "Content-Type: application/json" \\
  "https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests/$PR_ID/comments" \\
  -d '{
    "content": {
      "raw": "Your comment here"
    }
  }'
\`\`\`

---

## Error Handling

Common errors and solutions:

| HTTP Code | Meaning | Solution |
|-----------|---------|----------|
| 401 | Unauthorized | Check BITBUCKET_EMAIL and BITBUCKET_TOKEN secrets are valid and not expired |
| 403 | Forbidden | Token lacks required scopes (check repo and PR scopes) |
| 404 | Not Found | Check workspace/repo slug |
| 400 | Bad Request | Check JSON payload format |
| 409 | Conflict | PR already exists for this branch |

**Debug requests:**
\`\`\`bash
# Add -v for verbose output
curl -v -X POST ...
\`\`\`

---

## Agent Variable Management

When implementing PR workflows, agents should:

1. **Initialize variables from git repo:**
   - Extract \`WORKSPACE\` and \`REPO_SLUG\` from remote URL
   - Get \`SOURCE_BRANCH\` from \`git branch --show-current\`

2. **Collect from user/context:**
   - Ask for \`TARGET_BRANCH\` (default: main)
   - Ask for \`PR_TITLE\` and \`PR_DESCRIPTION\`

3. **Extract from API responses:**
   - After creating PR, extract \`PR_ID\` from response JSON
   - Use \`PR_ID\` in subsequent operations (merge, approve, decline)

4. **Never hardcode placeholders:**
   - Use bash variable substitution: \`$WORKSPACE\`, \`$REPO_SLUG\`, \`$PR_ID\`
   - Secret placeholders only: \`{{BITBUCKET_EMAIL}}\` and \`{{BITBUCKET_TOKEN}}\`

## Safety Rules

1. **NEVER commit credentials** to the repository - always use \`{{SECRET}}\` placeholders
2. **ALWAYS verify** the target branch before creating PR
3. **ALWAYS push** the source branch before creating PR
4. **CHECK** for existing PRs before creating duplicates
5. **REQUIRE EXPLICIT USER APPROVAL** before creating a PR - show the user the title, description, source branch, target branch, and reviewers, then wait for their explicit confirmation before sending the API request
6. **CONFIRM** with user before merging or declining PRs
7. **SET VARIABLES** - Extract workspace/repo from git, PR_ID from API responses, before using in URLs

---

## Quick Reference

| Action | Endpoint | Method |
|--------|----------|--------|
| Create PR | \`/pullrequests\` | POST |
| List PRs | \`/pullrequests\` | GET |
| Get PR | \`/pullrequests/{id}\` | GET |
| Approve | \`/pullrequests/{id}/approve\` | POST |
| Merge | \`/pullrequests/{id}/merge\` | POST |
| Decline | \`/pullrequests/{id}/decline\` | POST |
| Comment | \`/pullrequests/{id}/comments\` | POST |

Base URL: \`https://api.bitbucket.org/2.0/repositories/{workspace}/{repo_slug}\``,
};

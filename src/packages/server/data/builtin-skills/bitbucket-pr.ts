import type { BuiltinSkillDefinition } from './types.js';

export const bitbucketPR: BuiltinSkillDefinition = {
  slug: 'bitbucket-pr',
  name: 'Bitbucket PR',
  description: 'Create pull requests on Bitbucket using curl. Use this skill when asked to create PRs, merge requests, or submit code for review on Bitbucket.',
  allowedTools: ['Bash(curl:*)', 'Bash(git:*)', 'Read', 'Grep', 'Glob'],
  content: `# Bitbucket Pull Request Creator

Create pull requests on Bitbucket Cloud using curl API requests.

## Required Secrets

This skill requires the following secrets to be configured in Tide Commander's Toolbox > Secrets:

| Secret Key | Description |
|------------|-------------|
| \`BITBUCKET_USERNAME\` | Your Bitbucket username |
| \`BITBUCKET_APP_PASSWORD\` | Bitbucket App Password with repo and PR permissions |

**Setting up Bitbucket App Password:**
1. Go to Bitbucket Settings > App passwords
2. Create a new app password with permissions:
   - Repositories: Read, Write
   - Pull Requests: Read, Write
3. Add it to Tide Commander secrets as \`BITBUCKET_APP_PASSWORD\`

Once configured, use the placeholders \`{{BITBUCKET_USERNAME}}\` and \`{{BITBUCKET_APP_PASSWORD}}\` in your curl commands.

---

## Integration with Streaming Exec

For long-running git operations (like pushing large branches), use the **Streaming Command Execution** skill to stream output to the terminal. Example:

\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"git push -u origin feature-branch"}'
\`\`\`

---

## Workflow: Create Pull Request

When asked to "create PR", "make pull request", "submit for review" on Bitbucket:

### Step 1: Gather Information

First, collect the required information:

\`\`\`bash
# Get current branch
CURRENT_BRANCH=$(git branch --show-current)
echo "Source branch: $CURRENT_BRANCH"

# Get remote URL to extract workspace/repo
git remote -v

# Check for unpushed commits
git status
\`\`\`

**Extract workspace and repo from remote URL:**
- HTTPS: \`https://bitbucket.org/WORKSPACE/REPO.git\`
- SSH: \`git@bitbucket.org:WORKSPACE/REPO.git\`

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

### Step 4: Create the Pull Request

\`\`\`bash
curl -s -X POST \\
  -u "{{BITBUCKET_USERNAME}}:{{BITBUCKET_APP_PASSWORD}}" \\
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

### Step 5: Parse Response

On success, extract the PR URL from the response:

\`\`\`bash
# Response contains: {"links": {"html": {"href": "https://bitbucket.org/..."}}}
# Use jq if available, or grep for the URL
\`\`\`

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

# Create PR using secrets placeholders
curl -s -X POST \\
  -u "{{BITBUCKET_USERNAME}}:{{BITBUCKET_APP_PASSWORD}}" \\
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
curl -s -u "{{BITBUCKET_USERNAME}}:{{BITBUCKET_APP_PASSWORD}}" \\
  "https://api.bitbucket.org/2.0/workspaces/{workspace}/members"
\`\`\`

---

## Other Useful API Endpoints

### List Open PRs

\`\`\`bash
curl -s -u "{{BITBUCKET_USERNAME}}:{{BITBUCKET_APP_PASSWORD}}" \\
  "https://api.bitbucket.org/2.0/repositories/{workspace}/{repo_slug}/pullrequests?state=OPEN"
\`\`\`

### Get PR Details

\`\`\`bash
curl -s -u "{{BITBUCKET_USERNAME}}:{{BITBUCKET_APP_PASSWORD}}" \\
  "https://api.bitbucket.org/2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pr_id}"
\`\`\`

### Approve a PR

\`\`\`bash
curl -s -X POST \\
  -u "{{BITBUCKET_USERNAME}}:{{BITBUCKET_APP_PASSWORD}}" \\
  "https://api.bitbucket.org/2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pr_id}/approve"
\`\`\`

### Merge a PR

\`\`\`bash
curl -s -X POST \\
  -u "{{BITBUCKET_USERNAME}}:{{BITBUCKET_APP_PASSWORD}}" \\
  -H "Content-Type: application/json" \\
  "https://api.bitbucket.org/2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pr_id}/merge" \\
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
  -u "{{BITBUCKET_USERNAME}}:{{BITBUCKET_APP_PASSWORD}}" \\
  "https://api.bitbucket.org/2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pr_id}/decline"
\`\`\`

### Add Comment to PR

\`\`\`bash
curl -s -X POST \\
  -u "{{BITBUCKET_USERNAME}}:{{BITBUCKET_APP_PASSWORD}}" \\
  -H "Content-Type: application/json" \\
  "https://api.bitbucket.org/2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pr_id}/comments" \\
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
| 401 | Unauthorized | Check BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD secrets |
| 403 | Forbidden | App password lacks permissions |
| 404 | Not Found | Check workspace/repo slug |
| 400 | Bad Request | Check JSON payload format |
| 409 | Conflict | PR already exists for this branch |

**Debug requests:**
\`\`\`bash
# Add -v for verbose output
curl -v -X POST ...
\`\`\`

---

## Safety Rules

1. **NEVER commit credentials** to the repository - always use \`{{SECRET}}\` placeholders
2. **ALWAYS verify** the target branch before creating PR
3. **ALWAYS push** the source branch before creating PR
4. **CHECK** for existing PRs before creating duplicates
5. **CONFIRM** with user before merging or declining PRs

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

import type { BuiltinSkillDefinition } from './types.js';

export const bitbucketPRReview: BuiltinSkillDefinition = {
  slug: 'bitbucket-pr-review',
  name: 'Bitbucket PR Review',
  description: 'Read pull request diffs, post review comments (inline or summary), approve or request-changes on Bitbucket Cloud PRs using API token authentication. Use this skill when an automated reviewer agent needs to evaluate a PR and record a verdict.',
  allowedTools: ['Bash(curl:*)', 'Read', 'Grep', 'Glob'],
  content: `# Bitbucket Pull Request Reviewer

Read PR diffs, post review comments, and set verdict (approve / request-changes / clear) on Bitbucket Cloud pull requests via the REST API 2.0.

> **Note:** Bitbucket deprecated App Passwords in September 2025 (disabled June 9, 2026). This skill uses API tokens with scopes.

## Required Secrets

| Secret Key | Description |
|------------|-------------|
| \`BITBUCKET_EMAIL\` | Atlassian account email for the reviewer identity |
| \`BITBUCKET_TOKEN\` | Bitbucket API token with PR review scopes |

**Required scopes:**
- \`read:repository:bitbucket\` — fetch diff
- \`read:pullrequest:bitbucket\` — read PR + comments + participants
- \`write:pullrequest:bitbucket\` — comments, approve/unapprove, request-changes/unrequest-changes

Do **not** request \`write:repository:bitbucket\` — a reviewer must never push.

**Authentication:** HTTP Basic, built from the secret placeholders:
\`\`\`bash
curl -s -u "{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}" ...
\`\`\`

---

## CRITICAL: All API Calls Must Use Streaming Exec

Secret placeholders \`{{BITBUCKET_EMAIL}}\` / \`{{BITBUCKET_TOKEN}}\` are **only** interpolated when commands run through the Streaming Exec API (\`/api/exec\`). Direct Bash curl calls will send the raw \`{{...}}\` placeholders and 401.

**Wrap every curl command:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"curl -s -u \\"{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}\\" https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests/$PR_ID/diff"}'
\`\`\`

If you get a 401, the most likely cause is calling curl directly instead of through \`/api/exec\`.

---

## Common Variables

| Variable | Description | Example |
|----------|-------------|---------|
| \`WORKSPACE\` | Bitbucket workspace slug | \`mycompany\` |
| \`REPO_SLUG\` | Repository slug | \`wind\` |
| \`PR_ID\` | Pull request id | \`42\` |

These typically arrive in the trigger payload (extracted from \`repository.full_name\` and \`pullrequest.id\` by the webhook trigger).

\`\`\`bash
# Split workspace/repo from full_name="myws/wind"
WORKSPACE=$(echo "$REPO_FULL_NAME" | cut -d/ -f1)
REPO_SLUG=$(echo "$REPO_FULL_NAME" | cut -d/ -f2)
\`\`\`

Base URL: \`https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG\`

---

## Action: fetch_pr_diff

Retrieve the unified diff for a pull request.

**Endpoint:** \`GET /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/diff\`

**Input Schema:**
\`\`\`json
{
  "type": "object",
  "required": ["workspace", "repo_slug", "pull_request_id"],
  "properties": {
    "workspace":       { "type": "string", "description": "Bitbucket workspace slug" },
    "repo_slug":       { "type": "string", "description": "Repository slug" },
    "pull_request_id": { "type": "integer", "description": "PR id" },
    "max_bytes":       { "type": "integer", "default": 204800, "description": "Truncate diff at this many bytes (default 200 KB)" }
  }
}
\`\`\`

**Call (200 KB cap, returns JSON \`{ diff, truncated, byte_count }\`):**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"set -euo pipefail; MAX=\${MAX_BYTES:-204800}; RAW=$(curl -s -H \\"Accept: text/plain\\" -u \\"{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}\\" \\"https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests/$PR_ID/diff\\"); LEN=\${#RAW}; if [ \\"$LEN\\" -gt \\"$MAX\\" ]; then DIFF=\${RAW:0:$MAX}; TRUNC=true; else DIFF=$RAW; TRUNC=false; fi; jq -nc --arg d \\"$DIFF\\" --argjson t $TRUNC --argjson l $LEN \\"{diff:\\$d, truncated:\\$t, byte_count:\\$l}\\""}'
\`\`\`

**Output (JSON):**
\`\`\`json
{ "diff": "<unified diff text, truncated to max_bytes>", "truncated": false, "byte_count": 12345 }
\`\`\`

If \`truncated:true\`, include a note in the summary comment that the review was based on a partial diff and recommend splitting the PR.

---

## Action: fetch_pr_diffstat

Retrieve per-file change statistics (additions/removals, file paths). Use as a pre-flight gate before \`fetch_pr_diff\` to skip oversized PRs early.

**Endpoint:** \`GET /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/diffstat\`

**Input Schema:**
\`\`\`json
{
  "type": "object",
  "required": ["workspace", "repo_slug", "pull_request_id"],
  "properties": {
    "workspace":       { "type": "string" },
    "repo_slug":       { "type": "string" },
    "pull_request_id": { "type": "integer" },
    "pagelen":         { "type": "integer", "default": 100, "description": "Page size (max 100)" }
  }
}
\`\`\`

**Call:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"curl -s -u \\"{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}\\" \\"https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests/$PR_ID/diffstat?pagelen=100\\""}'
\`\`\`

**Output (Bitbucket paginated response):**
\`\`\`json
{
  "values": [
    { "type": "diffstat", "status": "modified", "lines_added": 12, "lines_removed": 3,
      "old": { "path": "src/foo.ts" }, "new": { "path": "src/foo.ts" } }
  ],
  "page": 1, "pagelen": 100, "size": 1, "next": null
}
\`\`\`

If the result spans multiple pages, follow \`next\` URLs to fetch the rest.

---

## Action: post_inline_comment

Post a comment anchored to a specific line in a file in the PR diff.

**Endpoint:** \`POST /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/comments\`

**Input Schema:**
\`\`\`json
{
  "type": "object",
  "required": ["workspace", "repo_slug", "pull_request_id", "path", "line", "side", "text"],
  "properties": {
    "workspace":       { "type": "string" },
    "repo_slug":       { "type": "string" },
    "pull_request_id": { "type": "integer" },
    "path":            { "type": "string", "description": "File path inside the repo (e.g. src/foo.ts)" },
    "line":            { "type": "integer", "description": "Line number in the file (1-indexed)" },
    "side":            { "type": "string", "enum": ["to", "from"], "description": "'to' = line in destination/new file; 'from' = line in source/old file" },
    "text":            { "type": "string", "description": "Comment body (markdown)" }
  }
}
\`\`\`

**Body shape (the \`inline\` object distinguishes inline from summary comments):**
\`\`\`json
{
  "content": { "raw": "<text>" },
  "inline":  { "path": "<path>", "to": <line> }
}
\`\`\`
Use \`"from"\` instead of \`"to"\` when commenting on a removed/old line.

**Call:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"curl -s -X POST -u \\"{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}\\" -H \\"Content-Type: application/json\\" \\"https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests/$PR_ID/comments\\" -d \\"{\\\\\\"content\\\\\\":{\\\\\\"raw\\\\\\":\\\\\\"$TEXT\\\\\\"},\\\\\\"inline\\\\\\":{\\\\\\"path\\\\\\":\\\\\\"$PATH\\\\\\",\\\\\\"$SIDE\\\\\\":$LINE}}\\""}'
\`\`\`

**Output:** Bitbucket comment object with \`id\`, \`content.raw\`, \`inline\`, \`user\`, \`created_on\`.

---

## Action: post_summary_comment

Post a top-level (non-inline) comment summarizing the review.

**Endpoint:** \`POST /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/comments\` (same endpoint, body omits \`inline\`)

**Input Schema:**
\`\`\`json
{
  "type": "object",
  "required": ["workspace", "repo_slug", "pull_request_id", "text"],
  "properties": {
    "workspace":       { "type": "string" },
    "repo_slug":       { "type": "string" },
    "pull_request_id": { "type": "integer" },
    "text":            { "type": "string", "description": "Summary comment body (markdown)" }
  }
}
\`\`\`

**Body:**
\`\`\`json
{ "content": { "raw": "## Verdict\\n\\nLGTM — approving.\\n..." } }
\`\`\`

**Call:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"curl -s -X POST -u \\"{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}\\" -H \\"Content-Type: application/json\\" \\"https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests/$PR_ID/comments\\" -d \\"{\\\\\\"content\\\\\\":{\\\\\\"raw\\\\\\":\\\\\\"$TEXT\\\\\\"}}\\""}'
\`\`\`

Tip: tag the verdict so re-reviews can find it via \`list_existing_comments\` (e.g. start the body with \`<!-- tide-commander-verdict -->\`).

---

## Action: approve

Set the calling user's participant state to \`approved\`.

**Endpoint:** \`POST /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/approve\`

**Input Schema:**
\`\`\`json
{
  "type": "object",
  "required": ["workspace", "repo_slug", "pull_request_id"],
  "properties": {
    "workspace":       { "type": "string" },
    "repo_slug":       { "type": "string" },
    "pull_request_id": { "type": "integer" }
  }
}
\`\`\`

**Call:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"curl -s -X POST -u \\"{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}\\" \\"https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests/$PR_ID/approve\\""}'
\`\`\`

**Output:** participant object with \`approved: true\`, \`state: "approved"\`.

If a prior pass called \`request_changes\`, also call \`unrequest_changes\` so the participant state isn't ambiguous.

---

## Action: unapprove

Clear the calling user's \`approved\` state.

**Endpoint:** \`DELETE /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/approve\`

**Input Schema:** identical to \`approve\`.

**Call:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"curl -s -X DELETE -u \\"{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}\\" \\"https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests/$PR_ID/approve\\""}'
\`\`\`

**Output:** \`204 No Content\` on success.

---

## Action: request_changes

Set the calling user's participant state to \`changes_requested\` (native Bitbucket Cloud endpoint — not emulated).

**Endpoint:** \`POST /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/request-changes\`

**Input Schema:**
\`\`\`json
{
  "type": "object",
  "required": ["workspace", "repo_slug", "pull_request_id"],
  "properties": {
    "workspace":       { "type": "string" },
    "repo_slug":       { "type": "string" },
    "pull_request_id": { "type": "integer" }
  }
}
\`\`\`

**Call:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"curl -s -X POST -u \\"{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}\\" \\"https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests/$PR_ID/request-changes\\""}'
\`\`\`

**Output:** participant object with \`state: "changes_requested"\`.

If a prior pass called \`approve\`, also call \`unapprove\` so the participant state isn't ambiguous.

---

## Action: unrequest_changes

Clear the calling user's \`changes_requested\` state.

**Endpoint:** \`DELETE /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/request-changes\`

**Input Schema:** identical to \`request_changes\`.

**Call:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"curl -s -X DELETE -u \\"{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}\\" \\"https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests/$PR_ID/request-changes\\""}'
\`\`\`

**Output:** \`204 No Content\` on success.

---

## Action: list_existing_comments

List all comments on a PR. Use to detect prior reviewer verdict comments (idempotency for \`pullrequest:updated\` retries) and to avoid duplicate inline comments.

**Endpoint:** \`GET /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/comments?pagelen=100\`

**Input Schema:**
\`\`\`json
{
  "type": "object",
  "required": ["workspace", "repo_slug", "pull_request_id"],
  "properties": {
    "workspace":       { "type": "string" },
    "repo_slug":       { "type": "string" },
    "pull_request_id": { "type": "integer" },
    "pagelen":         { "type": "integer", "default": 100, "description": "Page size (max 100)" },
    "follow_pagination": { "type": "boolean", "default": true, "description": "If true, follow 'next' URLs and concatenate all pages" }
  }
}
\`\`\`

**Call (single page):**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"curl -s -u \\"{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}\\" \\"https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests/$PR_ID/comments?pagelen=100\\""}'
\`\`\`

**Pagination loop (concatenate all pages into one JSON array):**
\`\`\`bash
URL="https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests/$PR_ID/comments?pagelen=100"
ALL="[]"
while [ -n "$URL" ] && [ "$URL" != "null" ]; do
  PAGE=$(curl -s -u "{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}" "$URL")
  ALL=$(jq -c --argjson page "$PAGE" '. + $page.values' <<<"$ALL")
  URL=$(jq -r '.next // empty' <<<"$PAGE")
done
echo "$ALL"
\`\`\`

**Output:** array of comment objects with \`id\`, \`content.raw\`, \`inline\` (for inline comments), \`user.account_id\`, \`created_on\`, \`updated_on\`, \`deleted\`.

To find a prior verdict comment, filter for \`content.raw\` starting with the \`<!-- tide-commander-verdict -->\` marker.

---

## Verdict Workflow

Symmetric, two-state verdict — these always run together so the participant state stays consistent:

| Verdict | Calls |
|---------|-------|
| Approve | \`post_summary_comment\` + \`approve\` + (if prior pass requested changes) \`unrequest_changes\` |
| Request changes | \`post_summary_comment\` + \`request_changes\` + (if prior pass approved) \`unapprove\` |

On a \`pullrequest:updated\` event, first call \`list_existing_comments\` and look for the \`<!-- tide-commander-verdict -->\` marker to decide whether to update an existing verdict (delete + repost) vs add a new one.

---

## Idempotency Rules

1. The webhook payload includes \`X-Request-UUID\`. Persist the last-handled UUID per PR and skip re-processing the same delivery.
2. Before posting a summary comment, call \`list_existing_comments\` and check for the \`<!-- tide-commander-verdict -->\` marker. If found, delete the prior comment first (\`DELETE …/comments/{comment_id}\`) before posting the new one.
3. Inline comments are harder to dedupe — match on \`{path, line, side}\` and skip if a comment from the reviewer account already exists at that anchor.

---

## Error Handling

| HTTP | Meaning | Action |
|------|---------|--------|
| 401 | Unauthorized | Verify \`BITBUCKET_EMAIL\` / \`BITBUCKET_TOKEN\` are set; confirm the curl ran via \`/api/exec\` |
| 403 | Forbidden | Token is missing \`write:pullrequest:bitbucket\` (or \`read:pullrequest:bitbucket\` for reads) |
| 404 | Not Found | Wrong workspace/repo/PR id — re-extract from the trigger payload |
| 400 | Bad Request | JSON body malformed (commonly an unescaped quote in the comment body) |
| 429 | Rate limited | Bitbucket rate-limits per-user; back off and retry the failed action only |

---

## Safety Rules

1. **Never push code, never merge, never decline** — those are not reviewer responsibilities. Required scopes intentionally exclude \`write:repository:bitbucket\`.
2. **Always check for an existing verdict comment** before posting (idempotency).
3. **Never post on a PR authored by the reviewer account** — filter \`pullrequest.author\` against the \`BITBUCKET_EMAIL\` identity to avoid loops.
4. **Honor the diff-size gate** — if \`fetch_pr_diffstat\` shows a PR over the configured threshold, post a summary comment explaining the skip and **do not** approve or request changes.
5. **Do not include secret values in comment bodies or logs.**

---

## Quick Reference

| Action | Endpoint | Method |
|--------|----------|--------|
| fetch_pr_diff | \`/pullrequests/{id}/diff\` | GET |
| fetch_pr_diffstat | \`/pullrequests/{id}/diffstat\` | GET |
| post_inline_comment | \`/pullrequests/{id}/comments\` | POST (with \`inline\`) |
| post_summary_comment | \`/pullrequests/{id}/comments\` | POST (no \`inline\`) |
| approve | \`/pullrequests/{id}/approve\` | POST |
| unapprove | \`/pullrequests/{id}/approve\` | DELETE |
| request_changes | \`/pullrequests/{id}/request-changes\` | POST |
| unrequest_changes | \`/pullrequests/{id}/request-changes\` | DELETE |
| list_existing_comments | \`/pullrequests/{id}/comments?pagelen=100\` | GET |

Base URL: \`https://api.bitbucket.org/2.0/repositories/{workspace}/{repo_slug}\``,
};

import type { BuiltinSkillDefinition } from './types.js';

export const bitbucketPRReview: BuiltinSkillDefinition = {
  slug: 'bitbucket-pr-review',
  name: 'Bitbucket PR Review',
  description: 'Read pull request diffs, post review comments (inline or summary), approve or request-changes on Bitbucket Cloud PRs using API token authentication. Use this skill when an automated reviewer agent needs to evaluate a PR and record a verdict.',
  allowedTools: ['Bash(curl:*)', 'Read', 'Grep', 'Glob'],
  content: `# Bitbucket Pull Request Reviewer

Read PR diffs, post review comments, and set verdict (approve / request-changes / clear) on Bitbucket Cloud pull requests via the REST API 2.0. Bitbucket deprecated App Passwords in September 2025 (disabled June 9, 2026); this skill uses API tokens with scopes.

## Required Secrets

- \`BITBUCKET_EMAIL\` — Atlassian account email for the reviewer identity
- \`BITBUCKET_TOKEN\` — API token with scopes: \`read:repository:bitbucket\` (fetch diff), \`read:pullrequest:bitbucket\` (read PR + comments + participants), \`write:pullrequest:bitbucket\` (comments, approve/unapprove, request-changes/unrequest-changes). Do **not** request \`write:repository:bitbucket\` — a reviewer must never push.

**Auth (HTTP Basic):** \`curl -s -u "{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}" ...\`

## CRITICAL: All API Calls Must Use Streaming Exec

Secret placeholders \`{{BITBUCKET_EMAIL}}\` / \`{{BITBUCKET_TOKEN}}\` are only interpolated when commands run through the Streaming Exec API (\`/api/exec\`); direct Bash curl sends the raw \`{{...}}\` placeholders and 401s — a 401 most likely means curl was called directly. Wrap every curl:

\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"curl -s -u \\"{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}\\" https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests/$PR_ID/diff"}'
\`\`\`

## Common Variables

\`WORKSPACE\` (workspace slug, e.g. \`mycompany\`), \`REPO_SLUG\` (e.g. \`wind\`), \`PR_ID\` (e.g. \`42\`) — typically from the trigger payload (\`repository.full_name\`, \`pullrequest.id\`):
\`\`\`bash
WORKSPACE=$(echo "$REPO_FULL_NAME" | cut -d/ -f1)
REPO_SLUG=$(echo "$REPO_FULL_NAME" | cut -d/ -f2)
\`\`\`

Base URL: \`https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG\`

Every action below requires \`workspace\` (string), \`repo_slug\` (string), \`pull_request_id\` (integer); extra params noted per action.

## fetch_pr_diff

\`GET /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/diff\` — unified diff. Extra param: \`max_bytes\` (integer, default 204800 — truncate at this many bytes, 200 KB).

**Call (returns JSON \`{ diff, truncated, byte_count }\`):**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"set -euo pipefail; MAX=\${MAX_BYTES:-204800}; RAW=$(curl -s -H \\"Accept: text/plain\\" -u \\"{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}\\" \\"https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests/$PR_ID/diff\\"); LEN=\${#RAW}; if [ \\"$LEN\\" -gt \\"$MAX\\" ]; then DIFF=\${RAW:0:$MAX}; TRUNC=true; else DIFF=$RAW; TRUNC=false; fi; jq -nc --arg d \\"$DIFF\\" --argjson t $TRUNC --argjson l $LEN \\"{diff:\\$d, truncated:\\$t, byte_count:\\$l}\\""}'
\`\`\`

If \`truncated:true\`, note in the summary comment that the review was based on a partial diff and recommend splitting the PR.

## fetch_pr_diffstat

\`GET .../pullrequests/{pull_request_id}/diffstat?pagelen=100\` — per-file change stats (additions/removals, file paths). Use as a pre-flight gate before \`fetch_pr_diff\` to skip oversized PRs early. Extra param: \`pagelen\` (integer, default 100, max 100). Paginated — follow \`next\` URLs for remaining pages.

**Output:**
\`\`\`json
{ "values": [ { "type": "diffstat", "status": "modified", "lines_added": 12, "lines_removed": 3,
    "old": { "path": "src/foo.ts" }, "new": { "path": "src/foo.ts" } } ],
  "page": 1, "pagelen": 100, "size": 1, "next": null }
\`\`\`

## post_inline_comment

\`POST .../pullrequests/{pull_request_id}/comments\` — comment anchored to a line in the diff. Extra required params: \`path\` (file path in repo, e.g. \`src/foo.ts\`), \`line\` (integer, 1-indexed), \`side\` (\`"to"\` = destination/new-file line; \`"from"\` = source/old-file line, use for removed/old lines), \`text\` (markdown body).

**Body (the \`inline\` object distinguishes inline from summary comments):**
\`\`\`json
{ "content": { "raw": "<text>" }, "inline": { "path": "<path>", "to": <line> } }
\`\`\`

**Call:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"curl -s -X POST -u \\"{{BITBUCKET_EMAIL}}:{{BITBUCKET_TOKEN}}\\" -H \\"Content-Type: application/json\\" \\"https://api.bitbucket.org/2.0/repositories/$WORKSPACE/$REPO_SLUG/pullrequests/$PR_ID/comments\\" -d \\"{\\\\\\"content\\\\\\":{\\\\\\"raw\\\\\\":\\\\\\"$TEXT\\\\\\"},\\\\\\"inline\\\\\\":{\\\\\\"path\\\\\\":\\\\\\"$PATH\\\\\\",\\\\\\"$SIDE\\\\\\":$LINE}}\\""}'
\`\`\`

**Output:** comment object with \`id\`, \`content.raw\`, \`inline\`, \`user\`, \`created_on\`.

## post_summary_comment

Same endpoint and call pattern; body omits \`inline\`. Extra required param: \`text\` (markdown).
\`\`\`json
{ "content": { "raw": "## Verdict\\n\\nLGTM — approving.\\n..." } }
\`\`\`
Tag the verdict so re-reviews can find it via \`list_existing_comments\`: start the body with \`<!-- tide-commander-verdict -->\`.

## approve / unapprove

- approve: \`POST .../pullrequests/{pull_request_id}/approve\` → participant object with \`approved: true\`, \`state: "approved"\`. If a prior pass called \`request_changes\`, also call \`unrequest_changes\` so the participant state isn't ambiguous.
- unapprove: \`DELETE .../pullrequests/{pull_request_id}/approve\` → \`204 No Content\`.

## request_changes / unrequest_changes

- request_changes: \`POST .../pullrequests/{pull_request_id}/request-changes\` (native Bitbucket Cloud endpoint — not emulated) → participant \`state: "changes_requested"\`. If a prior pass called \`approve\`, also call \`unapprove\`.
- unrequest_changes: \`DELETE .../pullrequests/{pull_request_id}/request-changes\` → \`204 No Content\`.

## list_existing_comments

\`GET .../pullrequests/{pull_request_id}/comments?pagelen=100\` — all PR comments. Use to detect prior verdict comments (idempotency for \`pullrequest:updated\` retries) and avoid duplicate inline comments. Extra params: \`pagelen\` (default 100, max 100), \`follow_pagination\` (boolean, default true — follow \`next\` URLs and concatenate all pages).

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

**Output:** array of comment objects with \`id\`, \`content.raw\`, \`inline\` (for inline comments), \`user.account_id\`, \`created_on\`, \`updated_on\`, \`deleted\`. Find a prior verdict by filtering \`content.raw\` starting with \`<!-- tide-commander-verdict -->\`.

## Verdict Workflow

These always run together so the participant state stays consistent:

| Verdict | Calls |
|---------|-------|
| Approve | \`post_summary_comment\` + \`approve\` + (if prior pass requested changes) \`unrequest_changes\` |
| Request changes | \`post_summary_comment\` + \`request_changes\` + (if prior pass approved) \`unapprove\` |

On a \`pullrequest:updated\` event, first call \`list_existing_comments\` and look for the \`<!-- tide-commander-verdict -->\` marker to decide between updating the existing verdict (delete + repost) and adding a new one.

## Idempotency Rules

1. The webhook payload includes \`X-Request-UUID\` — persist the last-handled UUID per PR and skip re-processing the same delivery.
2. Before posting a summary comment, check for the marker via \`list_existing_comments\`; if found, delete the prior comment first (\`DELETE …/comments/{comment_id}\`) before posting the new one.
3. Dedupe inline comments by matching \`{path, line, side}\` — skip if a comment from the reviewer account already exists at that anchor.

## Error Handling

| HTTP | Meaning | Action |
|------|---------|--------|
| 401 | Unauthorized | Verify \`BITBUCKET_EMAIL\` / \`BITBUCKET_TOKEN\` are set; confirm the curl ran via \`/api/exec\` |
| 403 | Forbidden | Token missing \`write:pullrequest:bitbucket\` (or \`read:pullrequest:bitbucket\` for reads) |
| 404 | Not Found | Wrong workspace/repo/PR id — re-extract from the trigger payload |
| 400 | Bad Request | JSON body malformed (commonly an unescaped quote in the comment body) |
| 429 | Rate limited | Bitbucket rate-limits per-user; back off and retry only the failed action |

## Safety Rules

1. Never push code, merge, or decline — not reviewer responsibilities; required scopes intentionally exclude \`write:repository:bitbucket\`.
2. Always check for an existing verdict comment before posting (idempotency).
3. Never post on a PR authored by the reviewer account — filter \`pullrequest.author\` against the \`BITBUCKET_EMAIL\` identity to avoid loops.
4. Honor the diff-size gate — if \`fetch_pr_diffstat\` shows a PR over the configured threshold, post a summary comment explaining the skip and do **not** approve or request changes.
5. Do not include secret values in comment bodies or logs.`,
};

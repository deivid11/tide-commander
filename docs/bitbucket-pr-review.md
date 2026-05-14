# Bitbucket PR Review Integration

## Overview

Tide Commander can act as an automated reviewer on Bitbucket Cloud pull requests. A Bitbucket webhook posts PR events to a per-trigger endpoint; the trigger fires the assigned agent; the agent uses the `bitbucket-pr-review` builtin skill to read the diff, post inline + summary comments, and set its participant state to *approve* or *request-changes* on the PR.

## Prerequisites

Set these on the Tide Commander host (export in the systemd unit, pm2 ecosystem file, or wherever the process is launched):

| Variable | Purpose |
|---|---|
| `BITBUCKET_EMAIL` | Atlassian account email used as the reviewer identity (HTTP Basic username). |
| `BITBUCKET_TOKEN` | Workspace or Repository **Access Token** with the scopes below. **Do not use App Passwords** — Bitbucket deprecated them in September 2025 (disabled June 9, 2026). |
| `BITBUCKET_BOT_USERNAME` | Identifier for the reviewer account, used by the author-loop guard in `src/packages/server/routes/bitbucket-author-loop.ts` to ignore webhooks the bot itself caused (its own comments / approvals / change-requests). |

### Required token scopes

- `read:repository:bitbucket` — fetch the unified diff
- `read:pullrequest:bitbucket` — read PR metadata, comments, participants
- `write:pullrequest:bitbucket` — post comments, approve/unapprove, request-changes/unrequest-changes

Do **not** grant `write:repository:bitbucket`. A reviewer must never push.

### Picking the right value for `BITBUCKET_BOT_USERNAME`

The guard in `src/packages/server/routes/bitbucket-author-loop.ts` matches the env value against three actor fields in the webhook payload, in this order:

1. `actor.uuid` — e.g. `{abc-1234-...}` — **most reliable**, never changes.
2. `actor.account_id` — e.g. `557058:abcd-...` — also stable.
3. `actor.nickname` — e.g. `review-bot` — readable but **can be reclaimed** if the bot is renamed.

Prefer the UUID. Fetch it once with the bot's token:

```bash
curl -s -u "$BITBUCKET_EMAIL:$BITBUCKET_TOKEN" https://api.bitbucket.org/2.0/user
```

Copy the `uuid` field (including the surrounding `{}`) into `BITBUCKET_BOT_USERNAME`.

## Create the trigger in Tide Commander UI

The trigger UI lives in `src/packages/client/components/TriggerManagerPanel.tsx`.

1. Open Tide Commander → **Triggers** panel → **New Trigger**.
2. Set **Type** = `Bitbucket`.
3. Fill **Workspace** (e.g. `tide`) and **Repository slug** (e.g. `wind`).
4. Pick events. For PR review, enable at minimum:
   - `pullrequest:created`
   - `pullrequest:updated`
   - Optional self-recovery: `pullrequest:approved`, `pullrequest:changes_request_created`.
5. Set an **HMAC secret** — any random high-entropy string. The same value goes into Bitbucket in the next step.
6. Assign the reviewer **agent**.
7. **Save**. Only after saving will the panel reveal the **Webhook URL**:

   ```
   https://<your-public-host>/api/triggers/webhook/<triggerId>
   ```

8. Copy both the URL and the HMAC secret.

## Configure the webhook on Bitbucket Cloud

In the Bitbucket repository: **Settings → Webhooks → Add webhook**.

| Field | Value |
|---|---|
| Title | e.g. `Tide Commander PR review` |
| URL | The webhook URL from the previous step |
| Status | **Active** |
| Secret | The HMAC secret from the previous step |
| Triggers | `Pull request: Created`, `Pull request: Updated` (and optionally `Approved` / `Changes request created` for self-recovery) |

Save. Bitbucket will start posting events; the per-trigger HMAC is verified by `src/packages/server/routes/webhook-signatures.ts`, and retried deliveries are deduped via `X-Request-UUID` in `src/packages/server/routes/webhook-dedupe.ts`.

## nginx reverse proxy on the public EC2

The Tide Commander instance is internal (over the VPN). The public EC2 with nginx + certbot terminates TLS and forwards `/api/triggers/webhook/...` to the internal host. Add this `location` block inside the existing TLS `server { ... }`:

```nginx
location /api/triggers/webhook/ {
  proxy_pass http://commander.internal.vpn:5174;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;

  # Bitbucket-specific headers — required by the receiver:
  #   X-Event-Key       → routing + author-loop guard
  #   X-Hub-Signature   → HMAC verification
  #   X-Request-UUID    → idempotency / dedupe
  #   X-Attempt-Number  → diagnostic only (logged on dedupe)
  proxy_set_header X-Event-Key       $http_x_event_key;
  proxy_set_header X-Hub-Signature   $http_x_hub_signature;
  proxy_set_header X-Request-UUID    $http_x_request_uuid;
  proxy_set_header X-Attempt-Number  $http_x_attempt_number;
  proxy_set_header Content-Type      $http_content_type;

  proxy_pass_request_headers on;
  proxy_read_timeout 30s;
}
```

> **Why explicitly set headers nginx already forwards?** With `proxy_pass_request_headers on` (the default) nginx forwards every client header. The explicit `proxy_set_header X-*` lines above are belt-and-suspenders: they (a) make the dependency obvious in the config, (b) survive any later `proxy_set_header` overrides at the `server` or `http` level (which would otherwise drop unset headers), and (c) make `nginx -T` diffs easy to grep when debugging missed deliveries.

Reload nginx (`sudo nginx -t && sudo systemctl reload nginx`). Confirm certbot's renewal still works after the change.

## End-to-end smoke test

1. Open a tiny PR on a configured repo (e.g. fix a typo in a README).
2. Watch the agent in Tide Commander — its tracking status should flip to `working` within a few seconds of the PR being created.
3. On the Bitbucket PR page, expect:
   - One or more inline comments on changed lines.
   - A summary comment starting with `<!-- tide-commander-verdict -->`.
   - The reviewer account's participant state set to **Approved** or **Requested changes** at the top of the PR.
4. Push another commit to the PR branch — the `pullrequest:updated` event should re-fire the agent and the prior verdict comment should be replaced (idempotency by marker).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `401 Unauthorized` from `/api/triggers/webhook/<id>` with `{"error":"Invalid signature"}` | HMAC mismatch | Re-copy the secret from the trigger panel into Bitbucket's webhook config; confirm nginx is forwarding `X-Hub-Signature`. |
| `401 Unauthorized` with `{"error":"Missing signature"}` | nginx stripped the header | Verify the `proxy_set_header X-Hub-Signature` line is present and reload nginx. |
| Receiver returns `{"deduped":true}` | Bitbucket is retrying a delivery (same `X-Request-UUID`) | Normal. No action — `src/packages/server/routes/webhook-dedupe.ts` short-circuits retries within a 10-min TTL. |
| Receiver returns `{"skipped":"author-loop-guard"}` | Webhook was caused by the bot's own action | Normal. Confirms the guard works. |
| Agent stays silent on every event | `BITBUCKET_BOT_USERNAME` value is wrong (matches all events as the bot's own) | `curl -s -u "$BITBUCKET_EMAIL:$BITBUCKET_TOKEN" https://api.bitbucket.org/2.0/user` and copy the `uuid` exactly, including `{}`. |
| Agent runs but skill calls return 401 | `{{BITBUCKET_EMAIL}}` / `{{BITBUCKET_TOKEN}}` not interpolated | The skill must run curl through `/api/exec` so secrets are interpolated; direct `Bash(curl)` sends the raw `{{...}}` placeholders. |
| Agent runs but skill calls return 403 | Token missing scopes | Recreate the access token with `read:repository:bitbucket`, `read:pullrequest:bitbucket`, `write:pullrequest:bitbucket`. |

For trigger-level diagnostics, the **Trigger fire history** in `src/packages/client/components/TriggerManagerPanel.tsx` shows every delivery and its routing outcome.

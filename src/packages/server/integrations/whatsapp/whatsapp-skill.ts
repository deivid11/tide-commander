/**
 * WhatsApp Messaging Skill
 * BuiltinSkillDefinition that provides curl-based WhatsApp instructions to agents.
 */

import type { BuiltinSkillDefinition } from '../../data/builtin-skills/types.js';

export const whatsappSkill: BuiltinSkillDefinition = {
  slug: 'whatsapp-messaging',
  name: 'WhatsApp Messaging',
  description: 'Send and inspect WhatsApp messages via the WhatsApp integration',
  allowedTools: ['Bash(curl:*)'],
  content: `# WhatsApp Messaging

Send WhatsApp messages and inspect Baileys sessions through the local Tide Commander proxy. The upstream WhatsApp API key is held server-side and never sent by the agent — but every request from the agent **must** carry the Tide Commander auth header (\`X-Auth-Token\`), exactly like any other TC API call.

> **Where to find the auth token:** it is the same token your agent uses for \`/api/notify\`, \`/api/exec\`, etc. (the API Calling Convention block in your system prompt has the literal value). All examples below show \`X-Auth-Token: abcd\` as a placeholder — substitute your real token.

**Prerequisites:**
- The WhatsApp integration is enabled (\`enabled: true\` in its config) and the API key is configured.
- At least one Baileys session is paired and \`CONNECTED\` (use the QR pairing flow from the Tide Commander UI).
- A \`defaultSessionId\` is set in config, OR pass an explicit \`sessionId\` on every send.

---

## Quick Recipes (most common cases)

### 1. Send a text to the default session
\`\`\`bash
curl -s -X POST -H "X-Auth-Token: abcd" http://localhost:5174/api/whatsapp/send-message \\
  -H "Content-Type: application/json" \\
  -d '{"to":"5215532967210","message":"Hello from Tide Commander"}'
\`\`\`

### 2. Send a file the user just attached in the Tide Commander chat
**Pattern to recognize:** the user's message contains \`[File: /tmp/tide-commander-uploads/<basename>]\` (or just mentions a path under that directory). That's a Tide Commander upload — do NOT try to read the file, upload it elsewhere, or use multipart. Instead:

1. Take the basename from \`/tmp/tide-commander-uploads/<basename>\`.
2. Build \`http://localhost:5174/uploads/<basename>\` — Tide Commander already serves this directory statically (see \`src/packages/server/app.ts\` static mount). The upstream WhatsApp server runs on the same machine (\`localhost:3007\`) and fetches the URL directly. No S3, no extra hosting, no multipart needed.
3. **URL-encode** the basename: spaces → \`%20\`, etc. Easiest: \`python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" 'Error responses create order-hi72ca.pdf'\`.
4. **Set \`filename\` to a clean display name.** Uploads get a random \`-XXXXXX\` suffix before the extension (e.g. \`Error responses create order-hi72ca.pdf\`). Strip that suffix in the \`filename\` field so the recipient sees the original name, NOT the upload-pipeline garbage.

\`\`\`bash
# User attached: /tmp/tide-commander-uploads/Error responses create order-hi72ca.pdf
curl -s -X POST -H "X-Auth-Token: abcd" http://localhost:5174/api/whatsapp/send-media-url \\
  -H "Content-Type: application/json" \\
  -d '{"to":"5215532967210","mediaUrl":"http://localhost:5174/uploads/Error%20responses%20create%20order-hi72ca.pdf","filename":"Error responses create order.pdf","type":"document"}'
\`\`\`

The same flow works for images (\`type:"image"\`), videos (\`type:"video"\`), and audio (\`type:"audio"\`). For non-documents, \`caption\` shows under the media; \`filename\` is ignored.

### 3. Send a remote URL (image, PDF, etc. already on the public web)
\`\`\`bash
curl -s -X POST -H "X-Auth-Token: abcd" http://localhost:5174/api/whatsapp/send-media-url \\
  -H "Content-Type: application/json" \\
  -d '{"to":"5215532967210","mediaUrl":"https://example.com/cat.png","caption":"meow","type":"image"}'
\`\`\`

---

## Send a Text Message (full reference)

\`\`\`bash
curl -s -X POST -H "X-Auth-Token: abcd" http://localhost:5174/api/whatsapp/send-message \\
  -H "Content-Type: application/json" \\
  -d '{"to":"5215532967210","message":"Your message here"}'
\`\`\`

Body fields:
- \`to\` (required) — destination JID. Two accepted forms:
  - **E.164 country-coded number with no \`+\`**, e.g. \`5215532967210\` for Mexico, \`14155552671\` for the US. The upstream resolves this to a \`s.whatsapp.net\` JID.
  - **Full JID**, e.g. \`5215532967210@s.whatsapp.net\` for an individual or \`120363xxxxxxxxx@g.us\` for a group.
- \`message\` (required) — UTF-8 text. Standard WhatsApp formatting works (\`*bold*\`, \`_italic_\`, \`~strike~\`, \`\\\`\\\`\\\`code\\\`\\\`\\\`\`).
- \`sessionId\` (optional) — pick a specific paired session. If omitted, the configured \`defaultSessionId\` is used. If neither is present, the call fails with 400.

Response: \`{"success":true,"sessionId":"main","result":{"messageId":"3EB0...","success":true}}\`.

## List Sessions

\`\`\`bash
curl -s -H "X-Auth-Token: abcd" http://localhost:5174/api/whatsapp/sessions
\`\`\`

Returns \`{"sessions":[{"sessionId":"main","status":"CONNECTED",...}, ...]}\`. Use this to discover which session ids exist and which are live.

## Check Session Status

\`\`\`bash
curl -s -H "X-Auth-Token: abcd" http://localhost:5174/api/whatsapp/sessions/main/status
\`\`\`

Returns \`{"sessionId":"main","status":"CONNECTED",...}\` (other fields pass through from the upstream Baileys server).

Common \`status\` / \`state\` values:
- \`CONNECTED\` — paired and online; safe to send.
- \`CONNECTING\` / \`initializing\` — handshake in flight; retry shortly.
- \`DISCONNECTED\` / \`logged_out\` — pairing was lost; the user must rescan the QR from the Tide Commander UI.
- \`PAIRING\` — a QR is available at \`GET /api/whatsapp/sessions/:id/qr\` and the user must scan it from their phone.

Always check the status before a high-stakes send if the session has been idle.

## Connection / Health Check

\`\`\`bash
curl -s -H "X-Auth-Token: abcd" http://localhost:5174/api/whatsapp/status
\`\`\`

Returns \`{"enabled":true,"configured":true,"baseUrl":"http://localhost:3007","defaultSessionId":"main","sessions":1}\` when healthy. \`configured:false\` means the integration is enabled but the API key isn't set. \`enabled:false\` means the whole integration is off.

## Receiving Incoming Messages

Agents do **not** poll for incoming messages. The integration runs a long-lived WS bridge to the upstream WhatsApp API server and rebroadcasts incoming messages on the Tide Commander client WebSocket as:

\`\`\`json
{ "type": "whatsapp_message", "payload": { "sessionId": "main", "from": "...", "message": { ... } } }
\`\`\`

If your agent needs to react to replies, listen on the TC client WS for \`type: "whatsapp_message"\` instead of polling. For one-shot send-and-wait flows, send the outgoing message via the curl above and have your trigger/workflow listen for the matching \`whatsapp_message\` event.

## Sending Media by URL (full reference)

Send images, videos, audio clips, or documents by handing the integration a fetchable URL. The upstream WhatsApp API server (running locally at \`localhost:3007\`) does the GET, auto-detects the mimetype from the \`Content-Type\` header, and delivers it via Baileys.

\`\`\`bash
curl -s -X POST -H "X-Auth-Token: abcd" http://localhost:5174/api/whatsapp/send-media-url \\
  -H "Content-Type: application/json" \\
  -d '{"to":"5215532967210","mediaUrl":"https://example.com/cat.png","caption":"meow","type":"image"}'
\`\`\`

Body fields:
- \`to\` (required) — same JID/E.164 forms as \`/send-message\`.
- \`mediaUrl\` (required) — fetchable URL. The upstream server does the GET; the URL must be reachable from \`localhost:3007\`. **\`http://localhost:5174/uploads/<filename>\` IS reachable** (same machine), so user-uploaded files can be sent directly — see Recipe #2 above.
- \`caption\` (optional) — text shown under the media (ignored for audio).
- \`type\` (optional) — one of \`image\` / \`video\` / \`audio\` / \`document\`. Advisory hint; the upstream classifies via the URL's \`Content-Type\` regardless. Useful for documenting intent in the call.
- \`filename\` (optional) — only relevant for documents. Defaults to the URL's basename or a header-derived name. **Set this to a clean human-readable name** when sending uploaded files — otherwise the recipient sees the random suffix the upload pipeline added.
- \`sessionId\` (optional) — same fallback rule as \`/send-message\` (uses \`defaultSessionId\` if omitted; 400 if neither set).

Response: \`{"success":true,"sessionId":"...","result":{"messageId":"...",...}}\`.

**Caps and caveats:**
- **50 MB max payload** and **60s fetch timeout** on the upstream side. Large videos and slow CDNs fail with 502.
- **URLs must be reachable from the upstream server.** Localhost URLs work because the upstream runs on the same machine; pre-signed S3 / CDN-token URLs work if the token is alive at send time; arbitrary private-network URLs only work if the upstream can route to them.
- **URL-encode filenames with spaces or special characters.** The \`/uploads\` static mount serves the literal filename, so \`"Error responses.pdf"\` becomes \`Error%20responses.pdf\` in the URL. Easiest tools: \`encodeURIComponent\` in JS, \`python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" 'name.pdf'\` in shell.
- **Baileys media URLs rotate after delivery.** The \`mediaUrl\` you observe in inbound \`whatsapp_message\` events expires once the recipient has downloaded the media — do NOT cache or replay them. Re-host the file yourself if you need durable storage.
- **Multipart upload (raw bytes) is not yet supported.** Use a URL. For local files, the \`/uploads\` mount is the path of least resistance; for ad-hoc files outside that directory, copy or symlink them in first.

## Common Errors

- **503** \`{"error":"WhatsApp API key is not configured"}\` — integration is enabled but the API key secret isn't set. Configure it in the WhatsApp integration settings.
- **400** \`{"error":"to and message are required"}\` — body is missing \`to\` or \`message\`.
- **400** \`{"error":"sessionId is required (none provided and no defaultSessionId configured)"}\` — pass \`sessionId\` in the body, or set a \`defaultSessionId\` in integration config.
- **502** \`{"error":"..."}\` — the upstream WhatsApp API server returned an error (session not found, not connected, recipient invalid, rate-limited). The error message is forwarded verbatim from the upstream.

## Notes

- JIDs are case-sensitive and must NOT include a leading \`+\` for the bare-number form.
- Group chats use \`@g.us\` JIDs; individual chats use \`@s.whatsapp.net\`. Listing sessions does not list contacts — discover JIDs from incoming \`whatsapp_message\` events or a paired phone's chat list.
- Every curl needs the \`X-Auth-Token\` header (same value as your other Tide Commander API calls). Never paste the upstream X-API-Key into your curl invocations — that one stays server-side.
- No exclamation marks (\`!\`) anywhere in the curl body — bash history expansion will corrupt the JSON. If a message must contain one, build the JSON in a heredoc (\`-d @- <<'EOF'\`).
`,
};

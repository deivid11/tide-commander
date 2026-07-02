/* renderers.js — vanilla-JS port of the Guake terminal's custom content
 * renderers (src/packages/client/components/ClaudeOutputPanel/*). Turns the
 * special blocks the harness/triggers inject into chat history — task
 * notifications, agent-to-agent messages, WhatsApp / Slack / Gmail bubbles,
 * boss delegations, work plans, [Image:]/[File:] refs — into pretty cards
 * instead of walls of raw XML/JSON.
 *
 * Loaded before sidepanel.js; exposes `window.TCRenderers`. The host passes a
 * `deps` object so we reuse sidepanel.js's markdown renderer and image
 * resolver instead of duplicating them:
 *   deps.md(srcMarkdown)  -> safe HTML string
 *   deps.resolveImage(p)  -> web URL for an image/file path
 */
(function () {
  'use strict';

  // Sentinel: renderSpecial returns this to tell the host to render NOTHING for
  // this message (e.g. the /compact command echo + local-command caveats).
  const HIDE = '__TC_HIDE__';

  // ── escaping ──
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }
  function attr(s) {
    return esc(s).replace(/"/g, '&quot;');
  }
  function basename(p) {
    if (!p) return '';
    const s = String(p).split(/[\\/]/).filter(Boolean);
    return s[s.length - 1] || String(p);
  }

  // Minimal DOM helper.
  function el(tag, className, html) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  }

  // ── shared formatting (mirrors BossContext.tsx) ──
  const PREVIEW_CHAR_LIMIT = 400;
  function shouldClamp(text) {
    if (!text) return false;
    return text.length > PREVIEW_CHAR_LIMIT || text.split('\n').length > 8;
  }
  function formatTokenCount(n) {
    if (n >= 10000) return `${Math.round(n / 1000)}k`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }
  function formatTaskDuration(ms) {
    const totalSec = Math.round(ms / 1000);
    if (totalSec < 60) return `${totalSec}s`;
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  function pad2(n) { return n < 10 ? `0${n}` : String(n); }
  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function parseDate(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Wire a collapsible card: clicking the card toggles `.expanded`, which the
  // CSS uses to drop the clamp on `.tc-clamp`. Returns whether a toggle was added.
  function makeCollapsible(card, bodyEl, toggleEl, fullText) {
    if (!shouldClamp(fullText)) {
      card.classList.add('no-toggle');
      if (toggleEl) toggleEl.remove();
      return false;
    }
    bodyEl.classList.add('tc-clamp');
    card.classList.add('tc-toggleable');
    card.addEventListener('click', (e) => {
      if (e.target.closest('a')) return; // let links work
      e.stopPropagation();
      const open = card.classList.toggle('expanded');
      bodyEl.classList.toggle('tc-clamp', !open);
      if (toggleEl) toggleEl.textContent = open ? '▾' : '▸';
    });
    return true;
  }

  // ── bubble body (URL linkify + [attachment:] chips + <br>) — port of
  // AttachmentChip.renderBodyWithAttachments. Returns an HTML string. ──
  const ATTACHMENT_RE = /\[attachment: (\/tmp\/tide-commander-uploads\/[^\]\n]+?)\]/g;
  const ATTACHMENT_SKIPPED_RE = /\[attachment-skipped:[^\]\n]*\]/g;
  const URL_RE = /(https?:\/\/[^\s<>"'\)]+)/g;

  function parseAttachmentInner(inner) {
    const FIELD_KEYS = ['mimetype', 'name', 'size'];
    let pathEnd = inner.length;
    for (const k of FIELD_KEYS) {
      const idx = inner.indexOf(`  ${k}=`);
      if (idx >= 0 && idx < pathEnd) pathEnd = idx;
    }
    const path = inner.slice(0, pathEnd);
    const rest = inner.slice(pathEnd);
    let mimetype, filename, size;
    const mMatch = rest.match(/  mimetype=(.+?)(?=  (?:name|size)=|$)/);
    if (mMatch) mimetype = mMatch[1];
    const nMatch = rest.match(/  name=(.+?)(?=  size=|$)/);
    if (nMatch) filename = nMatch[1];
    const sMatch = rest.match(/  size=(\d+)/);
    if (sMatch && Number.isFinite(Number(sMatch[1]))) size = Number(sMatch[1]);
    return { path, mimetype, filename, size };
  }
  function humanSizeShort(bytes) {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  function attachmentGlyph(mime, filename) {
    const m = (mime || '').toLowerCase();
    const ext = (filename || '').toLowerCase().split('.').pop() || '';
    if (m.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg'].includes(ext)) return '🖼';
    if (m.startsWith('video/') || ['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return '🎞';
    if (m.startsWith('audio/') || ['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac'].includes(ext)) return '🎵';
    if (m === 'application/pdf' || m.startsWith('text/') || ['pdf', 'txt', 'md', 'json', 'csv', 'log'].includes(ext)) return '📄';
    return '📎';
  }
  function linkifyLine(line) {
    let out = '';
    let last = 0;
    let m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(line)) !== null) {
      if (m.index > last) out += esc(line.slice(last, m.index));
      const url = m[1];
      out += `<a href="${attr(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`;
      last = URL_RE.lastIndex;
    }
    if (last < line.length) out += esc(line.slice(last));
    return out;
  }
  function attachmentChipHtml(p) {
    const name = p.filename || basename(p.path) || 'attachment';
    const sizeLabel = humanSizeShort(p.size);
    const title = `${name}${p.mimetype ? ` (${p.mimetype})` : ''}`;
    return (
      `<span class="attachment-chip" title="${attr(title)}">` +
      `<i>${attachmentGlyph(p.mimetype, p.filename)}</i>` +
      `<span class="attachment-chip__name">${esc(name)}</span>` +
      (sizeLabel ? `<span class="attachment-chip__size">${esc(sizeLabel)}</span>` : '') +
      `</span>`
    );
  }
  function renderBubbleBody(body) {
    const cleaned = body
      .replace(ATTACHMENT_SKIPPED_RE, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s*\n/, '')
      .replace(/\n\s*$/, '');
    let out = '';
    let cursor = 0;
    let m;
    ATTACHMENT_RE.lastIndex = 0;
    const pushText = (txt) => {
      if (!txt) return;
      out += txt.split('\n').map(linkifyLine).join('<br/>');
    };
    while ((m = ATTACHMENT_RE.exec(cleaned)) !== null) {
      if (m.index > cursor) pushText(cleaned.slice(cursor, m.index));
      out += attachmentChipHtml(parseAttachmentInner(m[1]));
      cursor = ATTACHMENT_RE.lastIndex;
    }
    if (cursor < cleaned.length) pushText(cleaned.slice(cursor));
    return out;
  }

  // ============================================================================
  // Rich body: markdown + [Image: path] / [File: path] references
  // ============================================================================
  const IMG_FILE_RE = /\[(Image|File):\s*([^\]]+)\]/g;
  function renderRichBody(content, deps) {
    const md = (deps && deps.md) || ((t) => esc(t));
    const resolve = (deps && deps.resolveImage) || ((p) => p);
    const container = el('div', 'md');
    let last = 0;
    let m;
    IMG_FILE_RE.lastIndex = 0;
    let html = '';
    const flushText = (txt) => { if (txt) html += md(txt); };
    while ((m = IMG_FILE_RE.exec(content)) !== null) {
      if (m.index > last) flushText(content.slice(last, m.index));
      const isImage = m[1] === 'Image';
      const path = m[2].trim();
      const name = basename(path) || (isImage ? 'image' : 'file');
      if (isImage) {
        const url = resolve(path);
        html += `<a class="img-ref" href="${attr(url)}" target="_blank" rel="noopener noreferrer" title="${attr(name)}">` +
          `<img src="${attr(url)}" alt="${attr(name)}"/><span>${esc(name)}</span></a>`;
      } else {
        html += `<span class="file-ref" title="${attr(path)}"><i>📄</i>${esc(name)}</span>`;
      }
      last = m.index + m[0].length;
    }
    if (last < content.length) flushText(content.slice(last));
    container.innerHTML = html;
    return container;
  }

  // ============================================================================
  // task-notification  (BossContext.parseTaskNotification / TaskNotificationDisplay)
  // ============================================================================
  function extractXmlTag(source, tag) {
    const m = source.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`));
    return m ? m[1].trim() : '';
  }
  function parseTaskNotification(content) {
    const match = content.match(/<task-notification>\s*([\s\S]*?)\s*<\/task-notification>/);
    if (!match) return null;
    const body = match[1];
    const usageBlock = extractXmlTag(body, 'usage');
    const num = (tag) => {
      const raw = extractXmlTag(usageBlock, tag);
      if (!raw) return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    };
    return {
      taskId: extractXmlTag(body, 'task-id'),
      status: extractXmlTag(body, 'status') || 'completed',
      summary: extractXmlTag(body, 'summary'),
      result: extractXmlTag(body, 'result'),
      tokens: num('subagent_tokens'),
      toolUses: num('tool_uses'),
      durationMs: num('duration_ms'),
      rest: content.replace(/<task-notification>\s*[\s\S]*?<\/task-notification>\s*/g, '').trim(),
    };
  }
  function buildTaskNotification(n, deps) {
    const normalized = n.status.toLowerCase();
    const isError = ['failed', 'error', 'errored', 'killed', 'cancelled', 'canceled', 'timeout'].includes(normalized);
    const isCompleted = ['completed', 'success', 'succeeded', 'done'].includes(normalized);
    const kind = isError ? 'error' : isCompleted ? 'completed' : 'info';
    const title = n.summary || (isError ? 'Background task failed' : 'Background task completed');

    const stats = [];
    if (typeof n.toolUses === 'number') stats.push(`🔧 ${n.toolUses} ${n.toolUses === 1 ? 'tool' : 'tools'}`);
    if (typeof n.tokens === 'number') stats.push(`✦ ${formatTokenCount(n.tokens)}`);
    if (typeof n.durationMs === 'number') stats.push(`⌛ ${formatTaskDuration(n.durationMs)}`);

    const card = el('div', `task-notification task-notification--${kind}`);
    const head = el('div', 'task-notification__head');
    head.innerHTML =
      `<span class="task-notification__icon">${isError ? '✕' : '✓'}</span>` +
      `<span class="task-notification__label">Task</span>` +
      `<span class="task-notification__title">${esc(title)}</span>` +
      (n.taskId ? `<span class="task-notification__id">${esc(n.taskId.slice(0, 8))}</span>` : '') +
      (stats.length ? `<span class="task-notification__stats">${stats.map((s) => `<span class="task-notification__stat">${esc(s)}</span>`).join('')}</span>` : '') +
      `<span class="task-notification__toggle">▸</span>`;
    card.appendChild(head);

    const bodyText = (n.result || '').trim();
    if (bodyText) {
      const bodyEl = renderRichBody(bodyText, deps);
      bodyEl.classList.add('task-notification__body');
      card.appendChild(bodyEl);
      makeCollapsible(card, bodyEl, head.querySelector('.task-notification__toggle'), bodyText);
    } else {
      card.classList.add('no-toggle');
      head.querySelector('.task-notification__toggle').remove();
    }
    return card;
  }

  // ============================================================================
  // subagent_notification  (Codex collab)
  // ============================================================================
  function parseSubagentNotification(content) {
    const match = content.match(/<subagent_notification>\s*([\s\S]*?)\s*<\/subagent_notification>/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[1].trim());
      const status = {};
      if (parsed.status && typeof parsed.status === 'object') {
        for (const [k, v] of Object.entries(parsed.status)) status[k] = typeof v === 'string' ? v : JSON.stringify(v);
      }
      return {
        agentId: parsed.agent_id || '',
        status,
        rest: content.replace(/<subagent_notification>\s*[\s\S]*?<\/subagent_notification>\s*/g, '').trim(),
      };
    } catch {
      return null;
    }
  }
  function buildSubagentNotification(n) {
    const keys = Object.keys(n.status);
    const isError = keys.some((k) => k === 'errored' || k === 'error' || k === 'failed');
    const isCompleted = keys.includes('completed');
    const kind = isError ? 'error' : isCompleted ? 'completed' : 'info';
    const clean = Object.values(n.status).join('; ').replace(/Visit https?:\/\/[^\s]+/g, '').replace(/\s+/g, ' ').trim();
    const card = el('div', `subagent-notification subagent-notification--${kind}`);
    card.innerHTML =
      `<span class="subagent-notification__icon">${isError ? '⚠' : isCompleted ? '✓' : '🧬'}</span>` +
      `<span class="subagent-notification__label">Subagent</span>` +
      `<span class="subagent-notification__id">${esc(n.agentId.slice(-12))}</span>` +
      `<span class="subagent-notification__status">${esc(keys.join(', '))}</span>` +
      (clean ? `<span class="subagent-notification__message" title="${attr(clean)}">${esc(clean)}</span>` : '');
    return card;
  }

  // ============================================================================
  // agent chat message  (agentChatMessageParser / AgentChatMessageCard)
  // ============================================================================
  const AGENT_CHAT_HEADER_RE = /^\s*Message from agent\s+(.+?)\s*\(([a-zA-Z0-9_-]+)\)\s*:\s*([\s\S]*)$/;
  const AGENT_CHAT_INBOUND_RE = /^\s*(?:Message\s+)?[Ff]rom\s+(.+?)\s+\(([a-z0-9]{4,})\)\.\s+([\s\S]+)$/;
  function parseAgentChatMessage(text) {
    if (!text) return null;
    const m = text.match(AGENT_CHAT_HEADER_RE);
    if (m) {
      const r = { senderName: m[1].trim(), senderId: m[2].trim(), body: m[3].trim() };
      return r.senderName && r.senderId && r.body ? r : null;
    }
    const inbound = text.match(AGENT_CHAT_INBOUND_RE);
    if (inbound) {
      const r = {
        senderName: inbound[1].trim().replace(/^agent\s+/i, '').trim(),
        senderId: inbound[2].trim(),
        body: inbound[3].trim(),
      };
      return r.senderName && r.senderId && r.body ? r : null;
    }
    return null;
  }
  function buildAgentChatCard(msg, deps) {
    const card = el('div', 'agent-chat-message-card');
    const title = el('div', 'agent-chat-message-title');
    title.innerHTML =
      `<span class="agent-chat-message-icon">✉</span>` +
      `<span class="agent-chat-message-title-text">Message from ` +
      `<strong class="agent-chat-message-sender-name">${esc(msg.senderName)}</strong>` +
      `<span class="agent-chat-message-sender-id" title="${attr(msg.senderId)}">${esc(msg.senderId.slice(0, 8))}</span>` +
      `</span>`;
    card.appendChild(title);
    const bodyEl = renderRichBody(msg.body, deps);
    bodyEl.classList.add('agent-chat-message-body');
    card.appendChild(bodyEl);
    if (shouldClamp(msg.body)) {
      bodyEl.classList.add('tc-clamp');
      const footer = el('div', 'agent-chat-message-footer');
      const btn = el('button', 'agent-chat-message-more-btn', '<span>Show more</span> ▾');
      btn.type = 'button';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = bodyEl.classList.toggle('tc-clamp') === false;
        btn.innerHTML = open ? '<span>Show less</span> ▴' : '<span>Show more</span> ▾';
      });
      footer.appendChild(btn);
      card.appendChild(footer);
    }
    return card;
  }

  // ============================================================================
  // delegated task / task report  (boss ↔ subordinate)
  // ============================================================================
  function parseDelegatedTaskMessage(content) {
    const m = content.match(/^\[DELEGATED TASK from boss "([^"]+)" \(([^)]+)\)\]\s*\n\n([\s\S]*?)\n\n---\nThis task was delegated by your boss agent\./);
    if (!m) return null;
    return { bossName: m[1], bossId: m[2], taskCommand: m[3].trim() };
  }
  function buildDelegatedTask(d, deps) {
    const card = el('div', 'delegated-task-message');
    const badge = el('div', 'delegated-task-message-badge');
    badge.innerHTML =
      `<span class="delegated-task-message-icon">✉</span>` +
      `<span class="delegated-task-message-chip">Task Delegated</span>` +
      `<span class="delegated-task-message-label"><span class="delegated-task-message-from">from</span> ` +
      `<strong>${esc(d.bossName)}</strong></span>` +
      `<span class="delegated-task-message-id" title="${attr(d.bossId)}">${esc(d.bossId.slice(0, 8))}</span>` +
      `<span class="delegated-task-message-toggle">▸</span>`;
    card.appendChild(badge);
    const bodyEl = renderRichBody(d.taskCommand, deps);
    bodyEl.classList.add('delegated-task-message-command');
    card.appendChild(bodyEl);
    makeCollapsible(card, bodyEl, badge.querySelector('.delegated-task-message-toggle'), d.taskCommand);
    return card;
  }

  function parseTaskReportMessage(content) {
    const m = content.match(/^\[TASK REPORT from ([^(]+?)\s*\(([^)]+)\)\]\s*\n\nStatus:\s*(\w+)\nOriginal task:\s*([\s\S]*?)\n(?:\nSummary:\s*([\s\S]*?))?\n\nYou may review/);
    if (!m) return null;
    return { agentName: m[1].trim(), agentId: m[2].trim(), status: m[3].trim(), summary: (m[5] || '').trim() };
  }
  function buildTaskReport(r, deps) {
    const completed = r.status === 'COMPLETED';
    const card = el('div', `task-report-header status-${completed ? 'completed' : 'failed'}`);
    const badge = el('div', 'task-report-badge');
    badge.innerHTML =
      `<span class="task-report-icon">${completed ? '✓' : '✕'}</span>` +
      `<span class="task-report-label"><strong>${esc(r.agentName)}</strong> — Task ${completed ? 'Completed' : 'Failed'}</span>` +
      `<span class="task-report-id" title="${attr(r.agentId)}">${esc(r.agentId.slice(0, 8))}</span>` +
      `<span class="task-report-toggle">▸</span>`;
    card.appendChild(badge);
    if (r.summary) {
      const bodyEl = renderRichBody(r.summary, deps);
      bodyEl.classList.add('task-report-summary');
      card.appendChild(bodyEl);
      makeCollapsible(card, bodyEl, badge.querySelector('.task-report-toggle'), r.summary);
    } else {
      card.classList.add('no-toggle');
      badge.querySelector('.task-report-toggle').remove();
    }
    return card;
  }

  // ============================================================================
  // WhatsApp bubble  (WhatsAppMessageBubble.tsx)
  // ============================================================================
  const MX_MOBILE_RE = /^521(\d{3})(\d{3})(\d{4})$/;
  function field(section, label) {
    const m = section.match(new RegExp(`^[ \\t]*${label}[ \\t]*:[ \\t]*(.*)$`, 'im'));
    return m ? m[1].trim() : '';
  }
  function splitNameAndJid(line) {
    if (!line) return { name: '', jid: '' };
    const angled = line.match(/^(.*?)\s*<([^>]+)>\s*$/);
    if (angled) return { name: angled[1].trim(), jid: angled[2].trim() };
    return { name: '', jid: line };
  }
  function formatWhatsAppPhone(raw) {
    if (!raw) return '';
    const stripped = raw.replace(/@.*$/, '').trim();
    const digits = stripped.replace(/[^\d]/g, '');
    if (!digits) return stripped || raw;
    const mx = digits.match(MX_MOBILE_RE);
    if (mx) return `+52 1 ${mx[1]} ${mx[2]} ${mx[3]}`;
    if (digits.length === 12 && digits.startsWith('52')) return `+52 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
    return `+${digits}`;
  }
  function formatBubbleTime(date) {
    if (!date) return '';
    const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    if (isSameDay(date, new Date())) return time;
    return `${time} · ${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }
  function parseWhatsAppMessage(text) {
    if (!text) return null;
    if (!/^[ \t]*Nuevo mensaje de WhatsApp\s*\((inbound|outbound)\)\.?\s*$/im.test(text)) return null;
    const headerMatch = text.match(/^[ \t]*Nuevo mensaje de WhatsApp\s*\((inbound|outbound)\)\.?\s*$/im);
    const bodyIdx = text.search(/\n[ \t]*Mensaje\s*:[ \t]*\n?/);
    if (bodyIdx < 0) return null;
    const head = text.slice(0, bodyIdx);
    let body = text.slice(bodyIdx).replace(/^\n[ \t]*Mensaje\s*:[ \t]*\n?/, '');
    body = body.replace(/\n+[ \t]*Revisa el contenido[\s\S]*$/i, '');
    const grupo = field(head, 'Grupo');
    const gm = grupo.trim().match(/^(\S+)\s*(.*)$/);
    const ghead = (gm && gm[1] || '').toLowerCase();
    const isGroup = ['true', 'sí', 'si', '1'].includes(ghead);
    const { name: fromName, jid: rawFrom } = splitNameAndJid(field(head, 'De'));
    return {
      direction: headerMatch[1].toLowerCase(),
      rawFrom,
      phone: formatWhatsAppPhone(rawFrom),
      fromName,
      groupName: gm ? (gm[2] || '').trim() : '',
      session: field(head, 'Sesión') || field(head, 'Sesion'),
      isGroup,
      date: parseDate(field(head, 'Fecha')),
      media: field(head, 'Media'),
      body: body.replace(/^\n+/, '').replace(/\s+$/, ''),
    };
  }
  function buildWhatsApp(msg) {
    const time = formatBubbleTime(msg.date);
    const dir = msg.direction === 'outbound' ? 'enviado' : 'recibido';
    const phoneLabel = msg.phone || msg.rawFrom || '';
    const sender = (msg.fromName || '').trim() || phoneLabel;
    const primary = msg.isGroup ? [msg.groupName, sender].filter(Boolean).join(' · ') : sender;
    const secondary = primary && phoneLabel && !primary.includes(phoneLabel) ? phoneLabel : '';
    const sessionShort = msg.session ? (msg.session.length <= 10 ? msg.session : `${msg.session.slice(0, 8)}…`) : '';

    const row = el('div', `whatsapp-row whatsapp-row--${msg.direction}`);
    const bubble = el('div', 'whatsapp-bubble');
    bubble.innerHTML =
      `<div class="whatsapp-bubble__header">` +
      `<span class="whatsapp-bubble__icon">💬</span>` +
      `<span class="whatsapp-bubble__phone" title="${attr(msg.rawFrom || msg.phone)}">${esc(primary || '—')}</span>` +
      (secondary ? `<span class="whatsapp-bubble__session">${esc(secondary)}</span>` : '') +
      (msg.isGroup ? `<span class="whatsapp-bubble__badge">👥 Grupo</span>` : '') +
      (sessionShort ? `<span class="whatsapp-bubble__session" title="${attr(msg.session)}">${esc(sessionShort)}</span>` : '') +
      `</div>` +
      (msg.media ? `<div class="whatsapp-bubble__media">📎 <span>${esc(msg.media)}</span></div>` : '') +
      `<div class="whatsapp-bubble__body">${msg.body ? renderBubbleBody(msg.body) : '<span class="whatsapp-bubble__empty">—</span>'}</div>` +
      `<div class="whatsapp-bubble__footer"><span class="whatsapp-bubble__brand">WhatsApp · ${esc(dir)}</span>${time ? `<span class="whatsapp-bubble__time">${esc(time)}</span>` : ''}</div>`;
    row.appendChild(bubble);
    return row;
  }

  // ============================================================================
  // Slack bubble  (SlackMessageBubble.tsx)
  // ============================================================================
  function initialsFor(name) {
    const src = (name || '').trim();
    if (!src) return '?';
    const parts = src.split(/[\s.@_-]+/).filter(Boolean);
    if (!parts.length) return src.slice(0, 1).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  function parseSlackMessage(text) {
    if (!text) return null;
    const headerMatch = text.match(/^[ \t]*Nuevo mensaje de Slack(?:\s*\((inbound|outbound)\))?\.?\s*$/im);
    if (!headerMatch) return null;
    const bodyIdx = text.search(/\n[ \t]*Mensaje\s*:[ \t]*\n?/);
    if (bodyIdx < 0) return null;
    const head = text.slice(0, bodyIdx);
    let body = text.slice(bodyIdx).replace(/^\n[ \t]*Mensaje\s*:[ \t]*\n?/, '');
    body = body.replace(/\n+[ \t]*Revisa el (mensaje|contenido)[\s\S]*$/i, '');
    const rawFrom = field(head, 'De');
    const userM = rawFrom.match(/^\s*@?\s*([^()]+?)\s*\(\s*(U[A-Z0-9]+)\s*\)\s*$/);
    const channelRaw = field(head, 'Canal');
    let channel = '', channelName = '';
    const labeled = channelRaw.match(/^\s*(.+?)\s*\(\s*([CDG][A-Z0-9]{6,})\s*\)\s*$/);
    const bare = channelRaw.match(/^\s*([CDG][A-Z0-9]{6,})\s*$/);
    if (labeled) { channelName = labeled[1].trim(); channel = labeled[2].trim(); }
    else if (bare) { channel = bare[1].trim(); }
    else { channelName = channelRaw; }
    const key = (channel || channelName).charAt(0).toUpperCase();
    const channelKind = key === 'D' ? 'dm' : key === 'G' ? 'group' : 'channel';
    const attachmentsRaw = field(head, 'Adjuntos');
    let attachments = [];
    if (attachmentsRaw) {
      const lines = attachmentsRaw.split(/\n+/).map((s) => s.trim()).filter(Boolean);
      attachments = (lines.length > 1 ? lines : attachmentsRaw.split(',').map((s) => s.trim()).filter(Boolean));
      attachments = [...new Set(attachments)];
    }
    return {
      direction: headerMatch[1] && headerMatch[1].toLowerCase() === 'outbound' ? 'outbound' : 'inbound',
      rawFrom,
      fromName: userM ? userM[1].trim() : rawFrom.replace(/^@/, '').trim(),
      fromUserId: userM ? userM[2].trim() : '',
      channel,
      channelName,
      channelKind,
      thread: field(head, 'Thread'),
      instance: field(head, 'Instancia'),
      attachments,
      body: body.replace(/^\n+/, '').replace(/\s+$/, ''),
    };
  }
  function buildSlack(msg) {
    const dir = msg.direction === 'outbound' ? 'enviado' : 'recibido';
    const fromLabel = msg.fromName || msg.rawFrom || '—';
    let channelTxt = msg.channelName;
    if (!channelTxt) channelTxt = !msg.channel ? '—' : msg.channelKind === 'dm' ? 'DM' : msg.channelKind === 'group' ? `grupo · ${msg.channel}` : `#${msg.channel}`;
    const threadShort = msg.thread ? (msg.thread.indexOf('.') > 0 ? msg.thread.slice(0, msg.thread.indexOf('.')) : msg.thread.slice(0, 10)) : '';

    const row = el('div', `slack-row slack-row--${msg.direction}`);
    const bubble = el('div', 'slack-bubble');
    bubble.innerHTML =
      `<div class="slack-bubble__header">` +
      `<span class="slack-bubble__avatar">${esc(initialsFor(fromLabel))}</span>` +
      `<div class="slack-bubble__person"><span class="slack-bubble__name" title="${attr(msg.rawFrom)}">${esc(fromLabel)}</span>` +
      (msg.fromUserId ? `<span class="slack-bubble__userid">${esc(msg.fromUserId)}</span>` : '') + `</div>` +
      `<span class="slack-bubble__channel slack-bubble__channel--${msg.channelKind}"><i>${msg.channelKind === 'dm' ? '💬' : '📢'}</i><span>${esc(channelTxt)}</span>` +
      (msg.channelName && msg.channel ? `<span class="slack-bubble__channelid">${esc(msg.channel)}</span>` : '') + `</span>` +
      (msg.instance ? `<span class="slack-bubble__instance" title="Workspace: ${attr(msg.instance)}">${esc(msg.instance)}</span>` : '') +
      `</div>` +
      (msg.attachments.length ? `<div class="slack-bubble__attachments">${msg.attachments.map((n) => `<span class="slack-bubble__attachment">📎 <span>${esc(n)}</span></span>`).join('')}</div>` : '') +
      `<div class="slack-bubble__body">${msg.body ? renderBubbleBody(msg.body) : '<span class="slack-bubble__empty">(sin texto)</span>'}</div>` +
      `<div class="slack-bubble__footer"><span class="slack-bubble__brand">Slack · ${esc(dir)}</span>${threadShort ? `<span class="slack-bubble__thread" title="thread_ts ${attr(msg.thread)}">thread #${esc(threadShort)}</span>` : ''}</div>`;
    row.appendChild(bubble);
    return row;
  }

  // ============================================================================
  // Gmail bubble  (GmailMessageBubble.tsx)
  // ============================================================================
  const QUOTED_HEADER_RE = /(?:^|\n)([ \t]*(?:On |El )[\s\S]*?(?:wrote|escribió):[ \t]*)(?=\n|$)/i;
  function parseAddress(raw) {
    if (!raw) return { name: '', email: '', raw: '' };
    const angle = raw.match(/^\s*"?([^"<]*?)"?\s*<\s*([^>\s]+)\s*>\s*$/);
    if (angle) return { name: angle[1].trim(), email: angle[2].trim(), raw };
    if (/@/.test(raw) && !/\s/.test(raw.trim())) return { name: '', email: raw.trim(), raw };
    return { name: raw.trim(), email: '', raw };
  }
  function splitQuotedThread(body) {
    if (!body) return { topBody: '', quotedBody: '' };
    const hm = QUOTED_HEADER_RE.exec(body);
    if (hm && typeof hm.index === 'number') {
      const offset = hm.index === 0 ? 0 : hm.index + 1;
      return { topBody: body.slice(0, offset).replace(/\s+$/, ''), quotedBody: body.slice(offset).trim() };
    }
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/^[ \t]*>+\s/.test(lines[i])) return { topBody: lines.slice(0, i).join('\n').replace(/\s+$/, ''), quotedBody: lines.slice(i).join('\n').trim() };
    }
    return { topBody: body, quotedBody: '' };
  }
  function formatEmailDate(date) {
    if (!date) return '';
    const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    if (isSameDay(date, new Date())) return `Hoy · ${time}`;
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} · ${time}`;
  }
  function parseEmailMessage(text) {
    if (!text) return null;
    const headerMatch = text.match(/^[ \t]*Nuevo correo de Gmail\s*\((inbound|outbound)\)\.?\s*$/im);
    if (!headerMatch) return null;
    const bodyIdx = text.search(/\n[ \t]*Cuerpo\s*:[ \t]*\n?/);
    if (bodyIdx < 0) return null;
    const head = text.slice(0, bodyIdx);
    let body = text.slice(bodyIdx).replace(/^\n[ \t]*Cuerpo\s*:[ \t]*\n?/, '');
    body = body.replace(/\n+[ \t]*Revisa el contenido[\s\S]*$/i, '');
    body = body.replace(/^\n+/, '').replace(/\s+$/, '');
    const { topBody, quotedBody } = splitQuotedThread(body);
    const labelsRaw = field(head, 'Labels');
    const attRaw = field(head, 'Adjuntos');
    const attachments = attRaw ? attRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    return {
      direction: headerMatch[1].toLowerCase(),
      from: parseAddress(field(head, 'De')),
      to: parseAddress(field(head, 'Para')),
      subject: field(head, 'Asunto'),
      date: parseDate(field(head, 'Fecha')),
      labels: labelsRaw ? labelsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [],
      thread: field(head, 'Thread'),
      uniqueAttachments: [...new Set(attachments)],
      topBody,
      quotedBody,
    };
  }
  function buildGmail(msg) {
    const dateLabel = formatEmailDate(msg.date);
    const subject = msg.subject || '(sin asunto)';
    const fromLabel = msg.from.name || msg.from.email || msg.from.raw || '—';
    const toLabel = msg.to.name || msg.to.email || msg.to.raw || '—';

    const row = el('div', `gmail-bubble-row gmail-${msg.direction}`);
    const bubble = el('div', 'gmail-bubble');
    bubble.innerHTML =
      `<div class="gmail-bubble-meta"><span class="gmail-bubble-icon">✉</span>` +
      `<span class="gmail-bubble-direction">${msg.direction === 'outbound' ? 'Enviado' : 'Recibido'}</span>` +
      msg.labels.map((l) => `<span class="gmail-bubble-label">${esc(l)}</span>`).join('') +
      (dateLabel ? `<span class="gmail-bubble-date">${esc(dateLabel)}</span>` : '') + `</div>` +
      `<div class="gmail-bubble-subject" title="${attr(subject)}">${esc(subject)}</div>` +
      `<div class="gmail-bubble-people">` +
      `<div class="gmail-bubble-person"><span class="gmail-bubble-avatar gmail-bubble-avatar-from">${esc(initialsFor(msg.from.name || msg.from.email))}</span>` +
      `<div class="gmail-bubble-person-text"><span class="gmail-bubble-person-role">De</span><span class="gmail-bubble-person-name" title="${attr(msg.from.raw)}">${esc(fromLabel)}</span>` +
      (msg.from.email && msg.from.name ? `<span class="gmail-bubble-person-email">${esc(msg.from.email)}</span>` : '') + `</div></div>` +
      `<div class="gmail-bubble-arrow">→</div>` +
      `<div class="gmail-bubble-person"><span class="gmail-bubble-avatar gmail-bubble-avatar-to">${esc(initialsFor(msg.to.name || msg.to.email))}</span>` +
      `<div class="gmail-bubble-person-text"><span class="gmail-bubble-person-role">Para</span><span class="gmail-bubble-person-name" title="${attr(msg.to.raw)}">${esc(toLabel)}</span>` +
      (msg.to.email && msg.to.name ? `<span class="gmail-bubble-person-email">${esc(msg.to.email)}</span>` : '') + `</div></div>` +
      `</div>`;

    if (msg.uniqueAttachments.length) {
      const att = el('div', 'gmail-bubble-attachments');
      att.innerHTML = `<span class="gmail-bubble-attachments-label">📎 ${msg.uniqueAttachments.length} adjunto${msg.uniqueAttachments.length === 1 ? '' : 's'}</span>` +
        `<div class="gmail-bubble-attachments-list">${msg.uniqueAttachments.map((n) => `<span class="gmail-bubble-attachment-chip">📎 ${esc(n)}</span>`).join('')}</div>`;
      bubble.appendChild(att);
    }

    const bodyWrap = el('div', 'gmail-bubble-body');
    bodyWrap.innerHTML = msg.topBody ? renderBubbleBody(msg.topBody) : '<span class="gmail-bubble-empty">(cuerpo vacío)</span>';
    if (shouldClamp(msg.topBody)) {
      bodyWrap.classList.add('tc-clamp');
      const more = el('button', 'gmail-bubble-more-btn', 'Mostrar más');
      more.type = 'button';
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = bodyWrap.classList.toggle('tc-clamp') === false;
        more.textContent = open ? 'Mostrar menos' : 'Mostrar más';
      });
      bubble.appendChild(bodyWrap);
      bubble.appendChild(more);
    } else {
      bubble.appendChild(bodyWrap);
    }

    if (msg.quotedBody) {
      const quoted = el('div', 'gmail-bubble-quoted');
      const toggle = el('button', 'gmail-bubble-quoted-toggle', '▸ Ver hilo previo');
      toggle.type = 'button';
      const qbody = el('blockquote', 'gmail-bubble-quoted-body');
      qbody.innerHTML = renderBubbleBody(msg.quotedBody);
      qbody.hidden = true;
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        qbody.hidden = !qbody.hidden;
        toggle.textContent = qbody.hidden ? '▸ Ver hilo previo' : '▾ Ocultar hilo previo';
      });
      quoted.appendChild(toggle);
      quoted.appendChild(qbody);
      bubble.appendChild(quoted);
    }

    bubble.appendChild(el('div', 'gmail-bubble-footer', `<span class="gmail-bubble-brand">Gmail</span>${msg.thread ? `<span class="gmail-bubble-thread" title="Thread ${attr(msg.thread)}">#${esc(msg.thread.slice(0, 8))}</span>` : ''}`));
    row.appendChild(bubble);
    return row;
  }

  // ============================================================================
  // Boss context / injected-instruction stripping (so the human-facing text is
  // clean). Mirrors parseBossContext + parseInjectedInstructions.
  // ============================================================================
  const BOSS_CONTEXT_START = '<<<BOSS_CONTEXT_START>>>';
  const BOSS_CONTEXT_END = '<<<BOSS_CONTEXT_END>>>';
  function stripBossContext(content) {
    const trimmed = content.trimStart();
    if (!trimmed.startsWith(BOSS_CONTEXT_START)) return content;
    const endIdx = trimmed.lastIndexOf(BOSS_CONTEXT_END);
    if (endIdx === -1) return content;
    return trimmed.slice(endIdx + BOSS_CONTEXT_END.length).trim();
  }
  function stripInjectedInstructions(content) {
    const normalized = content.replace(/\r\n/g, '\n').trim();
    const header = '## User Request';
    const idx = normalized.lastIndexOf(header);
    if (idx !== -1) {
      const user = normalized.slice(idx + header.length).trim();
      if (user) return user;
    }
    return content;
  }

  // ============================================================================
  // Delegation / work-plan blocks (assistant) — compact summary cards.
  // ============================================================================
  function parseDelegationBlock(content) {
    const m = content.match(/```delegation\s*\n([\s\S]*?)\n```/);
    if (!m) return null;
    try {
      const parsed = JSON.parse(m[1].trim());
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      return {
        delegations: arr.map((d) => ({
          name: d.selectedAgentName || 'Unknown',
          task: d.taskCommand || '',
          reasoning: d.reasoning || '',
          confidence: d.confidence || 'medium',
        })),
        rest: content.replace(/```delegation\s*\n[\s\S]*?\n```/, '').trim(),
      };
    } catch {
      return null;
    }
  }
  function buildDelegationBlock(d, deps) {
    const wrap = document.createDocumentFragment();
    for (const del of d.delegations) {
      const card = el('div', 'tc-delegation-card');
      const head = el('div', 'tc-delegation-card__head');
      head.innerHTML = `<span class="tc-delegation-card__icon">⊹</span><span class="tc-delegation-card__label">Delegation →</span>` +
        `<strong class="tc-delegation-card__agent">${esc(del.name)}</strong>` +
        `<span class="tc-delegation-card__conf tc-conf--${esc(del.confidence)}">${esc(del.confidence)}</span>`;
      card.appendChild(head);
      if (del.task) {
        const body = renderRichBody(del.task, deps);
        body.classList.add('tc-delegation-card__task');
        card.appendChild(body);
      }
      if (del.reasoning) card.appendChild(el('div', 'tc-delegation-card__reason', esc(del.reasoning)));
      wrap.appendChild(card);
    }
    return wrap;
  }

  function parseWorkPlanBlock(content) {
    const m = content.match(/```work-plan\s*\n([\s\S]*?)\n```/);
    if (!m) return null;
    try {
      const p = JSON.parse(m[1].trim());
      return {
        plan: {
          name: p.name || 'Unnamed Plan',
          description: p.description || '',
          phases: (p.phases || []).map((ph) => ({
            name: ph.name || '',
            execution: ph.execution || 'sequential',
            tasks: (ph.tasks || []).map((t) => ({ description: t.description || '', cls: t.suggestedClass || 'builder', agent: t.assignToAgentName || null })),
          })),
        },
        rest: content.replace(/```work-plan\s*\n[\s\S]*?\n```/, '').trim(),
      };
    } catch {
      return null;
    }
  }
  function buildWorkPlanBlock(w) {
    const plan = w.plan;
    const card = el('div', 'tc-workplan-card');
    let html = `<div class="tc-workplan-card__head"><span class="tc-workplan-card__icon">📋</span><strong>${esc(plan.name)}</strong></div>`;
    if (plan.description) html += `<div class="tc-workplan-card__desc">${esc(plan.description)}</div>`;
    for (const ph of plan.phases) {
      html += `<div class="tc-workplan-phase"><div class="tc-workplan-phase__name">${esc(ph.name)} <span class="tc-workplan-phase__exec">${esc(ph.execution)}</span></div>`;
      html += `<ul class="tc-workplan-tasks">${ph.tasks.map((t) =>
        `<li><span class="tc-workplan-task__cls">${esc(t.cls)}</span> ${esc(t.description)}${t.agent ? ` <span class="tc-workplan-task__agent">→ ${esc(t.agent)}</span>` : ''}</li>`).join('')}</ul></div>`;
    }
    card.innerHTML = html;
    return card;
  }

  // ============================================================================
  // Picked UI element / element screenshot context (from the extension's Pick &
  // Screenshot tools). Turns the raw "[UI element the user selected…]" payload —
  // Page / Selector / Tag / Box / Text / outerHTML / Request — into a compact
  // card with the user's request up top and a collapsible HTML preview.
  // ============================================================================
  const UIELEM_MARKER_RE = /\[UI element the user selected on the page\]/;
  const UIELEM_SHOT_RE = /\[Screenshot of a UI element the user selected\]/;
  // The set of known field labels; used as a lookahead so a multi-line value
  // (Text, outerHTML, Request) stops at the next field instead of the next line.
  const UIELEM_NEXT =
    '(?:Page|Selector|Tag|Box|Text|Computed styles|outerHTML|Request|React component|Component tree|Source|React version)[ \\t]*:';
  function uiGrab(text, label) {
    const re = new RegExp(
      '^[ \\t]*' + label + '[ \\t]*:[ \\t]*([\\s\\S]*?)(?=\\n[ \\t]*' + UIELEM_NEXT + '|(?![\\s\\S]))',
      'm'
    );
    const m = text.match(re);
    return m ? m[1].trim() : '';
  }
  function parseElementContext(text) {
    if (!text) return null;
    const isShot = UIELEM_SHOT_RE.test(text);
    if (!isShot && !UIELEM_MARKER_RE.test(text)) return null;
    const box = uiGrab(text, 'Box');
    const bm = box.match(/x=(-?\d+)\s+y=(-?\d+)\s+w=(\d+)\s+h=(\d+)/);
    const html = uiGrab(text, 'outerHTML')
      .replace(/^```\w*\s*\n?/, '')
      .replace(/\n?```\s*$/, '')
      .trim();
    return {
      isShot,
      page: uiGrab(text, 'Page'),
      selector: uiGrab(text, 'Selector'),
      tag: uiGrab(text, 'Tag'),
      rect: bm ? { x: +bm[1], y: +bm[2], w: +bm[3], h: +bm[4] } : null,
      text: uiGrab(text, 'Text'),
      html,
      shotPath: ((text.match(/Saved screenshot:\s*([^\n]+)/) || [])[1] || '').trim(),
      request: uiGrab(text, 'Request'),
      // React-aware pick (component resolved from the element's Fiber in the page).
      reactComponent: uiGrab(text, 'React component').replace(/^<|>$/g, ''),
      reactTree: uiGrab(text, 'Component tree'),
      reactSource: uiGrab(text, 'Source'),
    };
  }
  // Compact "tagname.firstclass" / "tagname#id" label from the raw Tag field.
  function elementTagLabel(tag) {
    if (!tag) return 'element';
    const name = (tag.match(/<\s*([\w-]+)/) || [])[1] || 'element';
    const idM = tag.match(/id="([^"]+)"/);
    if (idM) return name + '#' + idM[1].trim().split(/\s+/)[0];
    const clsM = tag.match(/class="([^"]+)"/);
    if (clsM) return name + '.' + clsM[1].trim().split(/\s+/)[0];
    return name;
  }
  function buildElementContext(ui, deps) {
    const card = el('div', 'tc-uielem-card');

    const head = el('div', 'tc-uielem-head');
    head.innerHTML =
      `<span class="tc-uielem-icon">${ui.reactComponent ? '⚛️' : '⊹'}</span>` +
      `<span class="tc-uielem-chip">${ui.isShot ? 'Element shot' : 'UI element'}</span>` +
      (ui.reactComponent
        ? `<span class="tc-uielem-comp" title="${attr(ui.reactTree || ui.reactComponent)}">&lt;${esc(ui.reactComponent)}&gt;</span>`
        : `<span class="tc-uielem-tag" title="${attr(ui.tag || '')}">${esc(elementTagLabel(ui.tag))}</span>`) +
      (ui.rect ? `<span class="tc-uielem-dims">${ui.rect.w} × ${ui.rect.h}</span>` : '') +
      (ui.html ? `<span class="tc-uielem-toggle">▸</span>` : '');
    card.appendChild(head);

    // The user's actual ask, up top and prominent.
    if (ui.request) {
      const req = renderRichBody(ui.request, deps);
      req.classList.add('tc-uielem-req');
      card.appendChild(req);
    }

    // Metadata rows (component / selector / page / screenshot path / text preview).
    const meta = el('div', 'tc-uielem-meta');
    if (ui.reactComponent && ui.reactTree && ui.reactTree !== ui.reactComponent) {
      const row = el('div', 'tc-uielem-row');
      row.innerHTML = `<span class="tc-uielem-k">tree</span><span class="tc-uielem-v">${esc(ui.reactTree)}</span>`;
      meta.appendChild(row);
    }
    if (ui.reactSource) {
      const row = el('div', 'tc-uielem-row');
      row.innerHTML = `<span class="tc-uielem-k">source</span><code class="tc-uielem-sel">${esc(ui.reactSource)}</code>`;
      meta.appendChild(row);
    }
    if (ui.selector) {
      const row = el('div', 'tc-uielem-row');
      row.innerHTML = `<span class="tc-uielem-k">selector</span><code class="tc-uielem-sel">${esc(ui.selector)}</code>`;
      meta.appendChild(row);
    }
    if (ui.page) {
      const row = el('div', 'tc-uielem-row');
      row.innerHTML = `<span class="tc-uielem-k">page</span><span class="tc-uielem-v">${esc(ui.page)}</span>`;
      meta.appendChild(row);
    }
    if (ui.shotPath) {
      const row = el('div', 'tc-uielem-row');
      row.innerHTML = `<span class="tc-uielem-k">📷</span><code class="tc-uielem-sel">${esc(ui.shotPath)}</code>`;
      meta.appendChild(row);
    }
    if (ui.text) {
      const t = el('div', 'tc-uielem-text');
      t.textContent = ui.text;
      meta.appendChild(t);
    }
    if (meta.childNodes.length) card.appendChild(meta);

    // Collapsible raw outerHTML preview (the bulky part).
    if (ui.html) {
      const pre = el('pre', 'tc-uielem-html');
      const code = el('code', null);
      code.textContent = ui.html;
      pre.appendChild(code);
      card.appendChild(pre);
      makeCollapsible(card, pre, head.querySelector('.tc-uielem-toggle'), ui.html);
    }

    return card;
  }

  // ============================================================================
  // Captured network request (extension's netContextBlock). Turns the raw
  // "[Network request captured in the browser]" payload — method/url/status,
  // headers and bodies — into a card with the request line up top, a coloured
  // method+status header, and a collapsible detail (headers + pretty-printed
  // JSON bodies).
  // ============================================================================
  const NET_MARKER = '[Network request captured in the browser]';
  const NET_NEXT = '(?:Page|Request headers|Request body|Response headers|Response body|Request)[ \\t]*:';
  function netGrab(text, label) {
    const re = new RegExp(
      '^[ \\t]*' + label + '[ \\t]*:[ \\t]*([\\s\\S]*?)(?=\\n[ \\t]*' + NET_NEXT + '|(?![\\s\\S]))',
      'm'
    );
    const m = text.match(re);
    return m ? m[1].trim() : '';
  }
  // Pretty-print a JSON body; leave non-JSON untouched.
  function prettyJson(s) {
    const t = (s || '').trim();
    if (!t || (t[0] !== '{' && t[0] !== '[')) return s;
    try { return JSON.stringify(JSON.parse(t), null, 2); } catch (_e) { return s; }
  }
  function parseNetworkContext(text) {
    if (!text || text.indexOf(NET_MARKER) === -1) return null;
    // The status line is the first line after the marker.
    const lines = text.slice(text.indexOf(NET_MARKER)).split('\n');
    const statusLine = (lines[1] || '').trim();
    const sm = statusLine.match(/^(\S+)\s+(.*?)\s+→\s+(\S+)\s*(.*)$/);
    let method = '', url = '', status = '', statusText = '', ms = '';
    if (sm) {
      method = sm[1];
      url = sm[2];
      status = sm[3];
      let tail = sm[4] || '';
      const mm = tail.match(/\((\d+)ms\)\s*$/);
      if (mm) { ms = mm[1]; tail = tail.slice(0, mm.index).trim(); }
      statusText = tail.trim();
    }
    return {
      method, url, status, statusText, ms,
      page: netGrab(text, 'Page'),
      reqHeaders: netGrab(text, 'Request headers'),
      reqBody: netGrab(text, 'Request body'),
      resHeaders: netGrab(text, 'Response headers'),
      resBody: netGrab(text, 'Response body'),
      request: netGrab(text, 'Request'),
    };
  }
  function buildNetworkContext(n, deps) {
    const card = el('div', 'tc-net-card');

    const head = el('div', 'tc-net-head');
    const sClass = !n.status || n.status === 'ERR' ? 's-err' : 's-' + (String(n.status)[0] || '') + 'xx';
    const statusLabel = (n.status || 'ERR') + (n.statusText ? ' ' + n.statusText : '');
    head.innerHTML =
      `<span class="tc-net-method m-${attr(n.method || '')}">${esc(n.method || '?')}</span>` +
      `<span class="tc-net-status ${sClass}">${esc(statusLabel)}</span>` +
      (n.ms ? `<span class="tc-net-ms">${esc(n.ms)}ms</span>` : '') +
      `<span class="tc-net-toggle">▸</span>`;
    card.appendChild(head);

    if (n.url) { const u = el('div', 'tc-net-url'); u.textContent = n.url; card.appendChild(u); }

    if (n.request) {
      const req = renderRichBody(n.request, deps);
      req.classList.add('tc-net-req');
      card.appendChild(req);
    }

    // Collapsible detail: page + headers + (pretty) bodies.
    const detail = el('div', 'tc-net-detail');
    const addSec = (label, content, isJson) => {
      if (!content) return;
      const sec = el('div', 'tc-net-sec');
      sec.appendChild(el('div', 'tc-net-sec-label', esc(label)));
      const pre = el('pre', 'tc-net-pre');
      const code = el('code', null);
      code.textContent = isJson ? prettyJson(content) : content;
      pre.appendChild(code);
      sec.appendChild(pre);
      detail.appendChild(sec);
    };
    if (n.page) {
      const sec = el('div', 'tc-net-sec');
      sec.innerHTML = `<span class="tc-net-sec-label">page</span><span class="tc-net-page">${esc(n.page)}</span>`;
      detail.appendChild(sec);
    }
    addSec('Request headers', n.reqHeaders, false);
    addSec('Request body', n.reqBody, true);
    addSec('Response headers', n.resHeaders, false);
    addSec('Response body', n.resBody, true);
    card.appendChild(detail);

    const full = [n.reqHeaders, n.reqBody, n.resHeaders, n.resBody].filter(Boolean).join('\n');
    makeCollapsible(card, detail, head.querySelector('.tc-net-toggle'), full);

    return card;
  }

  // ============================================================================
  // Captured browser error (extension's errorContextBlock). Same treatment as
  // the network card: a coloured kind/status header, the error message, and a
  // collapsible detail with pretty-printed JSON bodies / stack.
  // ============================================================================
  const ERR_MARKER = '[Browser error captured]';
  const ERR_NEXT = '(?:Page|Message|Request body|Response body|Stack|Request)[ \\t]*:';
  function errGrab(text, label) {
    const re = new RegExp(
      '^[ \\t]*' + label + '[ \\t]*:[ \\t]*([\\s\\S]*?)(?=\\n[ \\t]*' + ERR_NEXT + '|(?![\\s\\S]))',
      'm'
    );
    const m = text.match(re);
    return m ? m[1].trim() : '';
  }
  function parseErrorContext(text) {
    if (!text || text.indexOf(ERR_MARKER) === -1) return null;
    const lines = text.slice(text.indexOf(ERR_MARKER)).split('\n');
    // Kind line, e.g. "network/fetch 500 ×2" or "console/error ×1".
    const kindLine = (lines[1] || '').trim();
    const km = kindLine.match(/^(\S+?)(?:\s+(\d{3}))?(?:\s+×(\d+))?\s*$/);
    const kind = km ? km[1] : (kindLine || 'error');
    const status = km && km[2] ? km[2] : '';
    const count = km && km[3] ? km[3] : '';
    // The method+url (or "URL: …") line has no label — find it positionally.
    let method = '', url = '';
    for (const l of lines) {
      const mu = l.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S.*)$/);
      if (mu) { method = mu[1]; url = mu[2].trim(); break; }
      const uu = l.match(/^URL:\s*(\S.*)$/);
      if (uu) { url = uu[1].trim(); break; }
    }
    return {
      kind, status, count, method, url,
      // Page is a single URL; grab just its line so it doesn't swallow the
      // unlabeled "GET <url>" line that follows it.
      page: ((text.match(/^[ \t]*Page[ \t]*:[ \t]*(.*)$/m) || [])[1] || '').trim(),
      message: errGrab(text, 'Message'),
      reqBody: errGrab(text, 'Request body'),
      resBody: errGrab(text, 'Response body'),
      stack: errGrab(text, 'Stack'),
      request: errGrab(text, 'Request'),
    };
  }
  function buildErrorContext(er, deps) {
    const card = el('div', 'tc-err-card');

    const head = el('div', 'tc-err-head');
    head.innerHTML =
      `<span class="tc-err-badge">⚠ error</span>` +
      `<span class="tc-err-kind">${esc(er.kind)}</span>` +
      (er.status ? `<span class="tc-err-status">${esc(er.status)}</span>` : '') +
      (er.count && er.count !== '1' ? `<span class="tc-err-count">×${esc(er.count)}</span>` : '') +
      `<span class="tc-err-toggle">▸</span>`;
    card.appendChild(head);

    if (er.url) {
      const u = el('div', 'tc-err-url');
      u.textContent = (er.method ? er.method + ' ' : '') + er.url;
      card.appendChild(u);
    }
    if (er.message) card.appendChild(el('div', 'tc-err-msg', esc(er.message)));

    if (er.request) {
      const req = renderRichBody(er.request, deps);
      req.classList.add('tc-err-req');
      card.appendChild(req);
    }

    const detail = el('div', 'tc-err-detail');
    const addSec = (label, content, isJson) => {
      if (!content) return;
      const sec = el('div', 'tc-net-sec');
      sec.appendChild(el('div', 'tc-net-sec-label', esc(label)));
      const pre = el('pre', 'tc-net-pre');
      const code = el('code', null);
      code.textContent = isJson ? prettyJson(content) : content;
      pre.appendChild(code);
      sec.appendChild(pre);
      detail.appendChild(sec);
    };
    if (er.page) {
      const sec = el('div', 'tc-net-sec');
      sec.innerHTML = `<span class="tc-net-sec-label">page</span><span class="tc-net-page">${esc(er.page)}</span>`;
      detail.appendChild(sec);
    }
    addSec('Request body', er.reqBody, true);
    addSec('Response body', er.resBody, true);
    addSec('Stack', er.stack, true);
    card.appendChild(detail);

    const full = [er.reqBody, er.resBody, er.stack].filter(Boolean).join('\n');
    makeCollapsible(card, detail, head.querySelector('.tc-err-toggle'), full);

    return card;
  }

  // ============================================================================
  // Attached files (extension's "[Attached file(s)]" block). Lists each file;
  // images become clickable thumbnails that open the in-panel lightbox (the host
  // wires a chat click handler for .tc-att-img), others show a doc chip.
  // ============================================================================
  const ATT_MARKER_RE = /\[Attached files?\]/;
  const ATT_FILE_RE = /^-\s+(.+?):\s+(\/.+?)\s*$/gm;
  const ATT_IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;
  function parseAttachedFiles(text) {
    if (!text || !ATT_MARKER_RE.test(text)) return null;
    const files = [];
    let m;
    ATT_FILE_RE.lastIndex = 0;
    while ((m = ATT_FILE_RE.exec(text)) !== null) {
      const name = m[1].trim();
      const path = m[2].trim();
      files.push({ name, path, isImage: ATT_IMG_RE.test(name) || ATT_IMG_RE.test(path) });
    }
    if (!files.length) return null;
    const rm = text.match(/^[ \t]*Request[ \t]*:[ \t]*([\s\S]*?)(?![\s\S])/m);
    return { files, request: rm ? rm[1].trim() : '' };
  }
  function buildAttachedFiles(att, deps) {
    const resolve = (deps && deps.resolveImage) || ((p) => p);
    const card = el('div', 'tc-att-card');

    const n = att.files.length;
    const head = el('div', 'tc-att-head');
    head.innerHTML = `<span class="tc-att-icon">📎</span><span class="tc-att-title">${n} attachment${n > 1 ? 's' : ''}</span>`;
    card.appendChild(head);

    if (att.request) {
      const req = renderRichBody(att.request, deps);
      req.classList.add('tc-att-req');
      card.appendChild(req);
    }

    const list = el('div', 'tc-att-list');
    for (const f of att.files) {
      if (f.isImage) {
        const url = resolve(f.path);
        const fig = el('figure', 'tc-att-img-wrap');
        fig.innerHTML =
          `<img class="tc-att-img" src="${attr(url)}" alt="${attr(f.name)}" title="${attr(f.name)} — click to enlarge" loading="lazy"/>` +
          `<figcaption>${esc(f.name)}</figcaption>`;
        list.appendChild(fig);
      } else {
        const chip = el('div', 'tc-att-doc');
        chip.innerHTML = `<span class="tc-att-doc-ic">📄</span><span class="tc-att-doc-name" title="${attr(f.path)}">${esc(f.name)}</span>`;
        list.appendChild(chip);
      }
    }
    card.appendChild(list);
    return card;
  }

  // ============================================================================
  // Dispatch — returns an HTMLElement/fragment for the message content, or null
  // if it has no special block (caller renders the default body).
  // ============================================================================
  function appendRest(target, restText, deps) {
    if (!restText) return;
    const rest = renderRichBody(restText, deps);
    rest.classList.add('tc-card-rest');
    target.appendChild(rest);
  }

  // /compact result pill (mirrors Guake's .output-compacted-notice).
  function buildCompactedNotice() {
    const row = el('div', 'msg msg-compacted');
    const pill = el('div', 'output-compacted-notice');
    pill.appendChild(el('span', 'compacted-icon', '🗜️'));
    pill.appendChild(el('span', 'compacted-label', 'Context compacted'));
    row.appendChild(pill);
    return row;
  }

  // role: 'user' | 'assistant'. Returns a node wrapping the rendered card(s),
  // the HIDE sentinel (render nothing), or null (caller renders the default body).
  function renderSpecial(content, role, deps) {
    if (!content) return null;
    deps = deps || {};

    // /compact: turn the "Compacted" stdout into a pill; hide the command echo +
    // local-command caveats. Checked on RAW content before any stripping, and
    // before role branching (the stdout arrives as a user message).
    if (content.indexOf('<local-command-stdout>') !== -1) {
      const m = content.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
      if (m && m[1].replace(/\x1b?\[\d+m/g, '').trim() === 'Compacted') {
        return buildCompactedNotice();
      }
    }
    if (
      content.indexOf('<local-command-caveat>') !== -1 ||
      content.indexOf('<command-name>/compact</command-name>') !== -1 ||
      content.indexOf('<command-name>/context</command-name>') !== -1 ||
      content.indexOf('<command-name>/cost</command-name>') !== -1
    ) {
      return HIDE;
    }

    if (role === 'user') {
      const text = stripInjectedInstructions(stripBossContext(content)).trim();

      const ui = parseElementContext(text);
      if (ui) return wrapCard(buildElementContext(ui, deps));

      const net = parseNetworkContext(text);
      if (net) return wrapCard(buildNetworkContext(net, deps));

      const er = parseErrorContext(text);
      if (er) return wrapCard(buildErrorContext(er, deps));

      const att = parseAttachedFiles(text);
      if (att) return wrapCard(buildAttachedFiles(att, deps));

      const dt = parseDelegatedTaskMessage(text);
      if (dt) return wrapCard(buildDelegatedTask(dt, deps));

      const tr = parseTaskReportMessage(text);
      if (tr) return wrapCard(buildTaskReport(tr, deps));

      const tn = parseTaskNotification(text);
      if (tn) { const w = wrapCard(buildTaskNotification(tn, deps)); appendRest(w, tn.rest, deps); return w; }

      const sn = parseSubagentNotification(text);
      if (sn) { const w = wrapCard(buildSubagentNotification(sn)); appendRest(w, sn.rest, deps); return w; }

      const ac = parseAgentChatMessage(text);
      if (ac) return wrapCard(buildAgentChatCard(ac, deps));

      const wa = parseWhatsAppMessage(text);
      if (wa) return wrapCard(buildWhatsApp(wa));

      const sl = parseSlackMessage(text);
      if (sl) return wrapCard(buildSlack(sl));

      const gm = parseEmailMessage(text);
      if (gm) return wrapCard(buildGmail(gm));

      return null;
    }

    // assistant
    const wp = parseWorkPlanBlock(content);
    const del = parseDelegationBlock(wp ? wp.rest : content);
    if (wp || del) {
      const w = wrapCard(null);
      const restText = del ? del.rest : wp.rest;
      if (restText) { const r = renderRichBody(restText, deps); w.appendChild(r); }
      if (wp) w.appendChild(buildWorkPlanBlock(wp));
      if (del) w.appendChild(buildDelegationBlock(del, deps));
      return w;
    }
    return null;
  }

  function wrapCard(node) {
    const div = el('div', 'msg msg-card');
    if (node) div.appendChild(node);
    return div;
  }

  // ============================================================================
  // Interactive agent prompt (AskUserQuestion / ExitPlanMode)
  // ----------------------------------------------------------------------------
  // Built from a structured `agent_prompt_request` WS payload (NOT message
  // content), so this lives outside renderSpecial. The host wires it up via:
  //   prompt = { id, agentId, tool, input }
  //   deps   = { md, esc, respond(requestId, approved, { answers, reason }) -> Promise<{ok,error}> }
  // Mirrors src/packages/client/components/ClaudeOutputPanel/AgentPromptCard.tsx.
  // ============================================================================
  function finishCard(card, text, kind) {
    card.className = 'agent-prompt-card resolved ' + (kind || '');
    card.innerHTML = '';
    card.appendChild(el('div', 'agent-prompt-resolved', esc(text)));
  }
  function showPromptError(container, text) {
    let e = container.querySelector('.agent-prompt-error');
    if (!e) {
      e = el('span', 'agent-prompt-error');
      container.insertBefore(e, container.firstChild);
    }
    e.textContent = text;
  }

  function renderAgentPrompt(prompt, deps) {
    if (!prompt || !prompt.id || !prompt.tool) return null;
    deps = deps || {};
    if (prompt.tool === 'AskUserQuestion') return buildAskUserQuestion(prompt, deps);
    if (prompt.tool === 'ExitPlanMode') return buildExitPlanMode(prompt, deps);
    return null;
  }

  function buildAskUserQuestion(prompt, deps) {
    const rawQs = prompt.input && Array.isArray(prompt.input.questions) ? prompt.input.questions : [];
    const questions = rawQs.filter((q) => q && typeof q.question === 'string');

    const card = el('div', 'agent-prompt-card askuserquestion');
    card.dataset.promptId = prompt.id;

    const head = el('div', 'agent-prompt-header');
    head.innerHTML =
      '<span class="agent-prompt-icon">❓</span>' +
      '<span class="agent-prompt-title">Agent is asking</span>' +
      `<span class="agent-prompt-badge">${questions.length} question${questions.length === 1 ? '' : 's'}</span>`;
    card.appendChild(head);

    if (!questions.length) {
      card.appendChild(el('div', 'agent-prompt-empty', esc('(no questions provided)')));
      return card;
    }

    const picks = {}; // question text -> string | string[]
    const freeText = {}; // question text -> string (current input value)
    let submitting = false;

    const optionButtons = []; // { q, label, btn }
    const blocks = []; // { q, blockEl }
    const freeControls = []; // { input, useBtn }

    const isAnswered = (q) => {
      const a = picks[q.question];
      return Array.isArray(a) ? a.length > 0 : Boolean(a);
    };
    function pickOption(q, label) {
      if (q.multiSelect) {
        const cur = Array.isArray(picks[q.question]) ? picks[q.question] : [];
        picks[q.question] = cur.includes(label) ? cur.filter((l) => l !== label) : cur.concat(label);
      } else {
        picks[q.question] = label;
      }
    }

    const qWrap = el('div', 'agent-prompt-questions');
    card.appendChild(qWrap);

    questions.forEach((q) => {
      const block = el('div', 'agent-prompt-question');
      blocks.push({ q, blockEl: block });

      const qh = el('div', 'agent-prompt-question-header');
      let qhHtml = '';
      if (q.header) qhHtml += `<span class="agent-prompt-question-tag">${esc(q.header)}</span>`;
      qhHtml += `<span class="agent-prompt-question-text">${esc(q.question)}</span>`;
      if (q.multiSelect) qhHtml += '<span class="agent-prompt-multi">(multi)</span>';
      qhHtml += '<span class="agent-prompt-answered-mark">✓</span>';
      qh.innerHTML = qhHtml;
      block.appendChild(qh);

      const opts = el('div', 'agent-prompt-options');
      const optList = Array.isArray(q.options) ? q.options : [];
      optList.forEach((opt) => {
        if (!opt || typeof opt.label !== 'string') return;
        const btn = el('button', 'agent-prompt-option');
        btn.type = 'button';
        let bHtml = `<span class="agent-prompt-option-label">${esc(opt.label)}</span>`;
        if (opt.description) bHtml += `<span class="agent-prompt-option-desc">${esc(opt.description)}</span>`;
        btn.innerHTML = bHtml;
        btn.addEventListener('click', () => {
          if (submitting) return;
          pickOption(q, opt.label);
          sync();
        });
        opts.appendChild(btn);
        optionButtons.push({ q, label: opt.label, btn });
      });
      block.appendChild(opts);

      // Free-text "Or type your own answer…". Like the Guake terminal, applying
      // free text replaces the answer with a single string (even for multi).
      const ft = el('div', 'agent-prompt-freetext');
      const input = el('input', 'agent-prompt-freetext-input');
      input.type = 'text';
      input.placeholder = 'Or type your own answer…';
      const useBtn = el('button', 'agent-prompt-freetext-use', 'Use');
      useBtn.type = 'button';
      useBtn.disabled = true;
      const applyFt = () => {
        const text = (input.value || '').trim();
        if (!text || submitting) return;
        picks[q.question] = text;
        sync();
      };
      input.addEventListener('input', () => {
        freeText[q.question] = input.value;
        useBtn.disabled = submitting || !input.value.trim();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyFt();
        }
      });
      useBtn.addEventListener('click', applyFt);
      ft.appendChild(input);
      ft.appendChild(useBtn);
      block.appendChild(ft);
      freeControls.push({ input, useBtn });

      qWrap.appendChild(block);
    });

    const actions = el('div', 'agent-prompt-actions');
    const progressEl = el('span', 'agent-prompt-progress');
    const declineBtn = el('button', 'agent-prompt-btn deny', '✕ Decline');
    declineBtn.type = 'button';
    const submitBtn = el('button', 'agent-prompt-btn approve', '✓ Submit answers');
    submitBtn.type = 'button';
    actions.appendChild(progressEl);
    actions.appendChild(declineBtn);
    actions.appendChild(submitBtn);
    card.appendChild(actions);

    function setBusy(b) {
      submitting = b;
      card.classList.toggle('busy', b);
      optionButtons.forEach(({ btn }) => { btn.disabled = b; });
      declineBtn.disabled = b;
      freeControls.forEach(({ input, useBtn }) => {
        input.disabled = b;
        useBtn.disabled = b || !input.value.trim();
      });
    }
    function sync() {
      optionButtons.forEach(({ q, label, btn }) => {
        const a = picks[q.question];
        const selected = Array.isArray(a) ? a.includes(label) : a === label;
        btn.classList.toggle('selected', !!selected);
      });
      blocks.forEach(({ q, blockEl }) => blockEl.classList.toggle('answered', isAnswered(q)));
      const answeredCount = questions.filter(isAnswered).length;
      const allAnswered = answeredCount === questions.length;
      progressEl.textContent = allAnswered
        ? 'All questions answered'
        : `${answeredCount} of ${questions.length} answered`;
      progressEl.classList.toggle('complete', allAnswered);
      submitBtn.disabled = submitting || !allAnswered;
    }

    declineBtn.addEventListener('click', async () => {
      if (submitting) return;
      setBusy(true);
      const res = await deps.respond(prompt.id, false, { reason: 'User declined to answer' });
      if (res && res.ok) finishCard(card, '✕ Declined', 'askuserquestion');
      else { setBusy(false); sync(); showPromptError(actions, (res && res.error) || 'Failed to send'); }
    });
    submitBtn.addEventListener('click', async () => {
      if (submitting) return;
      if (questions.filter(isAnswered).length !== questions.length) return;
      setBusy(true); sync();
      const res = await deps.respond(prompt.id, true, { answers: picks });
      if (res && res.ok) finishCard(card, '✓ Answers sent', 'askuserquestion');
      else { setBusy(false); sync(); showPromptError(actions, (res && res.error) || 'Failed to send'); }
    });

    sync();
    return card;
  }

  function buildExitPlanMode(prompt, deps) {
    const plan = prompt.input && typeof prompt.input.plan === 'string' ? prompt.input.plan : '';
    const card = el('div', 'agent-prompt-card exitplanmode');
    card.dataset.promptId = prompt.id;
    let submitting = false;
    let expanded = true;

    const head = el('div', 'agent-prompt-header');
    head.innerHTML =
      '<span class="agent-prompt-icon">🗺️</span>' +
      '<span class="agent-prompt-title">Plan ready — approve to exit plan mode</span>';
    const toggle = el('button', 'agent-prompt-toggle', 'Hide plan');
    toggle.type = 'button';
    head.appendChild(toggle);
    card.appendChild(head);

    const planEl = el('div', 'agent-prompt-plan md');
    planEl.innerHTML = plan ? (deps.md ? deps.md(plan) : esc(plan)) : '<em>(no plan text)</em>';
    card.appendChild(planEl);
    toggle.addEventListener('click', () => {
      expanded = !expanded;
      planEl.style.display = expanded ? '' : 'none';
      toggle.textContent = expanded ? 'Hide plan' : 'Show plan';
    });

    const actions = el('div', 'agent-prompt-actions');
    const rejectBtn = el('button', 'agent-prompt-btn deny', '✕ Reject');
    rejectBtn.type = 'button';
    const approveBtn = el('button', 'agent-prompt-btn approve', '✓ Approve plan');
    approveBtn.type = 'button';
    actions.appendChild(rejectBtn);
    actions.appendChild(approveBtn);
    card.appendChild(actions);

    const setBusy = (b) => {
      submitting = b;
      card.classList.toggle('busy', b);
      rejectBtn.disabled = b;
      approveBtn.disabled = b;
    };
    approveBtn.addEventListener('click', async () => {
      if (submitting) return;
      setBusy(true);
      const res = await deps.respond(prompt.id, true, {});
      if (res && res.ok) finishCard(card, '✓ Plan approved', 'exitplanmode');
      else { setBusy(false); showPromptError(actions, (res && res.error) || 'Failed to send'); }
    });
    rejectBtn.addEventListener('click', async () => {
      if (submitting) return;
      setBusy(true);
      const res = await deps.respond(prompt.id, false, { reason: 'User rejected the plan' });
      if (res && res.ok) finishCard(card, '✕ Plan rejected', 'exitplanmode');
      else { setBusy(false); showPromptError(actions, (res && res.error) || 'Failed to send'); }
    });

    return card;
  }

  // ── browser-bridge curl chip ───────────────────────────────────────────────
  // Vanilla port of the commander's detectBrowserAction (curlParser.ts): turn a
  // `curl … /api/browser/<action> … -d '{…}'` Bash command into a compact, readable
  // chip (🤖 verb · target · detail · diff · tab) instead of a raw command dump.
  function truncMid(text, max) {
    const s = String(text == null ? '' : text);
    if (s.length <= max) return s;
    return s.slice(0, Math.max(0, max - 1)) + '…';
  }
  function parseBrowserCurl(command) {
    if (typeof command !== 'string' || !command) return null;
    const urlMatch = /https?:\/\/[^/\s'"]+\/api\/browser\/([A-Za-z0-9/_-]+)/.exec(command);
    if (!urlMatch) return null;
    const endpoint = urlMatch[1].toLowerCase().replace(/\/+$/, '');

    // Pull the JSON body out of -d '…' (single-quoted bash bodies can't contain a
    // bare ', so non-greedy to the next ' is exact) or -d "…". Parse best-effort;
    // an unparseable body still yields a useful verb from the endpoint.
    let body = {};
    let m = /(?:-d|--data(?:-raw|-binary)?)\s+'([\s\S]*?)'(?:\s|$)/.exec(command);
    if (!m) m = /(?:-d|--data(?:-raw|-binary)?)\s+"((?:[^"\\]|\\.)*)"/.exec(command);
    if (m) {
      try {
        const parsed = JSON.parse(m[1]);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;
      } catch (_e) {
        /* keep body = {} */
      }
    }

    const asStr = (v) => (typeof v === 'string' && v.length ? v : typeof v === 'number' ? String(v) : undefined);
    let tab;
    if (body.tabId != null && body.tabId !== '') tab = '#' + String(body.tabId);
    else if (typeof body.tab === 'string' && body.tab) tab = body.tab;

    const diff = body.diff === true;
    let verb = endpoint;
    let target = asStr(body.selector) || asStr(body.text);
    let detail;

    switch (endpoint) {
      case 'page': verb = 'Read page'; target = undefined; break;
      case 'dom':
        verb = body.actionable === true ? 'Map elements' : 'Read DOM';
        target = asStr(body.selector);
        break;
      case 'click': verb = 'Click'; break;
      case 'hover': verb = 'Hover'; break;
      case 'type':
        verb = 'Type';
        target = asStr(body.selector) || asStr(body.within);
        detail = asStr(body.text) != null ? '“' + asStr(body.text) + '”' : undefined;
        break;
      case 'fill': {
        verb = 'Fill form';
        const fields = Array.isArray(body.fields) ? body.fields.length : 0;
        detail = fields + ' field' + (fields === 1 ? '' : 's');
        if (body.submit) detail += ' + submit';
        target = undefined;
        break;
      }
      case 'key': verb = 'Press key'; detail = asStr(body.key); target = asStr(body.selector); break;
      case 'select': verb = 'Select'; detail = asStr(body.label) || asStr(body.value); target = asStr(body.selector); break;
      case 'scroll': verb = 'Scroll'; break;
      case 'navigate': verb = 'Navigate'; target = asStr(body.url); break;
      case 'console': verb = 'Read console'; detail = asStr(body.level); target = undefined; break;
      case 'network': verb = 'Read network'; detail = asStr(body.filter); target = undefined; break;
      case 'errors': verb = 'Read errors'; target = undefined; break;
      case 'screenshot': verb = 'Screenshot'; target = asStr(body.selector); break;
      case 'batch': {
        verb = 'Batch';
        const steps = Array.isArray(body.steps) ? body.steps.length : 0;
        detail = steps + ' step' + (steps === 1 ? '' : 's');
        target = undefined;
        break;
      }
      case 'status': verb = 'Browser status'; target = undefined; break;
      case 'tabs': verb = 'List tabs'; target = undefined; break;
      case 'targets': verb = 'List targets'; target = undefined; break;
      case 'tab/open': verb = 'Open tab'; target = asStr(body.url); break;
      case 'tab/close': verb = 'Close tab'; break;
      case 'tab/activate': verb = 'Activate tab'; break;
      default: verb = endpoint.charAt(0).toUpperCase() + endpoint.slice(1); break;
    }
    return { endpoint, verb, target, detail, diff, tab };
  }
  function browserCurlChip(command) {
    const a = parseBrowserCurl(command);
    if (!a) return null;
    const parts = ['<i class="tchip-bico">🤖</i><span class="tchip-bverb">' + esc(a.verb) + '</span>'];
    if (a.target) parts.push('<code class="tchip-btarget">' + esc(truncMid(a.target, 48)) + '</code>');
    if (a.detail) parts.push('<span class="tchip-bdetail">' + esc(a.detail) + '</span>');
    if (a.diff) parts.push('<span class="tchip-bdiff">diff</span>');
    if (a.tab) parts.push('<span class="tchip-btab">' + esc(a.tab) + '</span>');
    const titleText = 'Browser · ' + a.verb + (a.target ? ' ' + a.target : '') + (a.tab ? ' (' + a.tab + ')' : '') + '\n' + String(command).slice(0, 400);
    return '<span class="tchip tchip-browser" title="' + attr(titleText) + '">' + parts.join('') + '</span>';
  }

  window.TCRenderers = {
    renderSpecial,
    renderRichBody,
    renderAgentPrompt,
    parseBrowserCurl,
    browserCurlChip,
    HIDE,
  };
})();

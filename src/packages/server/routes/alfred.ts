/**
 * Alfred Workflow Routes
 *
 * Powers the macOS Alfred workflow (integrations/alfred): the server does the
 * searching AND the formatting, returning ready-to-render Alfred Script Filter
 * JSON ({items: [...]}) so the workflow itself is a dumb curl. Mirrors the
 * in-app Spotlight's most-used behavior: AND-of-words matching across an
 * agent's name/class/status/cwd/area/task, agents ranked first (match tier,
 * then recency), then buildings and areas; a second endpoint wraps the global
 * conversation full-text search.
 *
 * Item args are consumed by the workflow's action script:
 *   focus:<agentId> — POST /api/focus-agent (select in already-open UIs)
 *   url:<absolute>  — open in the default browser (deep link ?agentId=…)
 *   copy:<text>     — copy to the clipboard
 */

import { Router, Request, Response } from 'express';
import type { Agent, Building } from '../../shared/types.js';
import type { DrawingArea } from '../../shared/common-types.js';
import { agentService } from '../services/index.js';
import { isPositionInArea } from '../services/area-layout-service.js';
import { loadAreas, loadBuildings } from '../data/index.js';
import { searchAllSessions } from '../claude/session-loader.js';
import { tokenizeAlfredQuery, alfredMatchTier } from './alfred-match.js';
import { createLogger } from '../utils/index.js';

const log = createLogger('Alfred');
const router = Router();

const DEFAULT_LIMIT = 9;

// ── Alfred Script Filter item shape ──────────────────────────────────────────

interface AlfredItem {
  uid?: string;
  title: string;
  subtitle: string;
  arg?: string;
  valid?: boolean;
  autocomplete?: string;
  text?: { copy?: string; largetype?: string };
  mods?: Record<string, { arg?: string; subtitle?: string; valid?: boolean }>;
}

const STATUS_DOT: Record<string, string> = {
  working: '🟢',
  idle: '⚪',
  error: '🔴',
};

function agentSubtitle(agent: Agent, areaName: string | undefined): string {
  const parts = [
    `${STATUS_DOT[agent.status] ?? '⚪'} ${agent.status}`,
    agent.class,
  ];
  if ((agent.provider ?? 'claude') !== 'claude') parts.push(agent.provider as string);
  if (areaName) parts.push(areaName);
  parts.push(agent.cwd);
  return parts.join(' · ');
}

function agentItem(agent: Agent, areaName: string | undefined, baseUrl: string): AlfredItem {
  const openUrl = `${baseUrl}/?agentId=${encodeURIComponent(agent.id)}&openTerminal=1`;
  return {
    uid: `agent-${agent.id}`,
    title: agent.name,
    subtitle: agentSubtitle(agent, areaName),
    arg: `focus:${agent.id}`,
    text: { copy: agent.id, largetype: `${agent.name}\n${agent.id}\n${agent.cwd}` },
    mods: {
      cmd: { arg: `url:${openUrl}`, subtitle: `Open in browser · ${openUrl}` },
      alt: { arg: `copy:${agent.id}`, subtitle: `Copy agent id · ${agent.id}` },
    },
  };
}

// ── GET /api/alfred/search ───────────────────────────────────────────────────

router.get('/search', (req: Request, res: Response) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT));
    const tokens = tokenizeAlfredQuery(query);
    const baseUrl = `${req.protocol}://${req.headers.host}`;

    const areas = loadAreas().filter((a) => !a.archived);
    const areaForAgent = (agent: Agent): DrawingArea | undefined =>
      areas.find((area) => isPositionInArea({ x: agent.position.x, z: agent.position.z }, area));

    // Agents — the primary block, exactly like the in-app Spotlight.
    const scoredAgents = agentService
      .getAllAgents()
      .map((agent) => {
        const area = areaForAgent(agent);
        const otherText = [
          agent.class,
          agent.status,
          agent.provider ?? 'claude',
          agent.cwd,
          area?.name ?? '',
          agent.taskLabel ?? '',
          agent.lastAssignedTask ?? '',
        ].join(' ');
        return { agent, area, tier: alfredMatchTier(tokens, agent.name, otherText) };
      })
      .filter((s) => s.tier > 0)
      .sort((a, b) => {
        if (b.tier !== a.tier) return b.tier - a.tier;
        return (b.agent.lastActivity ?? 0) - (a.agent.lastActivity ?? 0);
      })
      .slice(0, limit);

    const items: AlfredItem[] = scoredAgents.map((s) => agentItem(s.agent, s.area?.name, baseUrl));

    // Buildings — servers/bosses/databases; matched only with a query.
    if (tokens.length > 0) {
      const buildings: Building[] = loadBuildings();
      const scoredBuildings = buildings
        .map((b) => ({
          building: b,
          tier: alfredMatchTier(tokens, b.name, `${b.type} ${b.status ?? ''} ${b.cwd ?? ''}`),
        }))
        .filter((s) => s.tier > 0)
        .slice(0, 4);
      for (const { building } of scoredBuildings) {
        items.push({
          uid: `building-${building.id}`,
          title: building.name,
          subtitle: `🏢 ${building.type} · ${building.status ?? 'unknown'}${building.cwd ? ` · ${building.cwd}` : ''}`,
          arg: `url:${baseUrl}/`,
          text: { copy: building.name },
        });
      }

      // Areas — Enter refines the search to the area's name, which surfaces
      // every agent inside it (area names are part of agent search text).
      const scoredAreas = areas
        .map((a) => ({ area: a, tier: alfredMatchTier(tokens, a.name, '') }))
        .filter((s) => s.tier > 0)
        .slice(0, 3);
      for (const { area } of scoredAreas) {
        items.push({
          uid: `area-${area.id}`,
          title: area.name,
          subtitle: `🗺 area · ${area.assignedAgentIds.length} agents — ⏎ to list its agents`,
          valid: false,
          autocomplete: `${area.name} `,
        });
      }
    }

    if (items.length === 0) {
      items.push({
        title: query ? `No matches for “${query}”` : 'No agents yet',
        subtitle: 'Tide Commander',
        valid: false,
      });
    }

    res.json({ items });
  } catch (err) {
    log.error('alfred search failed:', err);
    res.json({ items: [{ title: 'Search failed', subtitle: String(err), valid: false }] });
  }
});

// ── GET /api/alfred/sessions ─────────────────────────────────────────────────

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  if (!Number.isFinite(diff) || diff < 0) return '';
  if (diff < 3600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
  return `${Math.floor(diff / 86400_000)}d`;
}

router.get('/sessions', async (req: Request, res: Response) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT));
    const baseUrl = `${req.protocol}://${req.headers.host}`;

    if (query.trim().length < 3) {
      res.json({
        items: [{ title: 'Keep typing…', subtitle: 'Full-text search needs at least 3 characters', valid: false }],
      });
      return;
    }

    const matches = await searchAllSessions(query, { limit });
    const agents = agentService.getAllAgents();

    const items: AlfredItem[] = matches.map((m) => {
      const attached = agents.find((a) => a.sessionId === m.sessionId);
      const title = (m.snippet || m.firstPrompt || m.sessionId).slice(0, 100);
      const when = timeAgo(m.lastModified);
      const subtitleParts = [m.provider, m.projectPath || '—', `${m.totalMatches}×`];
      if (when) subtitleParts.push(when);
      if (attached) subtitleParts.push(`→ ${attached.name}`);
      const item: AlfredItem = {
        uid: `session-${m.sessionId}`,
        title,
        subtitle: subtitleParts.join(' · '),
        text: { copy: m.sessionId, largetype: `${title}\n${m.sessionId}` },
      };
      if (attached) {
        item.arg = `focus:${attached.id}`;
        item.mods = {
          cmd: {
            arg: `url:${baseUrl}/?agentId=${encodeURIComponent(attached.id)}&openTerminal=1`,
            subtitle: `Open ${attached.name} in browser`,
          },
        };
      } else {
        // Orphan session — nothing to focus; open the UI to restore it.
        item.arg = `url:${baseUrl}/`;
        item.subtitle += ' · (not attached)';
      }
      return item;
    });

    if (items.length === 0) {
      items.push({ title: `No conversations mention “${query}”`, subtitle: 'Tide Commander sessions', valid: false });
    }

    res.json({ items });
  } catch (err) {
    log.error('alfred session search failed:', err);
    res.json({ items: [{ title: 'Session search failed', subtitle: String(err), valid: false }] });
  }
});

export default router;

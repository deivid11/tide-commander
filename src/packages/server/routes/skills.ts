/**
 * Skills Routes
 * REST API endpoints for skill CRUD (custom and builtin-readable).
 *
 * Mirrors the WebSocket skill handlers in functionality but provides a
 * stable HTTP surface for one-shot registration by other services or
 * automation that doesn't want to maintain a WS subscription.
 */

import { Router, Request, Response } from 'express';
import { skillService } from '../services/index.js';
import { createLogger, generateSlug } from '../utils/index.js';
import type { Skill } from '../../shared/common-types.js';
import type { ServerMessage } from '../../shared/types.js';

const log = createLogger('SkillsRoute');

const router = Router();

let broadcastFn: ((message: ServerMessage) => void) | null = null;

export function setBroadcast(fn: (message: ServerMessage) => void): void {
  broadcastFn = fn;
}

function broadcast(type: 'skill_created' | 'skill_updated' | 'skill_deleted', payload: unknown): void {
  if (!broadcastFn) return;
  broadcastFn({ type, payload } as ServerMessage);
}

// ----------------------------------------------------------------------------
// Body validation
// ----------------------------------------------------------------------------

interface SkillUpsertBody {
  slug?: string;
  name?: string;
  description?: string;
  content?: string;
  allowedTools?: string[];
  model?: string;
  context?: 'fork' | 'inline';
  assignedAgentIds?: string[];
  assignedAgentClasses?: string[];
  enabled?: boolean;
}

function validateUpsertBody(body: unknown): { body: SkillUpsertBody } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Request body must be a JSON object' };
  const b = body as Record<string, unknown>;

  if (typeof b.name !== 'string' || !b.name.trim()) return { error: 'name is required (string)' };
  if (typeof b.description !== 'string') return { error: 'description is required (string)' };
  if (typeof b.content !== 'string') return { error: 'content is required (string)' };

  if (b.allowedTools !== undefined && (!Array.isArray(b.allowedTools) || b.allowedTools.some(t => typeof t !== 'string'))) {
    return { error: 'allowedTools must be a string array' };
  }
  if (b.model !== undefined && typeof b.model !== 'string') return { error: 'model must be a string' };
  if (b.context !== undefined && b.context !== 'fork' && b.context !== 'inline') return { error: "context must be 'fork' or 'inline'" };
  if (b.enabled !== undefined && typeof b.enabled !== 'boolean') return { error: 'enabled must be boolean' };
  if (b.slug !== undefined && typeof b.slug !== 'string') return { error: 'slug must be a string' };

  return { body: b as SkillUpsertBody };
}

function normalizeSlug(slug: string): string {
  // Run through the canonical slug helper so callers can't sneak unsafe characters
  // into the persisted file. generateSlug is idempotent on already-safe input.
  return generateSlug(slug);
}

// ----------------------------------------------------------------------------
// GET /api/skills — list all
// ----------------------------------------------------------------------------

router.get('/', (_req: Request, res: Response) => {
  try {
    res.json({ skills: skillService.getAllSkills() });
  } catch (err: any) {
    log.error(' Failed to list skills:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// GET /api/skills/:slug — single
// ----------------------------------------------------------------------------

router.get('/:slug', (req: Request, res: Response) => {
  try {
    const slug = normalizeSlug(String(req.params.slug));
    const skill = skillService.getSkillBySlug(slug);
    if (!skill) return res.status(404).json({ error: `Skill not found: ${slug}` });
    res.json(skill);
  } catch (err: any) {
    log.error(' Failed to fetch skill:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// Upsert helper shared by PUT /:slug and POST /
// ----------------------------------------------------------------------------

function upsertSkill(slug: string, body: SkillUpsertBody, res: Response): void {
  const existing = skillService.getSkillBySlug(slug);

  if (!existing) {
    const created = skillService.createSkill({
      slug,
      name: body.name!,
      description: body.description!,
      content: body.content!,
      allowedTools: body.allowedTools,
      model: body.model,
      context: body.context,
      assignedAgentIds: body.assignedAgentIds,
      assignedAgentClasses: body.assignedAgentClasses as Skill['assignedAgentClasses'] | undefined,
      enabled: body.enabled,
    });
    broadcast('skill_created', created);
    log.log(` Created skill via HTTP: ${created.slug} (${created.id})`);
    res.status(201).json(created);
    return;
  }

  if (existing.builtin) {
    res.status(409).json({ error: `slug '${slug}' is owned by a builtin skill` });
    return;
  }

  const updates: Partial<Skill> = {
    name: body.name,
    description: body.description,
    content: body.content,
    slug,
  };
  if (body.allowedTools !== undefined) updates.allowedTools = body.allowedTools;
  if (body.model !== undefined) updates.model = body.model;
  if (body.context !== undefined) updates.context = body.context;
  if (body.assignedAgentIds !== undefined) updates.assignedAgentIds = body.assignedAgentIds;
  if (body.assignedAgentClasses !== undefined) updates.assignedAgentClasses = body.assignedAgentClasses as Skill['assignedAgentClasses'];
  if (body.enabled !== undefined) updates.enabled = body.enabled;

  const updated = skillService.updateSkill(existing.id, updates);
  if (!updated) {
    res.status(500).json({ error: `Failed to update skill ${slug}` });
    return;
  }
  broadcast('skill_updated', updated);
  log.log(` Updated skill via HTTP: ${updated.slug} (${updated.id})`);
  res.status(200).json(updated);
}

// ----------------------------------------------------------------------------
// PUT /api/skills/:slug — upsert by slug in URL
// ----------------------------------------------------------------------------

router.put('/:slug', (req: Request, res: Response) => {
  try {
    const urlSlug = normalizeSlug(String(req.params.slug));
    const v = validateUpsertBody(req.body);
    if ('error' in v) return res.status(400).json({ error: v.error });

    if (v.body.slug !== undefined && normalizeSlug(v.body.slug) !== urlSlug) {
      return res.status(400).json({ error: `URL slug '${urlSlug}' does not match body slug '${v.body.slug}'` });
    }

    upsertSkill(urlSlug, v.body, res);
  } catch (err: any) {
    log.error(' Failed to upsert skill:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// POST /api/skills — upsert with slug from body (or derived from name)
// ----------------------------------------------------------------------------

router.post('/', (req: Request, res: Response) => {
  try {
    const v = validateUpsertBody(req.body);
    if ('error' in v) return res.status(400).json({ error: v.error });

    const slug = v.body.slug ? normalizeSlug(v.body.slug) : generateSlug(v.body.name!);
    if (!slug) return res.status(400).json({ error: 'slug could not be derived from name' });

    upsertSkill(slug, v.body, res);
  } catch (err: any) {
    log.error(' Failed to upsert skill:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// DELETE /api/skills/:slug — delete custom skill (409 if builtin)
// ----------------------------------------------------------------------------

router.delete('/:slug', (req: Request, res: Response) => {
  try {
    const slug = normalizeSlug(String(req.params.slug));
    const skill = skillService.getSkillBySlug(slug);
    if (!skill) return res.status(404).json({ error: `Skill not found: ${slug}` });
    if (skill.builtin) return res.status(409).json({ error: `Cannot delete builtin skill '${slug}'` });

    const ok = skillService.deleteSkill(skill.id);
    if (!ok) return res.status(500).json({ error: `Failed to delete skill ${slug}` });

    broadcast('skill_deleted', { id: skill.id });
    log.log(` Deleted skill via HTTP: ${slug} (${skill.id})`);
    res.status(204).end();
  } catch (err: any) {
    log.error(' Failed to delete skill:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

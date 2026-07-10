/**
 * Grok (and some other providers) send TodoWrite with merge:true as partial
 * updates that only carry { id, status } — no content text. Claude usually
 * sends the full list every time. This helper merges partial updates into a
 * running list so the guake Task List never shows empty rows.
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface MergeableTodo {
  id?: string;
  content: string;
  status: TodoStatus;
  activeForm?: string;
}

const VALID_STATUSES: TodoStatus[] = ['pending', 'in_progress', 'completed'];

function normalizeStatus(raw: unknown): TodoStatus {
  if (typeof raw === 'string' && (VALID_STATUSES as string[]).includes(raw)) {
    return raw as TodoStatus;
  }
  return 'pending';
}

function asTodo(raw: unknown): MergeableTodo | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const id = typeof item.id === 'string' || typeof item.id === 'number'
    ? String(item.id)
    : undefined;
  const content =
    typeof item.content === 'string'
      ? item.content
      : typeof item.subject === 'string'
        ? item.subject
        : typeof item.text === 'string'
          ? item.text
          : typeof item.description === 'string'
            ? item.description
            : '';
  const status = normalizeStatus(item.status);
  const activeForm = typeof item.activeForm === 'string' ? item.activeForm : undefined;
  // Status-only merge rows still need to participate (content filled later).
  if (!content && !id) return null;
  return {
    id,
    content,
    status,
    ...(activeForm ? { activeForm } : {}),
  };
}

/**
 * Apply a TodoWrite payload onto a prior snapshot.
 * - merge:false / omitted → replace (but still fill missing content from prior by id)
 * - merge:true → start from prior, overlay by id, append new ids
 */
export function applyTodoWritePayload(
  prior: MergeableTodo[],
  payload: { todos?: unknown; merge?: unknown } | null | undefined
): MergeableTodo[] {
  if (!payload || !Array.isArray(payload.todos)) {
    return prior.slice();
  }

  const incoming = payload.todos
    .map(asTodo)
    .filter((t): t is MergeableTodo => t !== null);

  if (incoming.length === 0) {
    return prior.slice();
  }

  const merge = payload.merge === true;
  const priorById = new Map<string, MergeableTodo>();
  for (const t of prior) {
    if (t.id) priorById.set(t.id, t);
  }

  if (!merge) {
    // Full replace — but if Grok omits content on some rows, keep prior text by id.
    return incoming.map((t) => {
      if (t.content) return t;
      if (t.id && priorById.has(t.id)) {
        const prev = priorById.get(t.id)!;
        return {
          ...t,
          content: prev.content || (t.id ? `Task ${t.id}` : ''),
          activeForm: t.activeForm ?? prev.activeForm,
        };
      }
      return {
        ...t,
        content: t.content || (t.id ? `Task ${t.id}` : 'Task'),
      };
    });
  }

  // merge:true — start from prior list, update matching ids, append unknowns
  const next = prior.map((t) => ({ ...t }));
  const indexById = new Map<string, number>();
  next.forEach((t, i) => {
    if (t.id) indexById.set(t.id, i);
  });

  for (const t of incoming) {
    if (t.id && indexById.has(t.id)) {
      const idx = indexById.get(t.id)!;
      const prev = next[idx];
      next[idx] = {
        ...prev,
        status: t.status,
        content: t.content || prev.content || `Task ${t.id}`,
        activeForm: t.activeForm ?? prev.activeForm,
        id: t.id,
      };
    } else if (t.id) {
      indexById.set(t.id, next.length);
      next.push({
        ...t,
        content: t.content || `Task ${t.id}`,
      });
    } else if (t.content) {
      next.push(t);
    }
  }

  return next;
}

/** Parse a TodoWrite toolInput JSON string/object into a mergeable payload. */
export function parseTodoWritePayload(
  content: string | Record<string, unknown> | null | undefined
): { todos: unknown[]; merge?: boolean } | null {
  if (!content) return null;
  try {
    const input = typeof content === 'string' ? JSON.parse(content) : content;
    if (!input || typeof input !== 'object') return null;
    const todos = (input as { todos?: unknown }).todos;
    if (!Array.isArray(todos)) return null;
    return {
      todos,
      merge: (input as { merge?: unknown }).merge === true,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the display list for one TodoWrite event given prior state.
 * Always returns items with non-empty content for rendering.
 */
export function resolveTodoWriteDisplay(
  content: string | Record<string, unknown>,
  prior: MergeableTodo[] = []
): MergeableTodo[] {
  const payload = parseTodoWritePayload(content);
  if (!payload) return prior.slice();
  return applyTodoWritePayload(prior, payload);
}

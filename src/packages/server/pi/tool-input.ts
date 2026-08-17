interface PiEditOperation {
  oldText?: unknown;
  newText?: unknown;
}

interface PiEditResultDetails {
  patch?: unknown;
  firstChangedLine?: unknown;
}

/**
 * Translate Pi's edit-tool payload into the edit shape shared by Tide's UI.
 *
 * Pi sends `{ path, edits: [{ oldText, newText }] }`, while the diff cards
 * consume Claude-compatible `file_path`, `old_string`, `new_string`, and
 * `unified_diff` fields. The exact unified patch becomes available in the
 * tool result; before that, a single replacement can still be previewed from
 * the edit arguments.
 */
export function normalizePiToolInput(
  toolName: string,
  args: Record<string, unknown> | undefined,
  details?: PiEditResultDetails,
): Record<string, unknown> {
  const input = { ...(args || {}) };
  if (toolName.toLowerCase() !== 'edit') return input;

  if (typeof input.file_path !== 'string' && typeof input.path === 'string') {
    input.file_path = input.path;
  }

  const edits = Array.isArray(input.edits)
    ? input.edits.filter((edit): edit is PiEditOperation => !!edit && typeof edit === 'object')
    : [];

  if (edits.length > 0) {
    // Presence of these fields tells every terminal renderer this is a diff,
    // even for a multi-edit where no single old/new pair represents the call.
    input.operation = 'pi-edit';
    if (edits.length === 1) {
      input.old_string = typeof edits[0].oldText === 'string' ? edits[0].oldText : '';
      input.new_string = typeof edits[0].newText === 'string' ? edits[0].newText : '';
    } else {
      input.old_string = '';
      input.new_string = '';
    }
  }

  if (typeof details?.patch === 'string' && details.patch.trim()) {
    input.unified_diff = details.patch;
  }
  if (typeof details?.firstChangedLine === 'number') {
    input.first_changed_line = details.firstChangedLine;
  }

  return input;
}

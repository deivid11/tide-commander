import type { BuiltinSkillDefinition } from './types.js';

export const computerUse: BuiltinSkillDefinition = {
  slug: 'computer-use',
  name: 'Computer Use',
  description:
    'Observe and control the local Linux desktop through the Tide Computer Use CLI: inspect apps, accessibility trees and windows; capture screenshots; focus, click, drag, type, press keys, and manage windows.',
  allowedTools: ['Bash(tide-computer-use-linux:*)', 'Read'],
  // Live desktop control is powerful and potentially destructive. Enable it per agent/class.
  assignedAgentClasses: [],
  content: `# Computer Use

Use the **tide-computer-use-linux** CLI to observe and control the user's real Linux desktop. Every mutation affects live applications and may change files or external state.

## Prerequisite

Run **tide-computer-use-linux doctor** first. If the command is missing, stop and tell the user to install **@tide-commander/computer-use-linux**; do not substitute xdotool, shell file operations, or the Rust reference binary. Continue only when readiness has no blockers.

## Required workflow

1. **Inspect:** use windows, focused-window, apps, tree, or screenshot.
2. **Target:** select a unique window ID, accessibility object reference, or visible coordinate from fresh state. Never guess from stale coordinates.
3. **Act once:** issue the smallest requested mutation.
4. **Verify:** re-read the tree/window state, capture a screenshot, or verify the requested external effect. An ok response confirms event emission, not that the application accepted it.
5. If verification fails, inspect again before retrying. Never repeat blind clicks, drags, typing, or submissions.

## Batch actions

Use one batch when the user requests an ordered desktop sequence. Batches run sequentially, preserve the window selected by a focus step for later semantic click/drag steps, stop on the first failure by default, and return one timed result per attempted step.

~~~bash
tide-computer-use-linux batch '[
  {"action":"focusWindow","title":"Tabby"},
  "wait 500ms",
  {"action":"click","x":600,"y":400},
  {"action":"type","text":"echo hello"}
]'
~~~

Prefer structured objects for generated workflows. Shorthand supports focus NAME, click NAME, drag NAME to NAME, wait 10s, move X Y, key ctrl+l, type TEXT, scroll down 3, and screenshot. Use semantic click/drag names only after a unique focusWindow step or include an app selector in the structured action.

- Maximum 50 actions, 30 seconds per wait, and 120 seconds of total waiting.
- Use --continue only when later steps are genuinely independent of an earlier failure. Never continue a dependent UI flow after a failed focus, click, drag, or type.
- Inspect the returned steps array. Overall ok is true only when every requested action completed.
- Batch execution does not weaken confirmation rules: stop before irreversible final actions unless already explicitly authorized.

## Read-only commands

~~~bash
tide-computer-use-linux doctor
tide-computer-use-linux windows
tide-computer-use-linux focused-window
tide-computer-use-linux apps
tide-computer-use-linux tree "APP_OR_PID" 300
tide-computer-use-linux screenshot /tmp/desktop.png
tide-computer-use-linux pointer
~~~

Use Read on a screenshot path when visual inspection materially helps. Window titles and accessibility trees may expose private content; return only details relevant to the task.

## Window control

~~~bash
tide-computer-use-linux activate WINDOW_ID
tide-computer-use-linux move-window WINDOW_ID X Y
tide-computer-use-linux resize-window WINDOW_ID WIDTH HEIGHT
~~~

Resolve WINDOW_ID immediately before acting. Prefer exact appId, PID, or title matches; if several windows match, inspect and disambiguate.

## Semantic accessibility

Prefer semantic actions over pixel input when the element exposes an action or editable-text interface:

~~~bash
tide-computer-use-linux action OBJECT_REF Press
tide-computer-use-linux set-text OBJECT_REF "literal text"
~~~

Use the exact objectRef and action name from a fresh tree response. Accessibility references are session-local and can become stale after UI changes.

## Pointer and keyboard

~~~bash
tide-computer-use-linux move X Y
tide-computer-use-linux click X Y
tide-computer-use-linux drag X1 Y1 X2 Y2
tide-computer-use-linux key ctrl+l
tide-computer-use-linux type 'literal text'
~~~

- Activate the target window first. For terminal/canvas surfaces, click a safe point inside the client area before typing so the widget—not merely its window—owns keyboard focus.
- Do not append Enter unless the user asked to execute or submit.
- Coordinate actions require fresh window bounds or screenshots. Accessibility bounds can cover a whole row while only its icon/label accepts a drag; verify visually when precision matters.
- Text typing uses a US-layout native keyboard mapping. For non-ASCII text or non-US layouts, prefer set-text on an editable accessibility element.
- A failed UI drag remains a failed UI drag. Do not silently replace it with mv, database changes, API calls, or other non-UI mutations; explain the failure and ask before changing approach.

## Safety

- Read-only inspection is allowed when needed for the user's request.
- Treat the user's explicit request to click, drag, type, focus, or move something as authorization for that scoped action only.
- Before an irreversible or outward-facing final action—send, purchase, transfer, delete, publish, overwrite, or confirm—show the exact pending action and obtain explicit confirmation unless the user already explicitly requested that exact final action with the actual data.
- Never expose the local control server beyond loopback or reveal its bearer token.
- Stop after the requested outcome is verified; do not explore unrelated windows or content.`,
};

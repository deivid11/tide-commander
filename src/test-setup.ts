/**
 * Vitest global setup — runs before any test file is loaded.
 *
 * Why: server modules resolve their data dir at module-load time from
 *   XDG_DATA_HOME || ~/.local/share/tide-commander
 * (see src/packages/server/data/index.ts and trigger-store.ts).
 *
 * If a test process (with mocks possibly leaking, or with code paths the
 * mocks don't cover) instantiates a real ClaudeRunner, the runner's
 * recoverOrphanedProcesses() reads running-processes.json from the live
 * data dir, calls killUnknownTmuxSessions(), and kills tc-* tmux sessions
 * belonging to the live dev server. Repro: every `npm test` run was
 * killing live agents every ~20s.
 *
 * Fix: redirect XDG_DATA_HOME to a per-process temp dir BEFORE any
 * module imports it. Side effects of pointing at this sandbox:
 *   - running-processes.json reads/writes go to the sandbox (no clobber).
 *   - tmux-mode-setting.json doesn't exist in the sandbox → isTmuxEnabled()
 *     returns false → killUnknownTmuxSessions() early-returns → live
 *     tmux sessions are safe even if a runner accidentally start()s.
 *   - agents.json is empty → mocks must still provide agent fixtures, but
 *     tests do this already via vi.mock('./agent-service.js', ...).
 *
 * This file is wired into vitest.config.ts via `setupFiles`.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), `tc-test-xdg-${process.pid}-`));
process.env.XDG_DATA_HOME = sandboxRoot;

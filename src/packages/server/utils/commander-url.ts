/**
 * Runtime helpers that resolve the Commander server's base URL.
 *
 * The port is read from `process.env.PORT` at call time (not at module load)
 * so that any prompt or curl command built for an agent reflects the port the
 * commander is actually listening on — see src/packages/server/index.ts where
 * `PORT` is read the same way and defaults to 6200.
 *
 * Historically many skill bodies and a few dynamic prompt helpers hardcoded
 * `http://localhost:5174`. Call sites that render URLs for agent curls should
 * use this helper instead of hardcoding the port.
 */
const DEFAULT_PORT = '6200';

export function getCommanderBaseUrl(): string {
  const port = process.env.PORT || DEFAULT_PORT;
  return `http://localhost:${port}`;
}

/**
 * URL handed to spawned agents as `TIDE_SERVER`.
 *
 * `TIDE_PORT` (an explicit override for agents) wins, then the server's own
 * `PORT`, then the same default the server listens on. Sharing the default
 * keeps an agent's fallback from drifting away from where the server really
 * is: a stale fallback points the MCP permission prompt (AskUserQuestion,
 * ExitPlanMode) at a closed port.
 */
export function getAgentServerUrl(env: NodeJS.ProcessEnv = process.env): string {
  const port = env.TIDE_PORT || env.PORT || DEFAULT_PORT;
  return `http://localhost:${port}`;
}

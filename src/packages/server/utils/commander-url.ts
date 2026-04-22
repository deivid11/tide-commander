/**
 * Runtime helper that resolves the Commander server's base URL.
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
export function getCommanderBaseUrl(): string {
  const port = process.env.PORT || '6200';
  return `http://localhost:${port}`;
}

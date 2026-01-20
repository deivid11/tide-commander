/**
 * View mode filter helpers for determining which outputs to show
 */

/**
 * Helper to determine if output should be shown in simple view
 * NOTE: This extends the shared isSimpleViewOutput with additional patterns specific to this component
 */
export function isSimpleViewOutput(text: string): boolean {
  // SHOW tool names (will render with nice icons)
  if (text.startsWith('Using tool:')) return true;

  // HIDE tool input/result details
  if (text.startsWith('Tool input:')) return false;
  if (text.startsWith('Tool result:')) return false;

  // HIDE stats and system messages
  if (text.startsWith('Tokens:')) return false;
  if (text.startsWith('Cost:')) return false;
  if (text.startsWith('[thinking]')) return false;
  if (text.startsWith('[raw]')) return false;
  if (text.startsWith('Session started:')) return false;
  if (text.startsWith('Session initialized')) return false;

  // HIDE raw JSON tool parameters (common tool input fields)
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    // Common tool parameter keys
    const toolParamKeys = [
      '"file_path"',
      '"command"',
      '"pattern"',
      '"path"',
      '"content"',
      '"old_string"',
      '"new_string"',
      '"query"',
      '"url"',
      '"prompt"',
      '"notebook_path"',
      '"description"',
      '"offset"',
      '"limit"',
    ];
    if (toolParamKeys.some((key) => trimmed.includes(key))) {
      return false;
    }
  }

  // SHOW everything else (Claude's text responses)
  return true;
}

/**
 * Helper to determine if output should be shown in chat view (only user messages and final responses)
 * This aggressively filters out intermediate reasoning/planning messages
 */
export function isChatViewOutput(text: string): boolean {
  // HIDE all tool-related messages
  if (text.startsWith('Using tool:')) return false;
  if (text.startsWith('Tool input:')) return false;
  if (text.startsWith('Tool result:')) return false;

  // HIDE stats and system messages
  if (text.startsWith('Tokens:')) return false;
  if (text.startsWith('Cost:')) return false;
  if (text.startsWith('[thinking]')) return false;
  if (text.startsWith('[raw]')) return false;
  if (text.startsWith('Session started:')) return false;
  if (text.startsWith('Session initialized')) return false;

  // HIDE raw JSON tool parameters
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    const toolParamKeys = [
      '"file_path"',
      '"command"',
      '"pattern"',
      '"path"',
      '"content"',
      '"old_string"',
      '"new_string"',
      '"query"',
      '"url"',
      '"prompt"',
      '"notebook_path"',
      '"description"',
      '"offset"',
      '"limit"',
    ];
    if (toolParamKeys.some((key) => trimmed.includes(key))) {
      return false;
    }
  }

  // HIDE intermediate reasoning/planning messages (common patterns)
  const intermediatePatterns = [
    /^(let me|i'll|i will|now i|first,? i|i need to|i should|i'm going to)/i,
    /^(looking at|reading|checking|searching|exploring|examining|investigating)/i,
    /^(based on|from what|according to|it (looks|seems|appears))/i,
    /^(this (shows|indicates|suggests|means|is))/i,
    /^(the (code|file|function|class|component|implementation))/i,
    /^(now (let|i))/i,
  ];

  if (intermediatePatterns.some((pattern) => pattern.test(trimmed))) {
    return false;
  }

  // SHOW only what appears to be final responses (summaries, answers, etc.)
  return true;
}

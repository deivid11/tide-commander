// Format number with K/M suffix
export function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

// Format tokens with K suffix
export function formatTokens(tokens: number): string {
  if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M';
  if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K';
  return tokens.toString();
}

// Format relative time ago
export function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

// Format idle time in human readable format (for agent idle display)
export function formatIdleTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const secs = seconds % 60;
    return secs > 0 ? `${minutes}m ${secs}s ago` : `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) {
    return mins > 0 ? `${hours}h ${mins}m ago` : `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  const hrs = hours % 24;
  return hrs > 0 ? `${days}d ${hrs}h ago` : `${days}d ago`;
}

// getIdleTimerColor has been moved to utils/colors.ts
// Re-export for backwards compatibility
export { getIdleTimerColor } from './colors';

// Filter out cost/price mentions from text
// Used globally when hideCost setting is enabled
export function filterCostText(text: string, hideCost: boolean): string {
  if (!hideCost) return text;
  // Remove patterns like "$0.05", "cost: $1.23", "(cost $0.50)", "~$0.10", etc.
  return text
    .replace(/\s*\(?\s*~?\$[\d,.]+\s*\)?/g, '')
    .replace(/\s*cost[:\s]+~?\$[\d,.]+/gi, '')
    .replace(/\s*price[:\s]+~?\$[\d,.]+/gi, '')
    .replace(/\s*\(~?\$[\d,.]+\s*(?:USD|cost|spent)?\)/gi, '')
    .replace(/\s*-\s*~?\$[\d,.]+\s*$/g, '')  // trailing " - $0.05"
    .replace(/[^\S\n]+/g, ' ')  // normalize whitespace but preserve newlines
    .trim();
}

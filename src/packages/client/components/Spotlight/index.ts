/**
 * Spotlight - Barrel exports for backwards compatibility
 *
 * This allows existing imports to continue working:
 *   import { Spotlight } from './components/Spotlight';
 */

export { Spotlight } from './Spotlight';
export { useSpotlightSearch } from './useSpotlightSearch';
export { SpotlightInput } from './SpotlightInput';
export { SpotlightResults } from './SpotlightResults';
export { SpotlightItem } from './SpotlightItem';
export { SpotlightFooter } from './SpotlightFooter';

// Export types
export type {
  SpotlightProps,
  SearchResult,
  SearchResultType,
  UseSpotlightSearchOptions,
  SpotlightSearchState,
} from './types';

// Export utilities
export {
  getFileIconFromPath,
  getAgentIcon,
  formatDuration,
  formatRelativeTime,
  getTypeLabel,
} from './utils';

// Export constants
export { FILE_ICONS } from './types';

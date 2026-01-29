export { CharacterLoader } from './CharacterLoader';
export { CharacterFactory } from './CharacterFactory';
export type { AgentMeshData } from './CharacterFactory';

// HMR: Accept updates without full reload - mark as pending for manual refresh
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.log('[Tide HMR] Characters module updated - pending refresh available');
    window.__tideHmrPendingSceneChanges = true;
  });
}

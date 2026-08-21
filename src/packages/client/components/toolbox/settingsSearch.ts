export interface SettingsSearchSection {
  readonly id: string;
  readonly title: string;
  readonly keywords: readonly string[];
}

/**
 * Shared index for Settings search surfaces.
 *
 * Keep this list aligned with the sections rendered by ConfigSection. Both the
 * Settings panel and Spotlight use it so a query produces the same sections in
 * either place.
 */
export const SETTINGS_SEARCH_SECTIONS: readonly SettingsSearchSection[] = [
  { id: 'plugins', title: 'Plugins', keywords: ['plugin', 'plugins', 'extensions', 'install', 'enable', 'disable', 'trusted', 'local', 'slash commands', 'sidebar', 'modal', 'renderer'] },
  { id: 'general', title: 'General', keywords: ['history', 'hide costs', 'grid', 'fps', 'power saving', 'low power', 'battery', 'bajo consumo', 'performance', 'limit', 'editor', 'external editor', 'language', 'idioma', '语言', 'vibration', 'haptic', 'intensity', 'tab title', 'tmux', 'process persistence', 'interactive', 'tui', 'terminal', 'experimental', 'claude', 'stream', 'streaming', 'word by word', 'live text', 'grok', 'codex', 'app-server', 'app server', 'opencode', 'serve', 'pi', 'rpc', 'steer', 'steering', 'mid-turn', 'mid turn', 'hover', 'preview', 'tooltip', 'ctrl', 'popup', 'vista previa', 'sound', 'sounds', 'sonido', 'sonidos', 'notification', 'notifications', 'notificacion', 'notificaciones', 'volume', 'volumen', 'tone', 'tones', 'tono', 'chime', 'alert', 'cue', 'audio', 'mute', 'silence', 'dock', 'activity', 'recent', 'notification sound', 'silenciar', 'custom sound', 'upload sound', 'alerta', 'file search', 'excluded folders', 'node_modules', 'vendor', 'git', 'spotlight', 'ignore'] },
  { id: 'agentNames', title: 'Agent Names', keywords: ['agent', 'names', 'custom', 'characters', 'rename'] },
  { id: 'defaultClass', title: 'Default Spawn Class', keywords: ['default', 'class', 'spawn', 'agent', 'scout', 'builder', 'random'] },
  { id: 'appearance', title: 'Appearance', keywords: ['theme', 'appearance', 'color', 'dark', 'light', 'style', 'look'] },
  { id: 'connection', title: 'Connection', keywords: ['backend', 'url', 'auth', 'token', 'reconnect', 'server', 'api', 'connect', 'codex', 'opencode', 'binary', 'path'] },
  { id: 'scene', title: 'Scene', keywords: ['character', 'size', 'indicator', 'scale', 'time', 'dawn', 'day', 'dusk', 'night', 'auto'] },
  { id: 'terrain', title: 'Terrain', keywords: ['trees', 'bushes', 'house', 'lamps', 'grass', 'clouds', 'fog', 'brightness', 'floor', 'sky', 'color', 'environment', 'battlefield', 'size', 'grid', 'simple', 'minimal', 'dark', 'clean'] },
  { id: 'modelStyle', title: 'Agent Model Style', keywords: ['saturation', 'roughness', 'metalness', 'glow', 'emissive', 'reflections', 'wireframe', 'color mode', 'material', 'shader'] },
  { id: 'animations', title: 'Animations', keywords: ['idle', 'working', 'animation', 'walk', 'run', 'sprint', 'jump', 'sit', 'crouch'] },
  { id: 'secrets', title: 'Secrets', keywords: ['secrets', 'api', 'key', 'password', 'credentials', 'env', 'environment'] },
  { id: 'claudeAccounts', title: 'Claude Accounts', keywords: ['claude', 'accounts', 'credentials', 'oauth', 'rate limit', 'session', 'david', 'profile', 'switch account', 'subscription'] },
  { id: 'grokAccounts', title: 'Grok Accounts', keywords: ['grok', 'xai', 'x.ai', 'accounts', 'credentials', 'oauth', 'session', 'profile', 'switch account', 'subscription'] },
  { id: 'codexAccounts', title: 'Codex Accounts', keywords: ['codex', 'openai', 'chatgpt', 'accounts', 'credentials', 'oauth', 'session', 'profile', 'switch account', 'subscription'] },
  { id: 'systemPrompt', title: 'System Prompt', keywords: ['system', 'prompt', 'global', 'instructions', 'ai', 'agent', 'rules', 'guidelines'] },
  { id: 'data', title: 'Data', keywords: ['export', 'import', 'backup', 'restore', 'save', 'load', 'json'] },
  { id: 'integrations', title: 'Integrations', keywords: ['integrations', 'integraciones', 'gmail', 'slack', 'jira', 'calendar', 'docx', 'email', 'whatsapp', 'notifications', 'notification', 'baileys', 'history', 'historial', 'chat', 'messages', 'inbox', 'config', 'setup'] },
  { id: 'workflows', title: 'Workflows', keywords: ['workflow', 'automation', 'state machine', 'editor', 'actions', 'transitions', 'pipeline'] },
  { id: 'triggers', title: 'Triggers', keywords: ['trigger', 'event', 'webhook', 'cron', 'slack', 'email', 'jira', 'matching', 'fire'] },
  { id: 'monitoring', title: 'Monitoring', keywords: ['monitoring', 'logs', 'triggers', 'events', 'history', 'workflow', 'traces', 'audit', 'timeline'] },
  { id: 'statistics', title: 'Statistics', keywords: ['statistics', 'stats', 'usage', 'tokens', 'token', 'claude', 'chart', 'graph', 'pie', 'cost'] },
  { id: 'experimental', title: 'Experimental', keywords: ['experimental', '2d', 'view', 'voice', 'assistant', 'speech', 'tts', 'text to speech', 'echo', 'prompt', 'duplicate'] },
  { id: 'about', title: 'About', keywords: ['about', 'version', 'update', 'credits', 'github', 'releases'] },
];

/** Match sections with the same substring behavior used by the Settings panel. */
export function searchSettingsSections(query: string): readonly SettingsSearchSection[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return SETTINGS_SEARCH_SECTIONS;

  return SETTINGS_SEARCH_SECTIONS.filter((section) => (
    section.title.toLowerCase().includes(normalizedQuery)
    || section.keywords.some((keyword) => keyword.toLowerCase().includes(normalizedQuery))
  ));
}

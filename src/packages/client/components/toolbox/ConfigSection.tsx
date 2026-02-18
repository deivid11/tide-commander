import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { useStore, store } from '../../store';
import { STORAGE_KEYS, getStorageString, setStorageString, getAuthToken } from '../../utils/storage';
import { reconnect } from '../../websocket';
import { CollapsibleSection } from './CollapsibleSection';
import { SecretsSection } from './SecretsSection';
import { DataSection } from './DataSection';
import { AboutSection, ThemeSelector } from './AboutSection';
import { SystemPromptModal } from '../SystemPromptModal';
import { fetchEchoPromptSetting, updateEchoPromptSetting } from '../../api/system-settings';
import { BUILTIN_AGENT_NAMES } from '../../scene/config';
import type {
  SceneConfig,
  TerrainConfig,
  ModelStyleConfig,
  AnimationConfig,
  TimeMode,
  FloorStyle,
  AnimationType,
  ColorMode,
} from './types';
// LastPrompt and ClaudeOutput types are used elsewhere in the codebase

interface ConfigSectionProps {
  config: SceneConfig;
  onChange: (config: SceneConfig) => void;
  searchQuery?: string;
}

const TIME_MODE_OPTIONS: { value: TimeMode; label: string; icon: string }[] = [
  { value: 'auto', label: 'Auto', icon: '🕐' },
  { value: 'dawn', label: 'Dawn', icon: '🌅' },
  { value: 'day', label: 'Day', icon: '☀️' },
  { value: 'dusk', label: 'Dusk', icon: '🌇' },
  { value: 'night', label: 'Night', icon: '🌙' },
];

const FLOOR_STYLE_OPTIONS: { value: FloorStyle; label: string; icon: string }[] = [
  { value: 'none', label: 'Grass', icon: '🌱' },
  { value: 'concrete', label: 'Concrete', icon: '🏗️' },
  { value: 'galactic', label: 'Galactic', icon: '🌌' },
  { value: 'metal', label: 'Metal', icon: '⚙️' },
  { value: 'hex', label: 'Hex', icon: '⬡' },
  { value: 'circuit', label: 'Circuit', icon: '🔌' },
  { value: 'pokemon-stadium', label: 'Pokemon', icon: '🔴' },
];

const ANIMATION_OPTIONS: { value: AnimationType; label: string; icon: string }[] = [
  { value: 'static', label: 'Static', icon: '🧍' },
  { value: 'idle', label: 'Idle', icon: '🚶' },
  { value: 'walk', label: 'Walk', icon: '🚶‍♂️' },
  { value: 'sprint', label: 'Sprint', icon: '🏃' },
  { value: 'jump', label: 'Jump', icon: '⬆️' },
  { value: 'fall', label: 'Fall', icon: '⬇️' },
  { value: 'crouch', label: 'Crouch', icon: '🧎' },
  { value: 'sit', label: 'Sit', icon: '🪑' },
  { value: 'die', label: 'Die', icon: '💀' },
  { value: 'emote-yes', label: 'Yes', icon: '👍' },
  { value: 'emote-no', label: 'No', icon: '👎' },
];

// Color mode options for agent models
const COLOR_MODE_OPTIONS: { value: ColorMode; label: string; icon: string }[] = [
  { value: 'normal', label: 'Normal', icon: '🎨' },
  { value: 'bw', label: 'B&W', icon: '⬛' },
  { value: 'sepia', label: 'Sepia', icon: '🟤' },
  { value: 'cool', label: 'Cool', icon: '❄️' },
  { value: 'warm', label: 'Warm', icon: '🔥' },
  { value: 'neon', label: 'Neon', icon: '💜' },
];

// Terrain toggle options for icon-only display
const TERRAIN_OPTIONS: { key: keyof TerrainConfig; icon: string; label: string }[] = [
  { key: 'showTrees', icon: '🌳', label: 'Trees' },
  { key: 'showBushes', icon: '🌿', label: 'Bushes' },
  { key: 'showHouse', icon: '🏠', label: 'House' },
  { key: 'showLamps', icon: '💡', label: 'Lamps' },
  { key: 'showGrass', icon: '🟩', label: 'Grass' },
  { key: 'showClouds', icon: '☁️', label: 'Clouds' },
];

// Sky color presets
const SKY_COLOR_OPTIONS: { value: string | null; label: string; color: string }[] = [
  { value: null, label: 'Auto', color: 'linear-gradient(135deg, #4a90d9 0%, #0a1a2a 100%)' },
  { value: '#4a90d9', label: 'Day Blue', color: '#4a90d9' },
  { value: '#0a1a2a', label: 'Night', color: '#0a1a2a' },
  { value: '#ff6b35', label: 'Sunset', color: '#ff6b35' },
  { value: '#1a0a2e', label: 'Purple', color: '#1a0a2e' },
  { value: '#2d5a27', label: 'Matrix', color: '#2d5a27' },
  { value: '#8b0000', label: 'Blood', color: '#8b0000' },
  { value: '#000000', label: 'Void', color: '#000000' },
];

// Maps for translating option values to locale keys
const TERRAIN_KEY_MAP: Record<string, string> = {
  showTrees: 'trees', showBushes: 'bushes', showHouse: 'house',
  showLamps: 'lamps', showGrass: 'grass', showClouds: 'clouds',
};
const FLOOR_KEY_MAP: Record<string, string> = { none: 'grass', 'pokemon-stadium': 'pokemon' };
const ANIM_KEY_MAP: Record<string, string> = { 'emote-yes': 'yes', 'emote-no': 'no' };
const SKY_KEY_MAP: Record<string, string> = {
  '': 'auto', '#4a90d9': 'dayBlue', '#0a1a2a': 'night', '#ff6b35': 'sunset',
  '#1a0a2e': 'purple', '#2d5a27': 'matrix', '#8b0000': 'blood', '#000000': 'void',
};

// Compact toggle switch for config rows
function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="config-toggle">
      <input
        type="checkbox"
        className="config-toggle-input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="config-toggle-track">
        <span className="config-toggle-thumb" />
      </span>
    </label>
  );
}

// Compact chip selector for options
function ChipSelector<T extends string>({
  options,
  value,
  onChange,
  iconOnly = false,
}: {
  options: { value: T; label: string; icon: string }[];
  value: T;
  onChange: (value: T) => void;
  iconOnly?: boolean;
}) {
  return (
    <div className="chip-selector">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`chip ${value === opt.value ? 'active' : ''}`}
          onClick={() => onChange(opt.value)}
          title={opt.label}
        >
          <span className="chip-icon">{opt.icon}</span>
          {!iconOnly && <span className="chip-label">{opt.label}</span>}
        </button>
      ))}
    </div>
  );
}

// Highlight matching text in labels
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) return <>{text}</>;

  const before = text.slice(0, index);
  const match = text.slice(index, index + query.length);
  const after = text.slice(index + query.length);

  return (
    <>
      {before}
      <mark className="search-highlight">{match}</mark>
      {after}
    </>
  );
}

// Define searchable settings configuration (English keywords for search matching)
const SETTINGS_SECTIONS = [
  { id: 'general', title: 'General', keywords: ['history', 'hide costs', 'grid', 'fps', 'power saving', 'performance', 'limit', 'editor', 'external editor', 'language', 'idioma', '语言'] },
  { id: 'agentNames', title: 'Agent Names', keywords: ['agent', 'names', 'custom', 'characters', 'rename'] },
  { id: 'appearance', title: 'Appearance', keywords: ['theme', 'appearance', 'color', 'dark', 'light', 'style', 'look'] },
  { id: 'connection', title: 'Connection', keywords: ['backend', 'url', 'auth', 'token', 'reconnect', 'server', 'api', 'connect'] },
  { id: 'scene', title: 'Scene', keywords: ['character', 'size', 'indicator', 'scale', 'time', 'dawn', 'day', 'dusk', 'night', 'auto'] },
  { id: 'terrain', title: 'Terrain', keywords: ['trees', 'bushes', 'house', 'lamps', 'grass', 'clouds', 'fog', 'brightness', 'floor', 'sky', 'color', 'environment'] },
  { id: 'modelStyle', title: 'Agent Model Style', keywords: ['saturation', 'roughness', 'metalness', 'glow', 'emissive', 'reflections', 'wireframe', 'color mode', 'material', 'shader'] },
  { id: 'animations', title: 'Animations', keywords: ['idle', 'working', 'animation', 'walk', 'run', 'sprint', 'jump', 'sit', 'crouch'] },
  { id: 'secrets', title: 'Secrets', keywords: ['secrets', 'api', 'key', 'password', 'credentials', 'env', 'environment'] },
  { id: 'systemPrompt', title: 'System Prompt', keywords: ['system', 'prompt', 'global', 'instructions', 'ai', 'agent', 'rules', 'guidelines'] },
  { id: 'data', title: 'Data', keywords: ['export', 'import', 'backup', 'restore', 'save', 'load', 'json'] },
  { id: 'experimental', title: 'Experimental', keywords: ['experimental', '2d', 'view', 'voice', 'assistant', 'speech', 'tts', 'text to speech', 'echo', 'prompt', 'duplicate'] },
  { id: 'about', title: 'About', keywords: ['about', 'version', 'update', 'credits', 'github', 'releases'] },
];

const LANGUAGE_OPTIONS: { value: string; label: string; icon: string }[] = [
  { value: 'auto', label: 'Auto', icon: '🌐' },
  { value: 'en', label: 'English', icon: '🇺🇸' },
  { value: 'zh-CN', label: '中文', icon: '🇨🇳' },
  { value: 'es', label: 'Español', icon: '🇪🇸' },
  { value: 'hi', label: 'हिन्दी', icon: '🇮🇳' },
  { value: 'pt', label: 'Português', icon: '🇧🇷' },
  { value: 'ru', label: 'Русский', icon: '🇷🇺' },
  { value: 'ja', label: '日本語', icon: '🇯🇵' },
  { value: 'de', label: 'Deutsch', icon: '🇩🇪' },
  { value: 'fr', label: 'Français', icon: '🇫🇷' },
  { value: 'it', label: 'Italiano', icon: '🇮🇹' },
];

export function ConfigSection({ config, onChange, searchQuery = '' }: ConfigSectionProps) {
  const { t } = useTranslation(['config', 'common']);
  const state = useStore();
  const [historyLimit, setHistoryLimit] = useState(state.settings.historyLimit);
  const [backendUrl, setBackendUrl] = useState(() => getStorageString(STORAGE_KEYS.BACKEND_URL, ''));
  const [backendUrlDirty, setBackendUrlDirty] = useState(false);
  const [authToken, setAuthToken] = useState(() => getAuthToken());
  const [authTokenDirty, setAuthTokenDirty] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [isSystemPromptModalOpen, setIsSystemPromptModalOpen] = useState(false);

  // Sync echo prompt setting from server on mount
  React.useEffect(() => {
    fetchEchoPromptSetting().then((enabled) => {
      if (enabled !== state.settings.experimentalEchoPrompt) {
        store.updateSettings({ experimentalEchoPrompt: enabled });
      }
    }).catch(() => { /* ignore fetch errors on mount */ });
  }, []);

  // Translate option arrays at render time
  const tTimeOpts = TIME_MODE_OPTIONS.map(opt => ({ ...opt, label: t(`config:time.${opt.value}`) }));
  const tFloorOpts = FLOOR_STYLE_OPTIONS.map(opt => ({ ...opt, label: t(`config:floor.${FLOOR_KEY_MAP[opt.value] || opt.value}`) }));
  const tAnimOpts = ANIMATION_OPTIONS.map(opt => ({ ...opt, label: t(`config:animation.${ANIM_KEY_MAP[opt.value] || opt.value}`) }));
  const tColorModeOpts = COLOR_MODE_OPTIONS.map(opt => ({ ...opt, label: t(`config:colorMode.${opt.value}`) }));
  const tTerrainOpts = TERRAIN_OPTIONS.map(opt => ({ ...opt, label: t(`config:terrain.${TERRAIN_KEY_MAP[opt.key]}`) }));
  const tSkyOpts = SKY_COLOR_OPTIONS.map(opt => ({ ...opt, label: t(`config:sky.${SKY_KEY_MAP[opt.value ?? '']}`) }));

  // Filter sections based on search query
  const matchingSections = searchQuery.trim()
    ? SETTINGS_SECTIONS.filter((section) => {
        const query = searchQuery.toLowerCase();
        return (
          section.title.toLowerCase().includes(query) ||
          section.keywords.some((kw) => kw.toLowerCase().includes(query))
        );
      }).map((s) => s.id)
    : null; // null means show all

  const shouldShowSection = (sectionId: string) => {
    if (!matchingSections) return true;
    return matchingSections.includes(sectionId);
  };

  const customAgentNames = state.settings.customAgentNames || [];
  const effectiveNames = customAgentNames.length > 0 ? customAgentNames : BUILTIN_AGENT_NAMES;

  const handleAddAgentName = () => {
    const trimmedName = newAgentName.trim();
    if (trimmedName && !customAgentNames.includes(trimmedName)) {
      store.updateSettings({ customAgentNames: [...customAgentNames, trimmedName] });
      setNewAgentName('');
    }
  };

  const handleRemoveAgentName = (name: string) => {
    store.updateSettings({ customAgentNames: customAgentNames.filter(n => n !== name) });
  };

  const handleResetToDefaults = () => {
    store.updateSettings({ customAgentNames: [] });
  };

  const handleBackendUrlChange = (value: string) => {
    setBackendUrl(value);
    setBackendUrlDirty(true);
  };

  const handleBackendUrlSave = () => {
    setStorageString(STORAGE_KEYS.BACKEND_URL, backendUrl);
    setBackendUrlDirty(false);
    reconnect();
  };

  const handleAuthTokenChange = (value: string) => {
    setAuthToken(value);
    setAuthTokenDirty(true);
  };

  const handleAuthTokenSave = () => {
    setStorageString(STORAGE_KEYS.AUTH_TOKEN, authToken);
    setAuthTokenDirty(false);
    reconnect();
  };

  const updateTerrain = (updates: Partial<TerrainConfig>) => {
    onChange({ ...config, terrain: { ...config.terrain, ...updates } });
  };

  const updateModelStyle = (updates: Partial<ModelStyleConfig>) => {
    onChange({ ...config, modelStyle: { ...config.modelStyle, ...updates } });
  };

  const updateAnimations = (updates: Partial<AnimationConfig>) => {
    onChange({ ...config, animations: { ...config.animations, ...updates } });
  };

  const handleHistoryLimitChange = (value: number) => {
    setHistoryLimit(value);
    store.updateSettings({ historyLimit: value });
  };

  const toggleTerrain = (key: keyof TerrainConfig) => {
    const currentValue = config.terrain[key];
    if (typeof currentValue === 'boolean') {
      updateTerrain({ [key]: !currentValue });
    }
  };

  const isSearching = searchQuery.trim().length > 0;

  return (
    <>
    <div className="config-section">
      {matchingSections && matchingSections.length === 0 && (
        <div className="config-no-results">
          {t('config:noResults', { query: searchQuery })}
        </div>
      )}

      {shouldShowSection('general') && (
      <CollapsibleSection title={t('config:sections.general')} storageKey="general" defaultOpen={true} forceOpen={isSearching && shouldShowSection('general')}>
        <div className="config-row">
          <span className="config-label"><HighlightText text={t('config:general.history')} query={searchQuery} /></span>
          <input type="number" className="config-input config-input-sm" value={historyLimit} onChange={(e) => handleHistoryLimitChange(parseInt(e.target.value) || 100)} min={50} max={2000} step={50} />
        </div>
        <div className="config-row">
          <span className="config-label"><HighlightText text={t('config:general.hideCosts')} query={searchQuery} /></span>
          <Toggle checked={state.settings.hideCost} onChange={(checked) => store.updateSettings({ hideCost: checked })} />
        </div>
        <div className="config-row">
          <span className="config-label"><HighlightText text={t('config:general.grid')} query={searchQuery} /></span>
          <Toggle checked={config.gridVisible} onChange={(checked) => onChange({ ...config, gridVisible: checked })} />
        </div>
        <div className="config-row">
          <span className="config-label"><HighlightText text={t('config:general.showFPS')} query={searchQuery} /></span>
          <Toggle checked={state.settings.showFPS} onChange={(checked) => store.updateSettings({ showFPS: checked })} />
        </div>
        <div className="config-row">
          <span className="config-label"><HighlightText text={t('config:general.fpsLimit')} query={searchQuery} /></span>
          <input type="range" className="config-slider" min="0" max="120" step="10" value={config.fpsLimit} onChange={(e) => onChange({ ...config, fpsLimit: parseInt(e.target.value) })} />
          <span className="config-value">{config.fpsLimit === 0 ? '∞' : config.fpsLimit}</span>
        </div>
        <div className="config-row">
          <span className="config-label" title="Experimental: Reduce FPS when idle to save power"><HighlightText text={t('config:general.powerSaving')} query={searchQuery} /> ⚡</span>
          <Toggle checked={state.settings.powerSaving} onChange={(checked) => store.updateSettings({ powerSaving: checked })} />
        </div>
        <div className="config-row">
          <span className="config-label"><HighlightText text={t('config:general.externalEditor')} query={searchQuery} /></span>
          <input type="text" className="config-input" placeholder={t('config:general.externalEditorPlaceholder')} value={state.settings.externalEditorCommand || ''} onChange={(e) => store.updateSettings({ externalEditorCommand: e.target.value })} />
        </div>
        <div className="config-group">
          <span className="config-label"><HighlightText text={t('config:general.language')} query={searchQuery} /></span>
          <ChipSelector options={LANGUAGE_OPTIONS} value={localStorage.getItem('tide-commander-language-mode') === 'manual' ? (LANGUAGE_OPTIONS.find(o => o.value !== 'auto' && i18n.language.startsWith(o.value.split('-')[0]))?.value || 'en') : 'auto'} onChange={(lang) => {
            if (lang === 'auto') {
              localStorage.setItem('tide-commander-language-mode', 'auto');
              const navLang = navigator.language;
              const detected = LANGUAGE_OPTIONS.find(o => o.value !== 'auto' && navLang.startsWith(o.value.split('-')[0]))?.value || 'en';
              i18n.changeLanguage(detected);
            } else {
              localStorage.setItem('tide-commander-language-mode', 'manual');
              i18n.changeLanguage(lang);
            }
          }} />
        </div>
      </CollapsibleSection>
      )}

      {shouldShowSection('agentNames') && (
      <CollapsibleSection title={t('config:sections.agentNames')} storageKey="agentNames" defaultOpen={false} forceOpen={isSearching && shouldShowSection('agentNames')}>
        <div className="agent-names-section">
          <span className="config-hint">
            {customAgentNames.length > 0
              ? t('config:agentNames.customConfigured', { count: customAgentNames.length })
              : t('config:agentNames.usingDefaults')}
          </span>
          <div className="agent-names-input-row">
            <input type="text" className="config-input config-input-full" placeholder={t('config:agentNames.addPlaceholder')} value={newAgentName} onChange={(e) => setNewAgentName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { handleAddAgentName(); } }} />
            <button className="config-btn config-btn-sm" onClick={handleAddAgentName} disabled={!newAgentName.trim()} title={t('config:agentNames.addName')}>+</button>
          </div>
          <div className="agent-names-list">
            {effectiveNames.map((name, index) => (
              <div key={`${name}-${index}`} className="agent-name-chip">
                <span className="agent-name-text">{name}</span>
                {customAgentNames.length > 0 && (
                  <button className="agent-name-remove" onClick={() => handleRemoveAgentName(name)} title={t('common:buttons.remove')}>x</button>
                )}
              </div>
            ))}
          </div>
          {customAgentNames.length > 0 && (
            <button className="config-btn config-btn-link" onClick={handleResetToDefaults}>{t('common:buttons.resetToDefaults')}</button>
          )}
        </div>
      </CollapsibleSection>
      )}

      {shouldShowSection('appearance') && (
      <CollapsibleSection title={t('config:sections.appearance')} storageKey="appearance" defaultOpen={false} forceOpen={isSearching && shouldShowSection('appearance')}>
        <ThemeSelector />
      </CollapsibleSection>
      )}

      {shouldShowSection('connection') && (
      <CollapsibleSection title={t('config:sections.connection')} storageKey="connection" defaultOpen={false} forceOpen={isSearching && shouldShowSection('connection')}>
        <div className="config-row config-row-stacked">
          <span className="config-label"><HighlightText text={t('config:connection.backendUrl')} query={searchQuery} /></span>
          <div className="config-input-group">
            <input type="text" className="config-input config-input-full" value={backendUrl} onChange={(e) => handleBackendUrlChange(e.target.value)} placeholder="http://localhost:5174" onKeyDown={(e) => { if (e.key === 'Enter' && backendUrlDirty) { handleBackendUrlSave(); } }} />
            {backendUrlDirty && (
              <button className="config-btn config-btn-sm" onClick={handleBackendUrlSave} title={t('config:connection.saveAndReconnect')}>{t('common:buttons.apply')}</button>
            )}
          </div>
          <span className="config-hint">{t('config:connection.autoDetectHint')}</span>
        </div>
        <div className="config-row config-row-stacked">
          <span className="config-label"><HighlightText text={t('config:connection.authToken')} query={searchQuery} /></span>
          <div className="config-input-group">
            <input type={showToken ? 'text' : 'password'} className="config-input config-input-full" value={authToken} onChange={(e) => handleAuthTokenChange(e.target.value)} placeholder={t('config:connection.tokenPlaceholder')} onKeyDown={(e) => { if (e.key === 'Enter' && authTokenDirty) { handleAuthTokenSave(); } }} />
            <button className="config-btn config-btn-sm" onClick={() => setShowToken(!showToken)} title={showToken ? t('config:connection.hideToken') : t('config:connection.showToken')}>{showToken ? '🙈' : '👁️'}</button>
            {authTokenDirty && (
              <button className="config-btn config-btn-sm" onClick={handleAuthTokenSave} title={t('config:connection.saveAndReconnect')}>{t('common:buttons.apply')}</button>
            )}
          </div>
          <span className="config-hint">{t('config:connection.tokenRequired')}</span>
        </div>
        <div className="config-row">
          <span className="config-label"><HighlightText text={t('common:buttons.reconnect')} query={searchQuery} /></span>
          <button className="config-btn" onClick={() => reconnect()} title="Force reconnect to server">{t('common:buttons.reconnect')}</button>
        </div>
      </CollapsibleSection>
      )}

      {shouldShowSection('scene') && (
      <CollapsibleSection title={t('config:sections.scene')} storageKey="scene" defaultOpen={false} forceOpen={isSearching && shouldShowSection('scene')}>
        <div className="config-row">
          <span className="config-label"><HighlightText text={t('config:scene.characterSize')} query={searchQuery} /></span>
          <input type="range" className="config-slider" min="0.3" max="3.0" step="0.1" value={config.characterScale} onChange={(e) => onChange({ ...config, characterScale: parseFloat(e.target.value) })} />
          <span className="config-value">{config.characterScale.toFixed(1)}x</span>
        </div>
        <div className="config-row">
          <span className="config-label"><HighlightText text={t('config:scene.indicatorScale')} query={searchQuery} /></span>
          <input type="range" className="config-slider" min="0.3" max="2.0" step="0.1" value={config.indicatorScale} onChange={(e) => onChange({ ...config, indicatorScale: parseFloat(e.target.value) })} />
          <span className="config-value">{config.indicatorScale.toFixed(1)}x</span>
        </div>
        <div className="config-group">
          <span className="config-label"><HighlightText text={t('config:scene.time')} query={searchQuery} /></span>
          <ChipSelector options={tTimeOpts} value={config.timeMode} onChange={(mode) => onChange({ ...config, timeMode: mode })} iconOnly />
        </div>
      </CollapsibleSection>
      )}

      {shouldShowSection('terrain') && (
      <CollapsibleSection title={t('config:sections.terrain')} storageKey="terrain" defaultOpen={false} forceOpen={isSearching && shouldShowSection('terrain')}>
        <div className="terrain-icons">
          {tTerrainOpts.map((opt) => (
            <button key={opt.key} className={`terrain-icon-btn ${config.terrain[opt.key] ? 'active' : ''}`} onClick={() => toggleTerrain(opt.key)} title={opt.label}>{opt.icon}</button>
          ))}
        </div>
        <div className="config-row">
          <span className="config-label"><HighlightText text={t('config:terrainSettings.fog')} query={searchQuery} /></span>
          <input type="range" className="config-slider" min="0" max="2" step="0.1" value={config.terrain.fogDensity} onChange={(e) => updateTerrain({ fogDensity: parseFloat(e.target.value) })} />
          <span className="config-value">
            {config.terrain.fogDensity === 0 ? t('config:fogValues.off') : config.terrain.fogDensity <= 1 ? t('config:fogValues.low') : t('config:fogValues.high')}
          </span>
        </div>
        <div className="config-row">
          <span className="config-label"><HighlightText text={t('config:terrainSettings.brightness')} query={searchQuery} /></span>
          <input type="range" className="config-slider" min="0.2" max="2" step="0.1" value={config.terrain.brightness} onChange={(e) => updateTerrain({ brightness: parseFloat(e.target.value) })} />
          <span className="config-value">
            {config.terrain.brightness <= 0.5 ? t('config:brightnessValues.dark') : config.terrain.brightness <= 1.2 ? t('config:brightnessValues.normal') : t('config:brightnessValues.bright')}
          </span>
        </div>
        <div className="config-group">
          <span className="config-label"><HighlightText text={t('config:terrainSettings.floor')} query={searchQuery} /></span>
          <ChipSelector options={tFloorOpts} value={config.terrain.floorStyle} onChange={(style) => updateTerrain({ floorStyle: style })} iconOnly />
        </div>
        <div className="config-group">
          <span className="config-label"><HighlightText text={t('config:terrainSettings.sky')} query={searchQuery} /></span>
          <div className="sky-color-selector">
            {tSkyOpts.map((opt) => (
              <button key={opt.value ?? 'auto'} className={`sky-color-btn ${config.terrain.skyColor === opt.value ? 'active' : ''}`} onClick={() => updateTerrain({ skyColor: opt.value })} title={opt.label} style={{ background: opt.color }} />
            ))}
          </div>
        </div>
      </CollapsibleSection>
      )}

      {shouldShowSection('modelStyle') && (
      <CollapsibleSection title={t('config:sections.modelStyle')} storageKey="modelStyle" defaultOpen={false} forceOpen={isSearching && shouldShowSection('modelStyle')}>
        <div className="config-row">
          <span className="config-label"><HighlightText text={t('config:modelStyleSettings.saturation')} query={searchQuery} /></span>
          <input type="range" className="config-slider" min="0" max="2" step="0.1" value={config.modelStyle.saturation} onChange={(e) => updateModelStyle({ saturation: parseFloat(e.target.value) })} />
          <span className="config-value">{config.modelStyle.saturation <= 0.3 ? t('config:saturationValues.gray') : config.modelStyle.saturation <= 1.2 ? t('config:saturationValues.normal') : t('config:saturationValues.vivid')}</span>
        </div>
        <div className="config-row">
          <span className="config-label"><HighlightText text={t('config:modelStyleSettings.roughness')} query={searchQuery} /></span>
          <input type="range" className="config-slider" min="-1" max="1" step="0.1" value={config.modelStyle.roughness} onChange={(e) => updateModelStyle({ roughness: parseFloat(e.target.value) })} />
          <span className="config-value">{config.modelStyle.roughness < 0 ? t('config:roughnessValues.auto') : config.modelStyle.roughness <= 0.3 ? t('config:roughnessValues.glossy') : config.modelStyle.roughness <= 0.7 ? t('config:roughnessValues.normal') : t('config:roughnessValues.matte')}</span>
        </div>
        <div className="config-row">
          <span className="config-label"><HighlightText text={t('config:modelStyleSettings.metalness')} query={searchQuery} /></span>
          <input type="range" className="config-slider" min="-1" max="1" step="0.1" value={config.modelStyle.metalness} onChange={(e) => updateModelStyle({ metalness: parseFloat(e.target.value) })} />
          <span className="config-value">{config.modelStyle.metalness < 0 ? t('config:metalnessValues.auto') : config.modelStyle.metalness <= 0.3 ? t('config:metalnessValues.plastic') : config.modelStyle.metalness <= 0.7 ? t('config:metalnessValues.mixed') : t('config:metalnessValues.metal')}</span>
        </div>
        <div className="config-row">
          <span className="config-label"><HighlightText text={t('config:modelStyleSettings.glow')} query={searchQuery} /></span>
          <input type="range" className="config-slider" min="0" max="1" step="0.05" value={config.modelStyle.emissiveBoost} onChange={(e) => updateModelStyle({ emissiveBoost: parseFloat(e.target.value) })} />
          <span className="config-value">{config.modelStyle.emissiveBoost <= 0.1 ? t('config:glowValues.off') : config.modelStyle.emissiveBoost <= 0.4 ? t('config:glowValues.low') : config.modelStyle.emissiveBoost <= 0.7 ? t('config:glowValues.med') : t('config:glowValues.high')}</span>
        </div>
        <div className="config-row">
          <span className="config-label"><HighlightText text={t('config:modelStyleSettings.reflections')} query={searchQuery} /></span>
          <input type="range" className="config-slider" min="-1" max="2" step="0.1" value={config.modelStyle.envMapIntensity} onChange={(e) => updateModelStyle({ envMapIntensity: parseFloat(e.target.value) })} />
          <span className="config-value">{config.modelStyle.envMapIntensity < 0 ? t('config:reflectionValues.auto') : config.modelStyle.envMapIntensity <= 0.3 ? t('config:reflectionValues.low') : config.modelStyle.envMapIntensity <= 1 ? t('config:reflectionValues.normal') : t('config:reflectionValues.high')}</span>
        </div>
        <div className="config-row">
          <span className="config-label"><HighlightText text={t('config:modelStyleSettings.wireframe')} query={searchQuery} /></span>
          <Toggle checked={config.modelStyle.wireframe} onChange={(checked) => updateModelStyle({ wireframe: checked })} />
        </div>
        <div className="config-group">
          <span className="config-label"><HighlightText text={t('config:modelStyleSettings.colorMode')} query={searchQuery} /></span>
          <ChipSelector options={tColorModeOpts} value={config.modelStyle.colorMode} onChange={(mode) => updateModelStyle({ colorMode: mode })} iconOnly />
        </div>
      </CollapsibleSection>
      )}

      {shouldShowSection('animations') && (
      <CollapsibleSection title={t('config:sections.animations')} storageKey="animations" defaultOpen={false} forceOpen={isSearching && shouldShowSection('animations')}>
        <div className="config-group">
          <span className="config-label"><HighlightText text={t('config:animationSettings.idle')} query={searchQuery} /></span>
          <ChipSelector options={tAnimOpts} value={config.animations.idleAnimation} onChange={(anim) => updateAnimations({ idleAnimation: anim })} iconOnly />
        </div>
        <div className="config-group">
          <span className="config-label"><HighlightText text={t('config:animationSettings.working')} query={searchQuery} /></span>
          <ChipSelector options={tAnimOpts} value={config.animations.workingAnimation} onChange={(anim) => updateAnimations({ workingAnimation: anim })} iconOnly />
        </div>
      </CollapsibleSection>
      )}

      {shouldShowSection('secrets') && (
      <CollapsibleSection title={t('config:sections.secrets')} storageKey="secrets" defaultOpen={false} forceOpen={isSearching && shouldShowSection('secrets')}>
        <SecretsSection />
      </CollapsibleSection>
      )}

      {shouldShowSection('systemPrompt') && (
      <CollapsibleSection title={t('config:sections.systemPrompt')} storageKey="systemPrompt" defaultOpen={false} forceOpen={isSearching && shouldShowSection('systemPrompt')}>
        <div className="config-row">
          <span className="config-label"><HighlightText text={t('config:systemPrompt.title')} query={searchQuery} /></span>
          <button
            className="config-button"
            onClick={() => setIsSystemPromptModalOpen(true)}
          >
            {t('config:systemPrompt.editPrompt')}
          </button>
        </div>
      </CollapsibleSection>
      )}

      {shouldShowSection('data') && (
      <CollapsibleSection title={t('config:sections.data')} storageKey="data" defaultOpen={false} forceOpen={isSearching && shouldShowSection('data')}>
        <DataSection />
      </CollapsibleSection>
      )}

      {shouldShowSection('experimental') && (
      <CollapsibleSection title={t('config:sections.experimental')} storageKey="experimental" defaultOpen={false} forceOpen={isSearching && shouldShowSection('experimental')}>
        <div className="config-row">
          <span className="config-label" title="Lightweight 2D top-down view for better performance"><HighlightText text={t('config:experimental.2dView')} query={searchQuery} /> 🗺️</span>
          <Toggle checked={state.settings.experimental2DView} onChange={(checked) => store.updateSettings({ experimental2DView: checked })} />
        </div>
        <div className="config-row">
          <span className="config-label" title="Voice assistant for hands-free agent control"><HighlightText text={t('config:experimental.voiceAssistant')} query={searchQuery} /> 🎤</span>
          <Toggle checked={state.settings.experimentalVoiceAssistant} onChange={(checked) => store.updateSettings({ experimentalVoiceAssistant: checked })} />
        </div>
        <div className="config-row">
          <span className="config-label" title="Text-to-speech for reading agent responses"><HighlightText text={t('config:experimental.tts')} query={searchQuery} /> 🔊</span>
          <Toggle checked={state.settings.experimentalTTS} onChange={(checked) => store.updateSettings({ experimentalTTS: checked })} />
        </div>
        <div className="config-row">
          <span className="config-label" title="Duplicate system prompt for improved LLM attention coverage. Increases input token usage."><HighlightText text={t('config:experimental.echoPrompt')} query={searchQuery} /></span>
          <Toggle checked={state.settings.experimentalEchoPrompt} onChange={async (checked) => {
            store.updateSettings({ experimentalEchoPrompt: checked });
            try {
              await updateEchoPromptSetting(checked);
            } catch (err) {
              console.error('Failed to sync echo prompt setting to server:', err);
            }
          }} />
        </div>
        <span className="config-hint">{t('config:experimental.hint')}</span>
      </CollapsibleSection>
      )}

      {shouldShowSection('about') && (
      <CollapsibleSection title={t('config:sections.about')} storageKey="about" defaultOpen={false} forceOpen={isSearching && shouldShowSection('about')}>
        <AboutSection />
      </CollapsibleSection>
      )}
    </div>

    <SystemPromptModal
      isOpen={isSystemPromptModalOpen}
      onClose={() => setIsSystemPromptModalOpen(false)}
    />
    </>
  );
}

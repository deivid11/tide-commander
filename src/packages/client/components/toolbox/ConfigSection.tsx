import React, { useState } from 'react';
import { useStore, store } from '../../store';
import { STORAGE_KEYS, getStorageString, setStorageString, getAuthToken } from '../../utils/storage';
import { reconnect } from '../../websocket';
import { CollapsibleSection } from './CollapsibleSection';
import { SecretsSection } from './SecretsSection';
import { DataSection } from './DataSection';
import { AboutSection, ThemeSelector } from './AboutSection';
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

export function ConfigSection({ config, onChange }: ConfigSectionProps) {
  const state = useStore();
  const [historyLimit, setHistoryLimit] = useState(state.settings.historyLimit);
  const [backendUrl, setBackendUrl] = useState(() => getStorageString(STORAGE_KEYS.BACKEND_URL, ''));
  const [backendUrlDirty, setBackendUrlDirty] = useState(false);
  const [authToken, setAuthToken] = useState(() => getAuthToken());
  const [authTokenDirty, setAuthTokenDirty] = useState(false);
  const [showToken, setShowToken] = useState(false);

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

  return (
    <div className="config-section">
      {/* General Settings */}
      <CollapsibleSection title="General" storageKey="general" defaultOpen={true}>
        <div className="config-row">
          <span className="config-label">History</span>
          <input
            type="number"
            className="config-input config-input-sm"
            value={historyLimit}
            onChange={(e) => handleHistoryLimitChange(parseInt(e.target.value) || 100)}
            min={50}
            max={2000}
            step={50}
          />
        </div>
        <div className="config-row">
          <span className="config-label">Hide Costs</span>
          <Toggle
            checked={state.settings.hideCost}
            onChange={(checked) => store.updateSettings({ hideCost: checked })}
          />
        </div>
        <div className="config-row">
          <span className="config-label">Grid</span>
          <Toggle
            checked={config.gridVisible}
            onChange={(checked) => onChange({ ...config, gridVisible: checked })}
          />
        </div>
        <div className="config-row">
          <span className="config-label">Show FPS</span>
          <Toggle
            checked={state.settings.showFPS}
            onChange={(checked) => store.updateSettings({ showFPS: checked })}
          />
        </div>
        <div className="config-row">
          <span className="config-label">FPS Limit</span>
          <input
            type="range"
            className="config-slider"
            min="0"
            max="120"
            step="10"
            value={config.fpsLimit}
            onChange={(e) => onChange({ ...config, fpsLimit: parseInt(e.target.value) })}
          />
          <span className="config-value">{config.fpsLimit === 0 ? '∞' : config.fpsLimit}</span>
        </div>
        <div className="config-row">
          <span className="config-label" title="Experimental: Reduce FPS when idle to save power">Power Saving ⚡</span>
          <Toggle
            checked={state.settings.powerSaving}
            onChange={(checked) => store.updateSettings({ powerSaving: checked })}
          />
        </div>
      </CollapsibleSection>

      {/* Appearance Settings */}
      <CollapsibleSection title="Appearance" storageKey="appearance" defaultOpen={false}>
        <ThemeSelector />
      </CollapsibleSection>

      {/* Connection Settings */}
      <CollapsibleSection title="Connection" storageKey="connection" defaultOpen={false}>
        <div className="config-row config-row-stacked">
          <span className="config-label">Backend URL</span>
          <div className="config-input-group">
            <input
              type="text"
              className="config-input config-input-full"
              value={backendUrl}
              onChange={(e) => handleBackendUrlChange(e.target.value)}
              placeholder="http://127.0.0.1:5174"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && backendUrlDirty) {
                  handleBackendUrlSave();
                }
              }}
            />
            {backendUrlDirty && (
              <button
                className="config-btn config-btn-sm"
                onClick={handleBackendUrlSave}
                title="Save and reconnect"
              >
                Apply
              </button>
            )}
          </div>
          <span className="config-hint">Leave empty for auto-detect</span>
        </div>
        <div className="config-row config-row-stacked">
          <span className="config-label">Auth Token</span>
          <div className="config-input-group">
            <input
              type={showToken ? 'text' : 'password'}
              className="config-input config-input-full"
              value={authToken}
              onChange={(e) => handleAuthTokenChange(e.target.value)}
              placeholder="Enter token if required"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && authTokenDirty) {
                  handleAuthTokenSave();
                }
              }}
            />
            <button
              className="config-btn config-btn-sm"
              onClick={() => setShowToken(!showToken)}
              title={showToken ? 'Hide token' : 'Show token'}
            >
              {showToken ? '🙈' : '👁️'}
            </button>
            {authTokenDirty && (
              <button
                className="config-btn config-btn-sm"
                onClick={handleAuthTokenSave}
                title="Save and reconnect"
              >
                Apply
              </button>
            )}
          </div>
          <span className="config-hint">Required if server has AUTH_TOKEN set</span>
        </div>
        <div className="config-row">
          <span className="config-label">Manual</span>
          <button
            className="config-btn"
            onClick={() => reconnect()}
            title="Force reconnect to server"
          >
            Reconnect
          </button>
        </div>
      </CollapsibleSection>

      {/* Scene Settings */}
      <CollapsibleSection title="Scene" storageKey="scene" defaultOpen={false}>
        <div className="config-row">
          <span className="config-label">Char Size</span>
          <input
            type="range"
            className="config-slider"
            min="0.3"
            max="3.0"
            step="0.1"
            value={config.characterScale}
            onChange={(e) => onChange({ ...config, characterScale: parseFloat(e.target.value) })}
          />
          <span className="config-value">{config.characterScale.toFixed(1)}x</span>
        </div>
        <div className="config-row">
          <span className="config-label">Indicator</span>
          <input
            type="range"
            className="config-slider"
            min="0.3"
            max="2.0"
            step="0.1"
            value={config.indicatorScale}
            onChange={(e) => onChange({ ...config, indicatorScale: parseFloat(e.target.value) })}
          />
          <span className="config-value">{config.indicatorScale.toFixed(1)}x</span>
        </div>
        <div className="config-group">
          <span className="config-label">Time</span>
          <ChipSelector
            options={TIME_MODE_OPTIONS}
            value={config.timeMode}
            onChange={(mode) => onChange({ ...config, timeMode: mode })}
            iconOnly
          />
        </div>
      </CollapsibleSection>

      {/* Terrain Settings */}
      <CollapsibleSection title="Terrain" storageKey="terrain" defaultOpen={false}>
        <div className="terrain-icons">
          {TERRAIN_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              className={`terrain-icon-btn ${config.terrain[opt.key] ? 'active' : ''}`}
              onClick={() => toggleTerrain(opt.key)}
              title={opt.label}
            >
              {opt.icon}
            </button>
          ))}
        </div>
        <div className="config-row">
          <span className="config-label">Fog</span>
          <input
            type="range"
            className="config-slider"
            min="0"
            max="2"
            step="0.1"
            value={config.terrain.fogDensity}
            onChange={(e) => updateTerrain({ fogDensity: parseFloat(e.target.value) })}
          />
          <span className="config-value">
            {config.terrain.fogDensity === 0 ? 'Off' : config.terrain.fogDensity <= 1 ? 'Low' : 'Hi'}
          </span>
        </div>
        <div className="config-row">
          <span className="config-label">Brightness</span>
          <input
            type="range"
            className="config-slider"
            min="0.2"
            max="2"
            step="0.1"
            value={config.terrain.brightness}
            onChange={(e) => updateTerrain({ brightness: parseFloat(e.target.value) })}
          />
          <span className="config-value">
            {config.terrain.brightness <= 0.5 ? 'Dark' : config.terrain.brightness <= 1.2 ? 'Normal' : 'Bright'}
          </span>
        </div>
        <div className="config-group">
          <span className="config-label">Floor</span>
          <ChipSelector
            options={FLOOR_STYLE_OPTIONS}
            value={config.terrain.floorStyle}
            onChange={(style) => updateTerrain({ floorStyle: style })}
            iconOnly
          />
        </div>
        <div className="config-group">
          <span className="config-label">Sky</span>
          <div className="sky-color-selector">
            {SKY_COLOR_OPTIONS.map((opt) => (
              <button
                key={opt.value ?? 'auto'}
                className={`sky-color-btn ${config.terrain.skyColor === opt.value ? 'active' : ''}`}
                onClick={() => updateTerrain({ skyColor: opt.value })}
                title={opt.label}
                style={{ background: opt.color }}
              />
            ))}
          </div>
        </div>
      </CollapsibleSection>

      {/* Agent Model Style Settings */}
      <CollapsibleSection title="Agent Model Style" storageKey="modelStyle" defaultOpen={false}>
        <div className="config-row">
          <span className="config-label">Saturation</span>
          <input
            type="range"
            className="config-slider"
            min="0"
            max="2"
            step="0.1"
            value={config.modelStyle.saturation}
            onChange={(e) => updateModelStyle({ saturation: parseFloat(e.target.value) })}
          />
          <span className="config-value">
            {config.modelStyle.saturation <= 0.3 ? 'Gray' : config.modelStyle.saturation <= 1.2 ? 'Normal' : 'Vivid'}
          </span>
        </div>
        <div className="config-row">
          <span className="config-label">Roughness</span>
          <input
            type="range"
            className="config-slider"
            min="-1"
            max="1"
            step="0.1"
            value={config.modelStyle.roughness}
            onChange={(e) => updateModelStyle({ roughness: parseFloat(e.target.value) })}
          />
          <span className="config-value">
            {config.modelStyle.roughness < 0 ? 'Auto' : config.modelStyle.roughness <= 0.3 ? 'Glossy' : config.modelStyle.roughness <= 0.7 ? 'Normal' : 'Matte'}
          </span>
        </div>
        <div className="config-row">
          <span className="config-label">Metalness</span>
          <input
            type="range"
            className="config-slider"
            min="-1"
            max="1"
            step="0.1"
            value={config.modelStyle.metalness}
            onChange={(e) => updateModelStyle({ metalness: parseFloat(e.target.value) })}
          />
          <span className="config-value">
            {config.modelStyle.metalness < 0 ? 'Auto' : config.modelStyle.metalness <= 0.3 ? 'Plastic' : config.modelStyle.metalness <= 0.7 ? 'Mixed' : 'Metal'}
          </span>
        </div>
        <div className="config-row">
          <span className="config-label">Glow</span>
          <input
            type="range"
            className="config-slider"
            min="0"
            max="1"
            step="0.05"
            value={config.modelStyle.emissiveBoost}
            onChange={(e) => updateModelStyle({ emissiveBoost: parseFloat(e.target.value) })}
          />
          <span className="config-value">
            {config.modelStyle.emissiveBoost <= 0.1 ? 'Off' : config.modelStyle.emissiveBoost <= 0.4 ? 'Low' : config.modelStyle.emissiveBoost <= 0.7 ? 'Med' : 'High'}
          </span>
        </div>
        <div className="config-row">
          <span className="config-label">Reflections</span>
          <input
            type="range"
            className="config-slider"
            min="-1"
            max="2"
            step="0.1"
            value={config.modelStyle.envMapIntensity}
            onChange={(e) => updateModelStyle({ envMapIntensity: parseFloat(e.target.value) })}
          />
          <span className="config-value">
            {config.modelStyle.envMapIntensity < 0 ? 'Auto' : config.modelStyle.envMapIntensity <= 0.3 ? 'Low' : config.modelStyle.envMapIntensity <= 1 ? 'Normal' : 'High'}
          </span>
        </div>
        <div className="config-row">
          <span className="config-label">Wireframe</span>
          <Toggle
            checked={config.modelStyle.wireframe}
            onChange={(checked) => updateModelStyle({ wireframe: checked })}
          />
        </div>
        <div className="config-group">
          <span className="config-label">Color Mode</span>
          <ChipSelector
            options={COLOR_MODE_OPTIONS}
            value={config.modelStyle.colorMode}
            onChange={(mode) => updateModelStyle({ colorMode: mode })}
            iconOnly
          />
        </div>
      </CollapsibleSection>

      {/* Animations Settings */}
      <CollapsibleSection title="Animations" storageKey="animations" defaultOpen={false}>
        <div className="config-group">
          <span className="config-label">Idle</span>
          <ChipSelector
            options={ANIMATION_OPTIONS}
            value={config.animations.idleAnimation}
            onChange={(anim) => updateAnimations({ idleAnimation: anim })}
            iconOnly
          />
        </div>
        <div className="config-group">
          <span className="config-label">Working</span>
          <ChipSelector
            options={ANIMATION_OPTIONS}
            value={config.animations.workingAnimation}
            onChange={(anim) => updateAnimations({ workingAnimation: anim })}
            iconOnly
          />
        </div>
      </CollapsibleSection>

      {/* Secrets Section */}
      <CollapsibleSection title="Secrets" storageKey="secrets" defaultOpen={false}>
        <SecretsSection />
      </CollapsibleSection>

      {/* Data Export/Import Section */}
      <CollapsibleSection title="Data" storageKey="data" defaultOpen={false}>
        <DataSection />
      </CollapsibleSection>

      {/* Experimental Features Section */}
      <CollapsibleSection title="Experimental" storageKey="experimental" defaultOpen={false}>
        <div className="config-row">
          <span className="config-label" title="Voice assistant for hands-free agent control">Voice Assistant 🎤</span>
          <Toggle
            checked={state.settings.experimentalVoiceAssistant}
            onChange={(checked) => store.updateSettings({ experimentalVoiceAssistant: checked })}
          />
        </div>
        <div className="config-row">
          <span className="config-label" title="Text-to-speech for reading agent responses">Text to Speech 🔊</span>
          <Toggle
            checked={state.settings.experimentalTTS}
            onChange={(checked) => store.updateSettings({ experimentalTTS: checked })}
          />
        </div>
        <span className="config-hint">These features are experimental and may change</span>
      </CollapsibleSection>

      {/* About Section */}
      <CollapsibleSection title="About" storageKey="about" defaultOpen={false}>
        <AboutSection />
      </CollapsibleSection>
    </div>
  );
}

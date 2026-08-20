/**
 * PiModelSelect
 * Searchable combobox for picking a pi model. The list is fetched from the
 * local `pi` CLI via /api/agents/pi/models (providers with credentials only).
 * Users can also type a custom value/pattern that is not in the list.
 *
 * The eight most recently selected models are persisted per browser and shown
 * as shortcuts. Keeping this here makes the shortcuts consistent in both the
 * new-agent and edit-agent forms.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { OpencodeModelSelect } from './OpencodeModelSelect';
import { fetchPiModels } from '../api/pi';
import { getStorage, setStorage, STORAGE_KEYS } from '../utils/storage';

interface PiModelSelectProps {
  value: string;
  onChange: (value: string) => void;
  inputId?: string;
}

const MAX_RECENT_PI_MODELS = 8;

function normalizeRecentModels(models: unknown): string[] {
  if (!Array.isArray(models)) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const model of models) {
    if (typeof model !== 'string') continue;
    const trimmed = model.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
    if (normalized.length === MAX_RECENT_PI_MODELS) break;
  }
  return normalized;
}

export function PiModelSelect({ value, onChange, inputId }: PiModelSelectProps) {
  const [recentModels, setRecentModels] = useState<string[]>(() =>
    normalizeRecentModels(getStorage<unknown>(STORAGE_KEYS.RECENT_PI_MODELS, [])),
  );
  const recentModelsRef = useRef(recentModels);

  const rememberModel = useCallback((model: string) => {
    const normalized = model.trim();
    if (!normalized) return;

    const previous = recentModelsRef.current;
    const next = [normalized, ...previous.filter((item) => item !== normalized)]
      .slice(0, MAX_RECENT_PI_MODELS);
    if (next.length === previous.length && next.every((item, index) => item === previous[index])) {
      return;
    }

    recentModelsRef.current = next;
    setRecentModels(next);
    setStorage(STORAGE_KEYS.RECENT_PI_MODELS, next);
  }, []);

  // Seed recents from existing Pi agents too, not only choices made after this
  // feature was introduced. Controlled value changes are committed selections.
  useEffect(() => {
    rememberModel(value);
  }, [rememberModel, value]);

  const selectModel = useCallback((model: string) => {
    rememberModel(model);
    onChange(model);
  }, [onChange, rememberModel]);

  return (
    <div className="pi-model-select">
      <OpencodeModelSelect
        value={value}
        onChange={selectModel}
        inputId={inputId}
        placeholder="pi default — or provider/model (e.g., anthropic/claude-sonnet-4-5)"
        fetchModels={fetchPiModels}
        cliLabel="pi"
      />
      {recentModels.length > 0 && (
        <div className="pi-model-select__recents" aria-label="Recently selected Pi models">
          <span className="pi-model-select__recents-label">Recent</span>
          {recentModels.map((model) => {
            const slashIndex = model.indexOf('/');
            const provider = slashIndex >= 0 ? model.slice(0, slashIndex + 1) : '';
            const modelName = slashIndex >= 0 ? model.slice(slashIndex + 1) : model;
            return (
              <button
                key={model}
                type="button"
                className={`pi-model-select__recent${model === value ? ' is-selected' : ''}`}
                onClick={() => selectModel(model)}
                title={model}
              >
                {provider && <span className="pi-model-select__recent-provider">{provider}</span>}
                <span className="pi-model-select__recent-name">{modelName}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * PiModelSelect
 * Searchable combobox for picking a pi model. The list is fetched from the
 * local `pi` CLI via /api/agents/pi/models (providers with credentials only).
 * Users can also type a custom value/pattern that is not in the list.
 */

import React from 'react';
import { OpencodeModelSelect } from './OpencodeModelSelect';
import { fetchPiModels } from '../api/pi';

interface PiModelSelectProps {
  value: string;
  onChange: (value: string) => void;
  inputId?: string;
}

export function PiModelSelect({ value, onChange, inputId }: PiModelSelectProps) {
  return (
    <OpencodeModelSelect
      value={value}
      onChange={onChange}
      inputId={inputId}
      placeholder="pi default — or provider/model (e.g., anthropic/claude-sonnet-4-5)"
      fetchModels={fetchPiModels}
      cliLabel="pi"
    />
  );
}

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { MessageDirection } from '../../../shared/event-types';
import type { WhatsAppMessageType } from '../../../shared/event-types';

export type DirectionFilter = 'all' | MessageDirection;
export type TypeFilter = 'all' | WhatsAppMessageType;

interface ChatFiltersProps {
  direction: DirectionFilter;
  type: TypeFilter;
  onDirectionChange: (next: DirectionFilter) => void;
  onTypeChange: (next: TypeFilter) => void;
  disabled?: boolean;
}

const DIRECTION_OPTIONS: DirectionFilter[] = ['all', 'inbound', 'outbound'];
const TYPE_OPTIONS: TypeFilter[] = [
  'all', 'text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contact', 'reaction', 'unknown',
];

export function ChatFilters({ direction, type, onDirectionChange, onTypeChange, disabled }: ChatFiltersProps) {
  const { t } = useTranslation(['config']);

  return (
    <div className="whatsapp-history-filters">
      <label className="whatsapp-history-filters__field">
        <span>{t('config:whatsappHistory.direction')}</span>
        <select
          value={direction}
          onChange={(e) => onDirectionChange(e.target.value as DirectionFilter)}
          disabled={disabled}
        >
          {DIRECTION_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {t(`config:whatsappHistory.directionValues.${opt}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="whatsapp-history-filters__field">
        <span>{t('config:whatsappHistory.type')}</span>
        <select
          value={type}
          onChange={(e) => onTypeChange(e.target.value as TypeFilter)}
          disabled={disabled}
        >
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {t(`config:whatsappHistory.typeValues.${opt}`)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

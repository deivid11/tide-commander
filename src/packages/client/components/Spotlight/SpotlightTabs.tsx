/**
 * SpotlightTabs - Result-grouping tabs shown at the top of the Spotlight modal.
 * Tabs filter results by category (All / Buildings / Areas / Commands) and can
 * be cycled with the Tab key (handled by the Spotlight container).
 */

import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { SPOTLIGHT_TABS, type SpotlightTab } from './types';

interface SpotlightTabsProps {
  activeTab: SpotlightTab;
  onSelect: (tab: SpotlightTab) => void;
}

export const SpotlightTabs = memo(function SpotlightTabs({ activeTab, onSelect }: SpotlightTabsProps) {
  const { t } = useTranslation(['terminal']);

  return (
    <div className="spotlight-tabs" role="tablist" aria-label={t('terminal:spotlight.tabsLabel')}>
      {SPOTLIGHT_TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={tab === activeTab}
          // Keep keyboard focus in the search input — Tab cycling is handled globally.
          tabIndex={-1}
          className={`spotlight-tab${tab === activeTab ? ' active' : ''}`}
          onClick={() => onSelect(tab)}
        >
          {t(`terminal:spotlight.tabs.${tab}`)}
        </button>
      ))}
      <span className="spotlight-tabs-hint">
        <kbd>Tab</kbd>
      </span>
    </div>
  );
});

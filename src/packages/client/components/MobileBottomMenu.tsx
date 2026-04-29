import React, { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTrackingBoardVisible } from '../store';
import { Icon } from './Icon';

interface MobileBottomMenuProps {
  onOpenSpotlight: () => void;
  onOpenCommander: () => void;
  onOpenToolbox: () => void;
  onSpawnAgent: () => void;
  sidebarOpen: boolean;
  onToggleAgentsDrawer?: () => void;
  onToggleInspector?: () => void;
  onCloseAgent?: () => void;
  activeView?: 'agents' | 'settings' | 'commander' | 'search' | 'inspector' | null;
}

export const MobileBottomMenu = memo(function MobileBottomMenu({
  onOpenSpotlight,
  onOpenCommander,
  onOpenToolbox,
  onSpawnAgent,
  sidebarOpen,
  onToggleAgentsDrawer,
  onToggleInspector,
  onCloseAgent,
  activeView,
}: MobileBottomMenuProps) {
  const { t } = useTranslation(['common']);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const trackingBoardVisible = useTrackingBoardVisible();
  // Capture initial viewport height before any keyboard opens
  const initialHeightRef = useRef<number>(
    window.visualViewport ? window.visualViewport.height : window.innerHeight
  );

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    // Update initial height once the component has settled
    initialHeightRef.current = vv.height;

    const handleResize = () => {
      // On Android, both innerHeight and vv.height shrink when keyboard opens.
      // Compare against the initial height captured at mount time.
      setKeyboardOpen(vv.height < initialHeightRef.current - 150);
    };

    vv.addEventListener('resize', handleResize);
    return () => vv.removeEventListener('resize', handleResize);
  }, []);

  if (keyboardOpen) return null;
  if (sidebarOpen) return null;
  if (trackingBoardVisible) return null;

  return (
    <nav className="mobile-bottom-menu" aria-label={t('common:mobileBottomMenu.label', { defaultValue: 'Quick actions' })}>
      {onToggleAgentsDrawer && (
        <button
          type="button"
          className={`mobile-bottom-menu__btn ${activeView === 'agents' ? 'mobile-bottom-menu__btn--active' : ''}`}
          onClick={onToggleAgentsDrawer}
          title={t('common:mobileBottomMenu.agents', { defaultValue: 'Agents' })}
          aria-label={t('common:mobileBottomMenu.agents', { defaultValue: 'Agents' })}
          aria-pressed={activeView === 'agents'}
        >
          <span className="mobile-bottom-menu__icon"><Icon name="list" size={18} /></span>
          <span className="mobile-bottom-menu__label">{t('common:mobileBottomMenu.agents', { defaultValue: 'Agents' })}</span>
        </button>
      )}

      <button
        type="button"
        className={`mobile-bottom-menu__btn ${activeView === 'settings' ? 'mobile-bottom-menu__btn--active' : ''}`}
        onClick={onOpenToolbox}
        title={t('common:floatingButtons.settingsAndTools')}
        aria-label={t('common:floatingButtons.settingsAndTools')}
        aria-pressed={activeView === 'settings'}
      >
        <span className="mobile-bottom-menu__icon"><Icon name="gear" size={18} /></span>
        <span className="mobile-bottom-menu__label">{t('common:mobileBottomMenu.settings', { defaultValue: 'Settings' })}</span>
      </button>

      <button
        type="button"
        className={`mobile-bottom-menu__btn ${activeView === 'commander' ? 'mobile-bottom-menu__btn--active' : ''}`}
        onClick={onOpenCommander}
        title={t('common:floatingButtons.commanderView')}
        aria-label={t('common:floatingButtons.commanderView')}
        aria-pressed={activeView === 'commander'}
      >
        <span className="mobile-bottom-menu__icon"><Icon name="dashboard" size={18} /></span>
        <span className="mobile-bottom-menu__label">{t('common:mobileBottomMenu.commander', { defaultValue: 'Commander' })}</span>
      </button>

      <button
        type="button"
        className="mobile-bottom-menu__btn mobile-bottom-menu__btn--primary"
        onClick={onSpawnAgent}
        title={t('common:mobileBottomMenu.spawn', { defaultValue: 'Spawn Agent' })}
        aria-label={t('common:mobileBottomMenu.spawn', { defaultValue: 'Spawn Agent' })}
      >
        <span className="mobile-bottom-menu__icon"><Icon name="plus" size={18} /></span>
        <span className="mobile-bottom-menu__label">{t('common:mobileBottomMenu.spawn', { defaultValue: 'Spawn' })}</span>
      </button>

      <button
        type="button"
        className={`mobile-bottom-menu__btn ${activeView === 'search' ? 'mobile-bottom-menu__btn--active' : ''}`}
        onClick={onOpenSpotlight}
        title={t('common:floatingButtons.globalSearch')}
        aria-label={t('common:floatingButtons.globalSearch')}
        aria-pressed={activeView === 'search'}
      >
        <span className="mobile-bottom-menu__icon"><Icon name="search" size={18} /></span>
        <span className="mobile-bottom-menu__label">{t('common:mobileBottomMenu.search', { defaultValue: 'Search' })}</span>
      </button>

      {onToggleInspector && (
        <button
          type="button"
          className={`mobile-bottom-menu__btn ${activeView === 'inspector' ? 'mobile-bottom-menu__btn--active' : ''}`}
          onClick={onToggleInspector}
          title={t('common:mobileBottomMenu.inspector', { defaultValue: 'Inspector' })}
          aria-label={t('common:mobileBottomMenu.inspector', { defaultValue: 'Inspector' })}
          aria-pressed={activeView === 'inspector'}
        >
          <span className="mobile-bottom-menu__icon"><Icon name="eye" size={18} /></span>
          <span className="mobile-bottom-menu__label">{t('common:mobileBottomMenu.inspector', { defaultValue: 'Inspector' })}</span>
        </button>
      )}

      {onCloseAgent && (
        <button
          type="button"
          className="mobile-bottom-menu__btn mobile-bottom-menu__btn--close"
          onClick={onCloseAgent}
          title={t('common:mobileBottomMenu.closeAgent', { defaultValue: 'Close agent' })}
          aria-label={t('common:mobileBottomMenu.closeAgent', { defaultValue: 'Close agent' })}
        >
          <span className="mobile-bottom-menu__icon"><Icon name="cross" size={18} /></span>
          <span className="mobile-bottom-menu__label">{t('common:mobileBottomMenu.close', { defaultValue: 'Close' })}</span>
        </button>
      )}
    </nav>
  );
});

import React, { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTrackingBoardVisible } from '../store';
import { Icon } from './Icon';

interface MobileBottomMenuProps {
  onOpenSpotlight: () => void;
  onOpenTrackingBoard: () => void;
  onOpenCommander: () => void;
  onOpenToolbox: () => void;
  onSpawnAgent: () => void;
  sidebarOpen: boolean;
}

export const MobileBottomMenu = memo(function MobileBottomMenu({
  onOpenSpotlight,
  onOpenTrackingBoard,
  onOpenCommander,
  onOpenToolbox,
  onSpawnAgent,
  sidebarOpen,
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
      <button
        type="button"
        className="mobile-bottom-menu__btn"
        onClick={onOpenToolbox}
        title={t('common:floatingButtons.settingsAndTools')}
        aria-label={t('common:floatingButtons.settingsAndTools')}
      >
        <span className="mobile-bottom-menu__icon"><Icon name="gear" size={18} /></span>
        <span className="mobile-bottom-menu__label">{t('common:mobileBottomMenu.settings', { defaultValue: 'Settings' })}</span>
      </button>

      <button
        type="button"
        className="mobile-bottom-menu__btn"
        onClick={onOpenCommander}
        title={t('common:floatingButtons.commanderView')}
        aria-label={t('common:floatingButtons.commanderView')}
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
        className="mobile-bottom-menu__btn"
        onClick={onOpenTrackingBoard}
        title={t('common:sidebar.trackingBoard')}
        aria-label={t('common:sidebar.trackingBoard')}
      >
        <span className="mobile-bottom-menu__icon"><Icon name="clipboard" size={18} /></span>
        <span className="mobile-bottom-menu__label">{t('common:mobileBottomMenu.tracking', { defaultValue: 'Tracking' })}</span>
      </button>

      <button
        type="button"
        className="mobile-bottom-menu__btn"
        onClick={onOpenSpotlight}
        title={t('common:floatingButtons.globalSearch')}
        aria-label={t('common:floatingButtons.globalSearch')}
      >
        <span className="mobile-bottom-menu__icon"><Icon name="search" size={18} /></span>
        <span className="mobile-bottom-menu__label">{t('common:mobileBottomMenu.search', { defaultValue: 'Search' })}</span>
      </button>
    </nav>
  );
});

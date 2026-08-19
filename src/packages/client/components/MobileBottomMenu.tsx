import React, { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useAgentCount, useSelectedAgentIds, useTrackingBoardVisible } from '../store';
import { getStorageString, STORAGE_KEYS } from '../utils/storage';
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
  /** Flat view with no chat open: reopen the agent the user was last in. */
  onOpenLastAgent?: () => void;
  lastAgentName?: string;
  /** Flat view has its own "+ Agent" CTA, so the nav drops its Spawn button. */
  isFlatView?: boolean;
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
  onOpenLastAgent,
  lastAgentName,
  isFlatView,
  activeView,
}: MobileBottomMenuProps) {
  const { t } = useTranslation(['common']);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const trackingBoardVisible = useTrackingBoardVisible();
  // Keep selection-driven mobile-nav updates local. AppContent used to
  // subscribe to selectedAgentIds solely for this menu, rebuilding the entire
  // Flat view on every agent click before FlatView handled the same update.
  const selectedAgentIds = useSelectedAgentIds();
  const agentCount = useAgentCount();
  const [storedLastAgent, setStoredLastAgent] = useState<{ id: string; name: string } | null>(null);
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

  useEffect(() => {
    if (!isFlatView || selectedAgentIds.size > 0) {
      setStoredLastAgent(null);
      return;
    }
    const id = getStorageString(STORAGE_KEYS.LAST_OPENED_AGENT, '');
    const agent = id ? store.getState().agents.get(id) : undefined;
    setStoredLastAgent(agent ? { id, name: agent.name } : null);
  }, [isFlatView, selectedAgentIds, agentCount]);

  if (keyboardOpen) return null;
  if (sidebarOpen) return null;
  if (trackingBoardVisible) return null;

  // When an agent chat is open, trim secondary items so the nav stays tappable
  // (Agents / Settings / Search / Inspector / Close). Spawn and Commander stay
  // available from the empty-state map, FAB, or header — Search must NOT be
  // trimmed: it has no other reachable surface while a chat is open on mobile.
  // Flat view drops Spawn entirely: its middle column carries + Agent / + Boss.
  const agentChatOpen = isFlatView ? selectedAgentIds.size > 0 : !!onCloseAgent;
  const effectiveLastAgentName = lastAgentName ?? storedLastAgent?.name;
  const canOpenLastAgent = !!onOpenLastAgent && (!!lastAgentName || storedLastAgent !== null);

  return (
    <nav
      className={`mobile-bottom-menu${agentChatOpen ? ' mobile-bottom-menu--chat-open' : ''}${
        canOpenLastAgent && !agentChatOpen ? ' mobile-bottom-menu--has-last-agent' : ''
      }`}
      aria-label={t('common:mobileBottomMenu.label', { defaultValue: 'Quick actions' })}
    >
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

      {!agentChatOpen && (
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
      )}

      {!agentChatOpen && !isFlatView && (
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
      )}

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

      {agentChatOpen && (
        <button
          type="button"
          className="mobile-bottom-menu__btn"
          onClick={() => window.dispatchEvent(new CustomEvent('tide:toggle-chat-actions'))}
          title={t('common:mobileBottomMenu.chatActions', { defaultValue: 'Chat actions' })}
          aria-label={t('common:mobileBottomMenu.chatActions', { defaultValue: 'Chat actions' })}
          aria-haspopup="menu"
        >
          <span className="mobile-bottom-menu__icon"><Icon name="more" size={18} /></span>
          <span className="mobile-bottom-menu__label">{t('common:mobileBottomMenu.actions', { defaultValue: 'Actions' })}</span>
        </button>
      )}

      {canOpenLastAgent && !agentChatOpen && (
        <button
          type="button"
          className="mobile-bottom-menu__btn mobile-bottom-menu__btn--last-agent"
          onClick={onOpenLastAgent}
          title={effectiveLastAgentName
            ? t('common:mobileBottomMenu.openLastAgentNamed', { name: effectiveLastAgentName, defaultValue: `Open ${effectiveLastAgentName}` })
            : t('common:mobileBottomMenu.lastAgent', { defaultValue: 'Last agent' })}
          aria-label={effectiveLastAgentName
            ? t('common:mobileBottomMenu.openLastAgentNamed', { name: effectiveLastAgentName, defaultValue: `Open ${effectiveLastAgentName}` })
            : t('common:mobileBottomMenu.lastAgent', { defaultValue: 'Last agent' })}
        >
          <span className="mobile-bottom-menu__icon"><Icon name="chat" size={18} /></span>
          <span className="mobile-bottom-menu__label">
            {effectiveLastAgentName || t('common:mobileBottomMenu.lastAgent', { defaultValue: 'Last agent' })}
          </span>
        </button>
      )}

      {agentChatOpen && onCloseAgent && (
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

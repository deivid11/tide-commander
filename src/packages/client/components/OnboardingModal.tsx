import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsConnected, useAgentCount } from '../store';
import { ModalPortal } from './shared/ModalPortal';

const SESSION_KEY = 'tide-onboarding-dismissed';

interface OnboardingModalProps {
  onCreateAgent: () => void;
}

export function OnboardingModal({ onCreateAgent }: OnboardingModalProps) {
  const { t } = useTranslation('common');
  const isConnected = useIsConnected();
  const agentCount = useAgentCount();
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(SESSION_KEY) === '1');

  const shouldShow = isConnected && !dismissed && agentCount === 0;

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    sessionStorage.setItem(SESSION_KEY, '1');
  }, []);

  const handleCreate = useCallback(() => {
    handleDismiss();
    onCreateAgent();
  }, [handleDismiss, onCreateAgent]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') handleDismiss();
  }, [handleDismiss]);

  if (!shouldShow) return null;

  return (
    <ModalPortal>
      <div className="modal-overlay visible" onClick={handleDismiss} onKeyDown={handleKeyDown}>
        <div className="modal onboarding-modal" onClick={(e) => e.stopPropagation()}>
          <div className="onboarding-header">
            <h2>{t('onboarding.title')}</h2>
            <p className="onboarding-subtitle">{t('onboarding.subtitle')}</p>
          </div>

          <div className="onboarding-steps">
            <div className="onboarding-step">
              <span className="onboarding-step-number">1</span>
              <div>
                <strong>{t('onboarding.step1Title')}</strong>
                <p>{t('onboarding.step1Desc')}</p>
              </div>
            </div>
            <div className="onboarding-step">
              <span className="onboarding-step-number">2</span>
              <div>
                <strong>{t('onboarding.step2Title')}</strong>
                <p>{t('onboarding.step2Desc')}</p>
              </div>
            </div>
            <div className="onboarding-step">
              <span className="onboarding-step-number">3</span>
              <div>
                <strong>{t('onboarding.step3Title')}</strong>
                <p>{t('onboarding.step3Desc')}</p>
              </div>
            </div>
          </div>

          <div className="onboarding-actions">
            <button className="btn onboarding-cta" onClick={handleCreate} autoFocus>
              {t('onboarding.createFirst')}
            </button>
            <button className="btn btn-secondary" onClick={handleDismiss}>
              {t('onboarding.explore')}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

import React, { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Detect iOS Safari (doesn't support beforeinstallprompt)
function isIOSSafari(): boolean {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS/.test(ua);
  return isIOS && isSafari;
}

// Detect if on mobile
function isMobile(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function PWAInstallBanner() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  useEffect(() => {
    // Check if already installed (standalone mode)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as any).standalone === true;

    if (isStandalone) {
      setIsInstalled(true);
      return;
    }

    // Check if previously dismissed
    if (sessionStorage.getItem('pwa_install_dismissed')) {
      return;
    }

    // For iOS Safari, show banner immediately with instructions
    if (isIOSSafari() && isMobile()) {
      setShowIOSInstructions(true);
      setIsVisible(true);
      return;
    }

    // For other browsers, wait for beforeinstallprompt
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
      setIsVisible(true);
    };

    // Listen for successful install
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsVisible(false);
      setInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    // On Android/Chrome mobile, if no prompt after 2s, show anyway with instructions
    if (isMobile()) {
      const timeout = setTimeout(() => {
        if (!installPrompt) {
          setIsVisible(true);
        }
      }, 2000);
      return () => {
        clearTimeout(timeout);
        window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
        window.removeEventListener('appinstalled', handleAppInstalled);
      };
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [installPrompt]);

  const handleInstall = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsVisible(false);
      }
      setInstallPrompt(null);
    }
  };

  const handleDismiss = () => {
    setIsVisible(false);
    sessionStorage.setItem('pwa_install_dismissed', 'true');
  };

  // Don't show if installed or not visible
  if (isInstalled || !isVisible) {
    return null;
  }

  return (
    <div className="pwa-install-banner">
      <div className="pwa-install-content">
        <img
          src="/assets/icons/icon-192.png"
          alt="Tide Commander"
          className="pwa-install-icon"
        />
        <div className="pwa-install-text">
          <strong>Install Tide Commander</strong>
          {showIOSInstructions ? (
            <span>Tap the share button, then "Add to Home Screen"</span>
          ) : installPrompt ? (
            <span>Add to home screen for the best experience</span>
          ) : (
            <span>Use browser menu → "Add to Home Screen"</span>
          )}
        </div>
      </div>
      <div className="pwa-install-actions">
        <button className="pwa-install-dismiss" onClick={handleDismiss}>
          {showIOSInstructions || !installPrompt ? 'Got it' : 'Not now'}
        </button>
        {installPrompt && (
          <button className="pwa-install-button" onClick={handleInstall}>
            Install
          </button>
        )}
      </div>
    </div>
  );
}

export interface ScenePerformanceProfile {
  isMobile: boolean;
  isConstrained: boolean;
  maxPixelRatio: number;
  antialias: boolean;
  enableShadows: boolean;
  maxFps: number;
  indicatorUpdateInterval: number;
  notificationBadgeUpdateInterval: number;
  maxStatusSpriteDistance: number;
  maxNameSpriteDistance: number;
  maxBadgeDistance: number;
  maxBuildingLabelDistance: number;
  overlayEffectDistance: number;
  reduceTransientEffects: boolean;
}

type NavigatorWithHints = Navigator & {
  deviceMemory?: number;
};

export function getScenePerformanceProfile(): ScenePerformanceProfile {
  if (typeof window === 'undefined') {
    return {
      isMobile: false,
      isConstrained: false,
      maxPixelRatio: 2,
      antialias: true,
      enableShadows: true,
      maxFps: 0,
      indicatorUpdateInterval: 100,
      notificationBadgeUpdateInterval: 0,
      maxStatusSpriteDistance: 28,
      maxNameSpriteDistance: 22,
      maxBadgeDistance: 18,
      maxBuildingLabelDistance: 32,
      overlayEffectDistance: 24,
      reduceTransientEffects: false,
    };
  }

  const nav = navigator as NavigatorWithHints;
  const userAgent = nav.userAgent || '';
  const isMobileViewport = window.matchMedia('(max-width: 768px)').matches;
  const hasTouch = nav.maxTouchPoints > 0;
  const isMobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
  const isMobile = isMobileViewport || (hasTouch && isMobileUserAgent);
  const isLowMemory = (nav.deviceMemory ?? Infinity) <= 4;
  const isLowCpu = (nav.hardwareConcurrency ?? Infinity) <= 6;
  const isConstrained = isMobile || isLowMemory || isLowCpu;
  const canAffordHigherQuality = !isLowMemory && (nav.hardwareConcurrency ?? Infinity) >= 8;

  if (!isConstrained) {
    return {
      isMobile,
      isConstrained: false,
      maxPixelRatio: 2,
      antialias: true,
      enableShadows: true,
      maxFps: 0,
      indicatorUpdateInterval: 100,
      notificationBadgeUpdateInterval: 0,
      maxStatusSpriteDistance: 28,
      maxNameSpriteDistance: 22,
      maxBadgeDistance: 18,
      maxBuildingLabelDistance: 32,
      overlayEffectDistance: 24,
      reduceTransientEffects: false,
    };
  }

  return {
    isMobile,
    isConstrained: true,
    maxPixelRatio: canAffordHigherQuality ? 1.75 : 1.5,
    antialias: canAffordHigherQuality,
    enableShadows: false,
    maxFps: 30,
    indicatorUpdateInterval: 250,
    notificationBadgeUpdateInterval: 400,
    maxStatusSpriteDistance: 20,
    maxNameSpriteDistance: 14,
    maxBadgeDistance: 11,
    maxBuildingLabelDistance: 18,
    overlayEffectDistance: 18,
    reduceTransientEffects: true,
  };
}

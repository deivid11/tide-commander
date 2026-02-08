import * as THREE from 'three';
import type { CustomAgentClass } from '../../../shared/types';

/**
 * Handles animation mixer creation, clip mapping, and time-based utilities.
 */
export class AnimationConfigurator {
  /**
   * Create an animation mixer and map clips by name for an agent mesh.
   * Stores custom animation mapping in userData if provided.
   */
  createAnimationSetup(
    mesh: THREE.Group,
    clips: THREE.AnimationClip[],
    customClass?: CustomAgentClass
  ): {
    mixer: THREE.AnimationMixer;
    animations: Map<string, THREE.AnimationClip>;
  } {
    if (customClass?.animationMapping) {
      mesh.userData.animationMapping = customClass.animationMapping;
    }

    const mixer = new THREE.AnimationMixer(mesh);
    const animations = new Map<string, THREE.AnimationClip>();

    for (const clip of clips) {
      // Normalize to lowercase for consistent lookup
      animations.set(clip.name.toLowerCase(), clip);
      // Also store with original name for custom animation mapping
      animations.set(clip.name, clip);
    }

    return { mixer, animations };
  }

  /**
   * Get color for idle timer based on duration.
   * Smooth gradient from green (0 min) to red (1+ hour).
   */
  getIdleTimerColor(idleSeconds: number): { text: string; border: string } {
    const maxMinutes = 60;
    const minutes = Math.min(idleSeconds / 60, maxMinutes);

    const progress = minutes / maxMinutes;
    const curvedProgress = Math.pow(progress, 0.7);
    const hue = 120 * (1 - curvedProgress);

    const saturation = 80 + (20 * curvedProgress);
    const lightness = 60 - (10 * curvedProgress);

    const color = `hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`;
    return { text: color, border: color };
  }

  /**
   * Format idle time for display in short format.
   */
  formatIdleTimeShort(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      const secs = seconds % 60;
      return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours < 24) {
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }
}

// HMR
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.log('[Tide HMR] AnimationConfigurator updated - pending refresh available');
    window.__tideHmrPendingSceneChanges = true;
  });
}

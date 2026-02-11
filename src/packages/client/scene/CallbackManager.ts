/**
 * Manages external callbacks for scene events.
 * Extracted from SceneManager for separation of concerns.
 */
export class CallbackManager {
  private onBuildingClickCallback: ((buildingId: string, screenPos: { x: number; y: number }) => void) | null = null;
  private onBuildingDoubleClickCallback: ((buildingId: string) => void) | null = null;
  private onContextMenuCallback: ((
    screenPos: { x: number; y: number },
    worldPos: { x: number; z: number },
    target: { type: 'ground' | 'agent' | 'area' | 'building'; id?: string }
  ) => void) | null = null;
  private onAgentHoverCallback: ((
    agentId: string | null,
    screenPos: { x: number; y: number } | null
  ) => void) | null = null;
  private onBuildingHoverCallback: ((
    buildingId: string | null,
    screenPos: { x: number; y: number } | null
  ) => void) | null = null;
  private onGroundClickCallback: (() => void) | null = null;
  private onAreaDoubleClickCallback: ((areaId: string) => void) | null = null;

  // ============================================
  // Callback Setters
  // ============================================

  setOnBuildingClick(callback: (buildingId: string, screenPos: { x: number; y: number }) => void): void {
    this.onBuildingClickCallback = callback;
  }

  setOnBuildingDoubleClick(callback: (buildingId: string) => void): void {
    this.onBuildingDoubleClickCallback = callback;
  }

  setOnContextMenu(
    callback: (
      screenPos: { x: number; y: number },
      worldPos: { x: number; z: number },
      target: { type: 'ground' | 'agent' | 'area' | 'building'; id?: string }
    ) => void
  ): void {
    this.onContextMenuCallback = callback;
  }

  setOnAgentHover(
    callback: (
      agentId: string | null,
      screenPos: { x: number; y: number } | null
    ) => void
  ): void {
    this.onAgentHoverCallback = callback;
  }

  setOnBuildingHover(
    callback: (
      buildingId: string | null,
      screenPos: { x: number; y: number } | null
    ) => void
  ): void {
    this.onBuildingHoverCallback = callback;
  }

  setOnGroundClick(callback: () => void): void {
    this.onGroundClickCallback = callback;
  }

  setOnAreaDoubleClick(callback: (areaId: string) => void): void {
    this.onAreaDoubleClickCallback = callback;
  }

  // ============================================
  // Callback Triggers
  // ============================================

  triggerBuildingClick(buildingId: string, screenPos: { x: number; y: number }): void {
    this.onBuildingClickCallback?.(buildingId, screenPos);
  }

  triggerBuildingDoubleClick(buildingId: string): void {
    this.onBuildingDoubleClickCallback?.(buildingId);
  }

  triggerContextMenu(
    screenPos: { x: number; y: number },
    worldPos: { x: number; z: number },
    target: { type: 'ground' | 'agent' | 'area' | 'building'; id?: string }
  ): void {
    this.onContextMenuCallback?.(screenPos, worldPos, target);
  }

  triggerAgentHover(
    agentId: string | null,
    screenPos: { x: number; y: number } | null
  ): void {
    this.onAgentHoverCallback?.(agentId, screenPos);
  }

  triggerBuildingHover(
    buildingId: string | null,
    screenPos: { x: number; y: number } | null
  ): void {
    this.onBuildingHoverCallback?.(buildingId, screenPos);
  }

  triggerGroundClick(): void {
    this.onGroundClickCallback?.();
  }

  triggerAreaDoubleClick(areaId: string): void {
    this.onAreaDoubleClickCallback?.(areaId);
  }
}

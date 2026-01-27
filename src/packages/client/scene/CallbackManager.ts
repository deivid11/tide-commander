/**
 * Manages external callbacks for scene events.
 * Extracted from SceneManager for separation of concerns.
 */
export class CallbackManager {
  private onBuildingClickCallback: ((buildingId: string) => void) | null = null;
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

  // ============================================
  // Callback Setters
  // ============================================

  setOnBuildingClick(callback: (buildingId: string) => void): void {
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

  // ============================================
  // Callback Triggers
  // ============================================

  triggerBuildingClick(buildingId: string): void {
    this.onBuildingClickCallback?.(buildingId);
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
}

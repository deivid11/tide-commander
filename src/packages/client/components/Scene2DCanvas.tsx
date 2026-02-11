/**
 * Scene2DCanvas - Canvas component for 2D scene rendering
 *
 * Lightweight alternative to the 3D BattlefieldCanvas
 */

import { useRef, useEffect } from 'react';
import { useScene2DSetup } from '../hooks/useScene2DSetup';
import './Scene2DCanvas.scss';

interface Scene2DCanvasProps {
  onAgentClick?: (agentId: string, shiftKey: boolean) => void;
  onAgentDoubleClick?: (agentId: string) => void;
  onAgentHover?: (agentId: string | null, screenPos: { x: number; y: number } | null) => void;
  onBuildingClick?: (buildingId: string, screenPos: { x: number; y: number }) => void;
  onBuildingDoubleClick?: (buildingId: string) => void;
  onBuildingDragStart?: (buildingId: string, startPos: { x: number; z: number }) => void;
  onBuildingDragMove?: (buildingId: string, currentPos: { x: number; z: number }) => void;
  onBuildingDragEnd?: (buildingId: string, endPos: { x: number; z: number }) => void;
  onBuildingDragCancel?: (buildingId: string) => void;
  onContextMenu?: (screenPos: { x: number; y: number }, worldPos: { x: number; z: number }, target: { type: string; id?: string } | null) => void;
  onGroundClick?: (worldPos: { x: number; z: number }) => void;
  onMoveCommand?: (agentIds: string[], targetPos: { x: number; z: number }) => void;
  onAreaDoubleClick?: (areaId: string) => void;
  indicatorScale?: number;
  showGrid?: boolean;
  fpsLimit?: number;
  className?: string;
}

export function Scene2DCanvas({
  onAgentClick,
  onAgentDoubleClick,
  onAgentHover,
  onBuildingClick,
  onBuildingDoubleClick,
  onBuildingDragStart,
  onBuildingDragMove,
  onBuildingDragEnd,
  onBuildingDragCancel,
  onContextMenu,
  onGroundClick,
  onMoveCommand,
  onAreaDoubleClick,
  indicatorScale = 1.0,
  showGrid = true,
  fpsLimit = 0,
  className = '',
}: Scene2DCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const {
    scene,
    focusAgent: _focusAgent,
    updateAgent: _updateAgent,
    createMoveOrderEffect: _createMoveOrderEffect,
    showToolBubble: _showToolBubble,
    setIndicatorScale,
    setGridVisible,
    setDrawingTool,
    setFpsLimit,
  } = useScene2DSetup(canvasRef, {
    onAgentClick,
    onAgentDoubleClick,
    onAgentHover,
    onBuildingClick,
    onBuildingDoubleClick,
    onBuildingDragStart,
    onBuildingDragMove,
    onBuildingDragEnd,
    onBuildingDragCancel,
    onContextMenu,
    onGroundClick,
    onMoveCommand,
    onAreaDoubleClick,
  });

  // Expose setDrawingTool via global reference for App.tsx to call
  useEffect(() => {
    if (typeof window !== 'undefined' && scene.current) {
      (window as any).__tideScene2D_setDrawingTool = setDrawingTool;
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).__tideScene2D_setDrawingTool;
      }
    };
  }, [setDrawingTool, scene]);

  // Apply indicator scale
  useEffect(() => {
    setIndicatorScale(indicatorScale);
  }, [indicatorScale, setIndicatorScale]);

  // Apply grid visibility
  useEffect(() => {
    setGridVisible(showGrid);
  }, [showGrid, setGridVisible]);

  // Apply FPS limit
  useEffect(() => {
    setFpsLimit(fpsLimit);
  }, [fpsLimit, setFpsLimit]);

  // Note: Global scene reference (__tideScene2D) is now set in useScene2DSetup hook

  return (
    <div className={`scene-2d-container ${className}`}>
      <canvas
        ref={canvasRef}
        className="scene-2d-canvas"
      />
      <div className="scene-2d-badge">
        2D Mode
      </div>
    </div>
  );
}

export default Scene2DCanvas;

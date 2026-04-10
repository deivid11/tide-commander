/**
 * WorkspaceSwitcher
 *
 * Dropdown in the AgentBar that lets users switch between workspaces
 * (named groups of areas). When a workspace is active, only agents in
 * those areas are shown across the UI (AgentBar, scene, overview panel).
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAreas } from '../store';
import { loadCameraState, saveCameraState } from '../utils/camera';
import type { CameraState } from '../utils/camera';
import type { Workspace } from '../api/workspaces';
import {
  fetchWorkspaces,
  createWorkspace,
  updateWorkspace as apiUpdateWorkspace,
  deleteWorkspace as apiDeleteWorkspace,
  getActiveWorkspace,
  setActiveWorkspace as apiSetActiveWorkspace,
} from '../api/workspaces';

// ============================================================================
// Shared workspace state (accessible from other components via hook)
// ============================================================================

type WorkspaceListener = () => void;
const listeners = new Set<WorkspaceListener>();
let currentActiveWorkspace: Workspace | null = null;
let allWorkspaces: Workspace[] = [];
let isSwitchingWorkspace = false;
type SwitchingListener = (switching: boolean) => void;
const switchingListeners = new Set<SwitchingListener>();
function setSwitching(val: boolean) {
  isSwitchingWorkspace = val;
  switchingListeners.forEach((fn) => fn(val));
}
const ACTIVE_WORKSPACE_STORAGE_KEY = 'tide-commander-active-workspace';

function readStoredActiveWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
  return stored || null;
}

function storeActiveWorkspaceId(id: string | null) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, id || '');
}

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

/** Returns the currently active workspace (null = show all). */
export function getActiveWorkspaceState(): Workspace | null {
  return currentActiveWorkspace;
}

/** Returns all loaded workspaces. */
export function getAllWorkspaces(): Workspace[] {
  return allWorkspaces;
}

/**
 * Returns true if an agent (by its area ID) should be visible given the
 * current workspace filter. Agents without an area are hidden when a
 * workspace is active.
 */
export function isAgentVisibleInWorkspace(areaId: string | null): boolean {
  if (!currentActiveWorkspace) return true; // no filter
  if (!areaId) return false; // unassigned agents hidden when workspace active
  return currentActiveWorkspace.areaIds.includes(areaId);
}

/**
 * Returns true if an area should be visible given the current workspace filter.
 * When no workspace is active (show all), every area is visible.
 */
export function isAreaVisibleInWorkspace(areaId: string): boolean {
  if (!currentActiveWorkspace) return true; // no filter — show all
  return currentActiveWorkspace.areaIds.includes(areaId);
}

/**
 * React hook to subscribe to workspace changes.
 * Returns [activeWorkspace, allWorkspaces].
 */
export function useWorkspaceFilter(): [Workspace | null, Workspace[]] {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const listener = () => forceUpdate((n) => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  return [currentActiveWorkspace, allWorkspaces];
}

/**
 * Non-React subscription for workspace changes.
 * Returns an unsubscribe function.
 */
export function subscribeToWorkspaceChanges(callback: () => void): () => void {
  listeners.add(callback);
  return () => { listeners.delete(callback); };
}

/**
 * React hook to subscribe to workspace switching state.
 * Returns true while a workspace switch transition is in progress.
 */
export function useWorkspaceSwitching(): boolean {
  const [switching, setSwitchingState] = useState(isSwitchingWorkspace);
  useEffect(() => {
    const listener: SwitchingListener = (val) => setSwitchingState(val);
    switchingListeners.add(listener);
    return () => { switchingListeners.delete(listener); };
  }, []);
  return switching;
}

// ============================================================================
// Camera state cache per workspace
// ============================================================================

const cameraCache = new Map<string, CameraState>();

// ============================================================================
// WorkspaceSwitcher component
// ============================================================================

export const WorkspaceSwitcher: React.FC = React.memo(function WorkspaceSwitcher() {
  const { t } = useTranslation('common');
  const areas = useAreas();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => readStoredActiveWorkspaceId());
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Manager state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editAreaIds, setEditAreaIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load workspaces on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const storedActiveId = readStoredActiveWorkspaceId();
        const [ws, apiActiveId] = await Promise.all([fetchWorkspaces(), getActiveWorkspace()]);
        if (cancelled) return;
        const nextActiveId = storedActiveId && ws.some((w) => w.id === storedActiveId)
          ? storedActiveId
          : apiActiveId && ws.some((w) => w.id === apiActiveId)
            ? apiActiveId
            : null;
        setWorkspaces(ws);
        allWorkspaces = ws;
        setActiveId(nextActiveId);
        storeActiveWorkspaceId(nextActiveId);
        currentActiveWorkspace = ws.find((w) => w.id === nextActiveId) ?? null;
        notifyListeners();
      } catch (err) {
        console.error('workspace error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Click outside to close dropdown
  useEffect(() => {
    if (!dropdownOpen && !managerOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setManagerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen, managerOpen]);

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeId) ?? null,
    [workspaces, activeId]
  );

  // Switch workspace
  const handleSelect = useCallback(async (id: string | null) => {
    // Show loading overlay
    setSwitching(true);
    const switchStart = Date.now();

    // Save current camera state for the old workspace (local cache + server)
    if (activeId) {
      const cam = loadCameraState();
      if (cam) {
        cameraCache.set(activeId, cam);
        // Persist to server and update local workspaces array
        apiUpdateWorkspace(activeId, { cameraState: cam })
          .then((updated) => {
            setWorkspaces((prev) => {
              const next = prev.map((w) => (w.id === activeId ? updated : w));
              allWorkspaces = next;
              return next;
            });
          })
          .catch((err) => console.error('workspace error:', err));
      }
    }

    setActiveId(id);
    storeActiveWorkspaceId(id);
    setDropdownOpen(false);

    const ws = id ? workspaces.find((w) => w.id === id) ?? null : null;
    currentActiveWorkspace = ws;
    allWorkspaces = workspaces;
    notifyListeners();

    // Restore camera for new workspace: server state first, local cache fallback
    if (id) {
      const serverCam = ws?.cameraState;
      const saved = serverCam ?? cameraCache.get(id);
      if (saved) {
        saveCameraState(saved.position, saved.target);
        cameraCache.set(id, saved);
      }
    }

    apiSetActiveWorkspace(id).catch((err) => console.error('workspace error:', err));

    // Ensure overlay shows for at least 400ms to avoid flash
    const elapsed = Date.now() - switchStart;
    const minDisplay = 400;
    if (elapsed < minDisplay) {
      setTimeout(() => setSwitching(false), minDisplay - elapsed);
    } else {
      setSwitching(false);
    }
  }, [activeId, workspaces]);

  // Area list for display
  const areasList = useMemo(() => {
    return Array.from(areas.values()).filter((a) => !a.archived);
  }, [areas]);

  // Create workspace
  const handleCreate = useCallback(async () => {
    if (!editName.trim()) return;
    try {
      const ws = await createWorkspace(editName.trim(), editAreaIds);
      const updated = [...workspaces, ws];
      setWorkspaces(updated);
      allWorkspaces = updated;
      notifyListeners();
      setEditName('');
      setEditAreaIds([]);
      setCreating(false);
    } catch (err) {
      console.error('workspace error:', err);
    }
  }, [editName, editAreaIds, workspaces]);

  // Update workspace
  const handleUpdate = useCallback(async () => {
    if (!editingId || !editName.trim()) return;
    try {
      const ws = await apiUpdateWorkspace(editingId, { name: editName.trim(), areaIds: editAreaIds });
      const updated = workspaces.map((w) => (w.id === editingId ? ws : w));
      setWorkspaces(updated);
      allWorkspaces = updated;
      // Update active workspace if this is the one
      if (editingId === activeId) {
        currentActiveWorkspace = ws;
      }
      notifyListeners();
      setEditingId(null);
      setEditName('');
      setEditAreaIds([]);
    } catch (err) {
      console.error('workspace error:', err);
    }
  }, [editingId, editName, editAreaIds, workspaces, activeId]);

  // Delete workspace
  const handleDelete = useCallback(async (id: string) => {
    try {
      await apiDeleteWorkspace(id);
      const updated = workspaces.filter((w) => w.id !== id);
      setWorkspaces(updated);
      allWorkspaces = updated;
      if (activeId === id) {
        setActiveId(null);
        storeActiveWorkspaceId(null);
        currentActiveWorkspace = null;
        await apiSetActiveWorkspace(null).catch((err) => console.error('workspace error:', err));
      }
      notifyListeners();
    } catch (err) {
      console.error('workspace error:', err);
    }
  }, [workspaces, activeId]);

  // Start editing
  const startEdit = useCallback((ws: Workspace) => {
    setEditingId(ws.id);
    setEditName(ws.name);
    setEditAreaIds([...ws.areaIds]);
    setCreating(false);
  }, []);

  // Start creating
  const startCreate = useCallback(() => {
    setEditingId(null);
    setEditName('');
    setEditAreaIds([]);
    setCreating(true);
  }, []);

  // Toggle area in edit
  const toggleArea = useCallback((areaId: string) => {
    setEditAreaIds((prev) =>
      prev.includes(areaId) ? prev.filter((id) => id !== areaId) : [...prev, areaId]
    );
  }, []);

  if (loading) return null;

  return (
    <div className="workspace-switcher" ref={dropdownRef}>
      <button
        className="workspace-switcher-trigger"
        onClick={() => { setDropdownOpen(!dropdownOpen); setManagerOpen(false); }}
        title="Workspaces"
      >
        <span className="workspace-switcher-icon">📂</span>
        <span className="workspace-switcher-label">
          {activeWorkspace ? activeWorkspace.name : (t('agentBar.allWorkspaces', { defaultValue: 'All' }))}
        </span>
        <span className="workspace-switcher-arrow">{dropdownOpen ? '▲' : '▼'}</span>
      </button>

      {dropdownOpen && !managerOpen && (
        <div className="workspace-switcher-dropdown">
          <button
            className={`workspace-switcher-option ${!activeId ? 'active' : ''}`}
            onClick={() => handleSelect(null)}
          >
            {t('agentBar.allWorkspaces', { defaultValue: 'All' })}
          </button>
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              className={`workspace-switcher-option ${ws.id === activeId ? 'active' : ''}`}
              onClick={() => handleSelect(ws.id)}
            >
              {ws.name}
              <span className="workspace-switcher-option-count">{ws.areaIds.length}</span>
            </button>
          ))}
          <div className="workspace-switcher-divider" />
          <button
            className="workspace-switcher-option workspace-switcher-manage"
            onClick={() => setManagerOpen(true)}
          >
            ⚙ {t('agentBar.manageWorkspaces', { defaultValue: 'Manage' })}
          </button>
        </div>
      )}

      {managerOpen && (
        <div className="workspace-switcher-dropdown workspace-switcher-manager">
          <div className="workspace-switcher-manager-header">
            <span>{t('agentBar.workspaces', { defaultValue: 'Workspaces' })}</span>
            <button className="workspace-switcher-close" onClick={() => setManagerOpen(false)}>×</button>
          </div>

          {/* Workspace list */}
          <div className="workspace-switcher-manager-list">
            {workspaces.map((ws) => (
              <div key={ws.id} className="workspace-switcher-manager-item">
                {editingId === ws.id ? (
                  <div className="workspace-switcher-editor">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="workspace-switcher-input"
                      placeholder="Workspace name"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === 'Enter') handleUpdate(); if (e.key === 'Escape') setEditingId(null); }}
                    />
                    <div className="workspace-switcher-area-list">
                      {areasList.map((area) => (
                        <label key={area.id} className="workspace-switcher-area-check">
                          <input
                            type="checkbox"
                            checked={editAreaIds.includes(area.id)}
                            onChange={() => toggleArea(area.id)}
                          />
                          <span style={{ color: area.color }}>{area.name}</span>
                        </label>
                      ))}
                      {areasList.length === 0 && <span className="workspace-switcher-empty">No areas</span>}
                    </div>
                    <div className="workspace-switcher-editor-actions">
                      <button className="workspace-switcher-btn-save" onClick={handleUpdate}>Save</button>
                      <button className="workspace-switcher-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="workspace-switcher-manager-row">
                    <span className="workspace-switcher-manager-name">{ws.name}</span>
                    <span className="workspace-switcher-manager-count">{ws.areaIds.length} areas</span>
                    <button className="workspace-switcher-btn-edit" onClick={() => startEdit(ws)} title="Edit">✏</button>
                    <button className="workspace-switcher-btn-delete" onClick={() => handleDelete(ws.id)} title="Delete">🗑</button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Create new */}
          {creating ? (
            <div className="workspace-switcher-editor workspace-switcher-create-form">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="workspace-switcher-input"
                placeholder="New workspace name"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
              />
              <div className="workspace-switcher-area-list">
                {areasList.map((area) => (
                  <label key={area.id} className="workspace-switcher-area-check">
                    <input
                      type="checkbox"
                      checked={editAreaIds.includes(area.id)}
                      onChange={() => toggleArea(area.id)}
                    />
                    <span style={{ color: area.color }}>{area.name}</span>
                  </label>
                ))}
                {areasList.length === 0 && <span className="workspace-switcher-empty">No areas</span>}
              </div>
              <div className="workspace-switcher-editor-actions">
                <button className="workspace-switcher-btn-save" onClick={handleCreate}>Create</button>
                <button className="workspace-switcher-btn-cancel" onClick={() => setCreating(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="workspace-switcher-option workspace-switcher-add" onClick={startCreate}>
              + {t('agentBar.newWorkspace', { defaultValue: 'New Workspace' })}
            </button>
          )}
        </div>
      )}
    </div>
  );
});

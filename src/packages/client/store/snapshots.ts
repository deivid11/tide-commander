/**
 * Snapshot Store Actions
 *
 * Handles snapshot management: creation, listing, viewing, deletion, and file restoration.
 * Snapshots capture conversation outputs and files for later viewing and restoration.
 */

import type { StoreState } from './types';
import { apiUrl, authFetch } from '../utils/storage';
import type {
  ConversationSnapshot,
  SnapshotListItem,
  SnapshotFile,
} from '../../shared/types/snapshot';

// Types are now imported from shared types
// export { ConversationSnapshot, SnapshotListItem, SnapshotFile } from '../../shared/types/snapshot';

/**
 * Snapshot Store State
 */
export interface SnapshotStoreState {
  // Data
  snapshots: Map<string, SnapshotListItem>;
  currentSnapshot: ConversationSnapshot | null;

  // UI state
  loading: boolean;
  error: string | null;
}

/**
 * Snapshot Actions
 */
export interface SnapshotActions {
  // Fetch and list
  fetchSnapshots(): Promise<void>;
  setSnapshots(snapshots: SnapshotListItem[]): void;

  // Create
  createSnapshot(
    agentId: string,
    agentName: string,
    title: string,
    description?: string,
    outputs?: Array<unknown>,
    files?: SnapshotFile[]
  ): Promise<ConversationSnapshot>;

  // View/Load
  loadSnapshot(snapshotId: string): Promise<void>;
  setCurrentSnapshot(snapshot: ConversationSnapshot | null): void;

  // Delete
  deleteSnapshot(snapshotId: string): Promise<void>;

  // File operations
  restoreFiles(snapshotId: string, filePaths?: string[]): Promise<void>;

  // State management
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  clearError(): void;
  reset(): void;
}

/**
 * Create snapshot actions
 *
 * NOTE: These actions assume that the API endpoints are ready from Ditto's implementation.
 * API endpoints expected:
 * - POST /api/snapshots - Create snapshot
 * - GET /api/snapshots - List all snapshots
 * - GET /api/snapshots/:id - Get specific snapshot details
 * - POST /api/snapshots/:id/restore - Restore files from snapshot
 * - DELETE /api/snapshots/:id - Delete snapshot
 */
export function createSnapshotActions(
  getState: () => StoreState,
  setState: (updater: (state: StoreState) => void) => void,
  notify: () => void
): SnapshotActions {
  return {
    async fetchSnapshots(): Promise<void> {
      setState((state) => {
        state.snapshotsLoading = true;
        state.snapshotsError = null;
      });
      notify();

      try {
        const response = await authFetch(apiUrl('/api/snapshots'));

        if (!response.ok) {
          throw new Error(`Failed to fetch snapshots: ${response.statusText}`);
        }

        const data = await response.json();
        const snapshots = Array.isArray(data) ? data : data.snapshots || [];

        this.setSnapshots(snapshots);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch snapshots';
        this.setError(message);
        console.error('Snapshot fetch error:', error);
      } finally {
        setState((state) => {
          state.snapshotsLoading = false;
        });
        notify();
      }
    },

    setSnapshots(snapshots: SnapshotListItem[]): void {
      setState((state) => {
        const snapshotMap = new Map<string, SnapshotListItem>();
        snapshots.forEach((snapshot) => {
          snapshotMap.set(snapshot.id, snapshot);
        });
        state.snapshots = snapshotMap;
      });
      notify();
    },

    async createSnapshot(
      agentId: string,
      agentName: string,
      title: string,
      description?: string,
      outputs?: Array<unknown>,
      files?: SnapshotFile[]
    ): Promise<ConversationSnapshot> {
      setState((state) => {
        state.snapshotsLoading = true;
        state.snapshotsError = null;
      });
      notify();

      try {
        const payload = {
          agentId,
          agentName,
          title,
          description,
          outputs: outputs || [],
          files: files || [],
        };

        const response = await authFetch(apiUrl('/api/snapshots'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`Failed to create snapshot: ${response.statusText}`);
        }

        const snapshot = await response.json();

        // Update snapshots list
        await this.fetchSnapshots();

        return snapshot;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create snapshot';
        this.setError(message);
        console.error('Snapshot creation error:', error);
        throw error;
      } finally {
        setState((state) => {
          state.snapshotsLoading = false;
        });
        notify();
      }
    },

    async loadSnapshot(snapshotId: string): Promise<void> {
      setState((state) => {
        state.snapshotsLoading = true;
        state.snapshotsError = null;
      });
      notify();

      try {
        const response = await authFetch(apiUrl(`/api/snapshots/${snapshotId}`));

        if (!response.ok) {
          throw new Error(`Failed to load snapshot: ${response.statusText}`);
        }

        const snapshot = await response.json();
        this.setCurrentSnapshot(snapshot);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load snapshot';
        this.setError(message);
        console.error('Snapshot load error:', error);
      } finally {
        setState((state) => {
          state.snapshotsLoading = false;
        });
        notify();
      }
    },

    setCurrentSnapshot(snapshot: ConversationSnapshot | null): void {
      setState((state) => {
        state.currentSnapshot = snapshot;
      });
      notify();
    },

    async deleteSnapshot(snapshotId: string): Promise<void> {
      setState((state) => {
        state.snapshotsLoading = true;
        state.snapshotsError = null;
      });
      notify();

      try {
        const response = await authFetch(apiUrl(`/api/snapshots/${snapshotId}`), {
          method: 'DELETE',
        });

        if (!response.ok) {
          throw new Error(`Failed to delete snapshot: ${response.statusText}`);
        }

        // Update snapshots list
        await this.fetchSnapshots();

        // Clear current snapshot if it was deleted
        if (getState().currentSnapshot?.id === snapshotId) {
          this.setCurrentSnapshot(null);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete snapshot';
        this.setError(message);
        console.error('Snapshot deletion error:', error);
        throw error;
      } finally {
        setState((state) => {
          state.snapshotsLoading = false;
        });
        notify();
      }
    },

    async restoreFiles(snapshotId: string, filePaths?: string[]): Promise<void> {
      setState((state) => {
        state.snapshotsLoading = true;
        state.snapshotsError = null;
      });
      notify();

      try {
        const payload = filePaths ? { filePaths } : {};

        const response = await authFetch(apiUrl(`/api/snapshots/${snapshotId}/restore`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`Failed to restore files: ${response.statusText}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to restore files';
        this.setError(message);
        console.error('File restoration error:', error);
        throw error;
      } finally {
        setState((state) => {
          state.snapshotsLoading = false;
        });
        notify();
      }
    },

    setLoading(loading: boolean): void {
      setState((state) => {
        state.snapshotsLoading = loading;
      });
      notify();
    },

    setError(error: string | null): void {
      setState((state) => {
        state.snapshotsError = error;
      });
      notify();
    },

    clearError(): void {
      this.setError(null);
    },

    reset(): void {
      setState((state) => {
        state.snapshots = new Map();
        state.currentSnapshot = null;
        state.snapshotsLoading = false;
        state.snapshotsError = null;
      });
      notify();
    },
  };
}


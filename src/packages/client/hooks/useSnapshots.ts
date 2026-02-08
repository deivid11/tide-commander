/**
 * Custom hooks for snapshot management
 *
 * Provides React hooks for interacting with the snapshot store and API.
 * Simplifies snapshot operations for components.
 */

import { useState, useCallback } from 'react';
import type { SnapshotActions } from '../store/snapshots';
import type {
  ConversationSnapshot,
  SnapshotListItem,
  SnapshotFile,
} from '../../shared/types/snapshot';

/**
 * Hook for listing all snapshots
 *
 * @example
 * const { snapshots, loading, error, refetch } = useListSnapshots();
 * useEffect(() => { refetch(); }, [refetch]);
 * return <div>{snapshots.map(s => <div key={s.id}>{s.title}</div>)}</div>;
 */
export interface UseListSnapshotsResult {
  snapshots: SnapshotListItem[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useListSnapshots(snapshotActions: SnapshotActions): UseListSnapshotsResult {
  const [snapshots, _setSnapshots] = useState<SnapshotListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      await snapshotActions.fetchSnapshots();
      // Note: State should be pulled from the store in real usage
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch snapshots';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [snapshotActions]);

  return { snapshots, loading, error, refetch };
}

/**
 * Hook for creating a new snapshot
 *
 * @example
 * const { create, loading, error } = useCreateSnapshot();
 * const handleCreate = async () => {
 *   await create('agent-1', 'Agent Name', 'My Snapshot Title', 'Optional description');
 * };
 */
export interface UseCreateSnapshotResult {
  create: (
    agentId: string,
    agentName: string,
    title: string,
    description?: string,
    outputs?: Array<unknown>,
    files?: SnapshotFile[]
  ) => Promise<ConversationSnapshot | null>;
  loading: boolean;
  error: string | null;
  success: boolean;
}

export function useCreateSnapshot(snapshotActions: SnapshotActions): UseCreateSnapshotResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const create = useCallback(
    async (
      agentId: string,
      agentName: string,
      title: string,
      description?: string,
      outputs?: Array<unknown>,
      files?: SnapshotFile[]
    ): Promise<ConversationSnapshot | null> => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(false);

        const snapshot = await snapshotActions.createSnapshot(
          agentId,
          agentName,
          title,
          description,
          outputs,
          files
        );

        setSuccess(true);
        return snapshot;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create snapshot';
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [snapshotActions]
  );

  return { create, loading, error, success };
}

/**
 * Hook for loading a specific snapshot
 *
 * @example
 * const { snapshot, loading, error, load } = useLoadSnapshot();
 * const handleLoad = async () => { await load('snapshot-123'); };
 */
export interface UseLoadSnapshotResult {
  snapshot: ConversationSnapshot | null;
  loading: boolean;
  error: string | null;
  load: (snapshotId: string) => Promise<void>;
}

export function useLoadSnapshot(snapshotActions: SnapshotActions): UseLoadSnapshotResult {
  const [snapshot, _setSnapshot] = useState<ConversationSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (snapshotId: string) => {
      try {
        setLoading(true);
        setError(null);
        await snapshotActions.loadSnapshot(snapshotId);
        // Note: State should be pulled from the store in real usage
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load snapshot';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [snapshotActions]
  );

  return { snapshot, loading, error, load };
}

/**
 * Hook for deleting a snapshot
 *
 * @example
 * const { delete: deleteSnapshot, loading, error } = useDeleteSnapshot();
 * const handleDelete = async () => { await deleteSnapshot('snapshot-123'); };
 */
export interface UseDeleteSnapshotResult {
  delete: (snapshotId: string) => Promise<void>;
  loading: boolean;
  error: string | null;
  success: boolean;
}

export function useDeleteSnapshot(snapshotActions: SnapshotActions): UseDeleteSnapshotResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const deleteSnapshot = useCallback(
    async (snapshotId: string) => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(false);

        await snapshotActions.deleteSnapshot(snapshotId);
        setSuccess(true);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete snapshot';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [snapshotActions]
  );

  return { delete: deleteSnapshot, loading, error, success };
}

/**
 * Hook for restoring files from a snapshot
 *
 * @example
 * const { restore, loading, error } = useRestoreFiles();
 * const handleRestore = async () => {
 *   await restore('snapshot-123', ['/path/to/file1', '/path/to/file2']);
 * };
 */
export interface UseRestoreFilesResult {
  restore: (snapshotId: string, filePaths?: string[]) => Promise<void>;
  loading: boolean;
  error: string | null;
  success: boolean;
}

export function useRestoreFiles(snapshotActions: SnapshotActions): UseRestoreFilesResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const restore = useCallback(
    async (snapshotId: string, filePaths?: string[]) => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(false);

        await snapshotActions.restoreFiles(snapshotId, filePaths);
        setSuccess(true);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to restore files';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [snapshotActions]
  );

  return { restore, loading, error, success };
}

/**
 * Combined hook for all snapshot operations
 *
 * Provides a single hook that gives access to all snapshot functionality
 * with a simpler interface for components.
 *
 * @example
 * const snapshots = useSnapshots(snapshotActions);
 * useEffect(() => { snapshots.list.refetch(); }, [snapshots.list]);
 * return (
 *   <div>
 *     {snapshots.list.snapshots.map(s => (
 *       <button key={s.id} onClick={() => snapshots.load.load(s.id)}>
 *         {s.title}
 *       </button>
 *     ))}
 *   </div>
 * );
 */
export interface UseSnapshotsResult {
  list: UseListSnapshotsResult;
  create: UseCreateSnapshotResult;
  load: UseLoadSnapshotResult;
  delete: UseDeleteSnapshotResult;
  restore: UseRestoreFilesResult;
}

export function useSnapshots(snapshotActions: SnapshotActions): UseSnapshotsResult {
  return {
    list: useListSnapshots(snapshotActions),
    create: useCreateSnapshot(snapshotActions),
    load: useLoadSnapshot(snapshotActions),
    delete: useDeleteSnapshot(snapshotActions),
    restore: useRestoreFiles(snapshotActions),
  };
}

export default useSnapshots;

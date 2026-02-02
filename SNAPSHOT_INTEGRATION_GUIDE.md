# Snapshot Feature - Integration Guide

This guide explains how to wire the snapshot feature components together using the Zustand store and custom hooks.

## Architecture Overview

```
Store (Zustand) → Selectors (React Hooks) → Components
     ↓
  snapshots.ts (state + actions)
     ↓
  useSnapshots.ts (custom hooks)
     ↓
  useStore/useSnapshots (selectors in components)
```

## Store Setup (✅ COMPLETED)

The store is already set up in `src/packages/client/store/snapshots.ts` with:

### State
- `snapshots`: Map<string, SnapshotListItem> - List of all saved snapshots
- `currentSnapshot`: ConversationSnapshot | null - Currently viewed snapshot
- `snapshotsLoading`: boolean - Loading state
- `snapshotsError`: string | null - Error messages

### Actions
- `fetchSnapshots()` - Fetch list of all snapshots
- `createSnapshot()` - Create a new snapshot
- `loadSnapshot(id)` - Load snapshot details
- `deleteSnapshot(id)` - Delete a snapshot
- `restoreFiles(id, paths?)` - Restore files from snapshot
- `setLoading()`, `setError()`, `clearError()`, `reset()`

## Using in Components

### Example 1: SaveSnapshotModal Component

```tsx
import { useStore } from '@/packages/client/store';
import { useCreateSnapshot } from '@/packages/client/hooks/useSnapshots';
import { useModalState } from '@/packages/client/hooks/useModalState';

export function SaveSnapshotModal() {
  const store = useStore();
  const { create, loading, error, success } = useCreateSnapshot(store);
  const modal = useModalState<{ agentId: string; agentName: string }>();

  const handleSave = async (title: string, description: string) => {
    if (!modal.data) return;

    const snapshot = await create(
      modal.data.agentId,
      modal.data.agentName,
      title,
      description
    );

    if (snapshot) {
      modal.close();
      // Show success message
    }
  };

  return (
    <Modal isOpen={modal.isOpen} onClose={modal.close}>
      <h2>Save Snapshot</h2>
      {error && <div className="error">{error}</div>}
      {success && <div className="success">Snapshot created successfully!</div>}

      <input
        type="text"
        placeholder="Snapshot title"
        disabled={loading}
      />
      <textarea
        placeholder="Description (optional)"
        disabled={loading}
      />

      <button onClick={() => handleSave(title, description)} disabled={loading}>
        {loading ? 'Saving...' : 'Save Snapshot'}
      </button>
    </Modal>
  );
}
```

### Example 2: SnapshotManager Component

```tsx
import { useStore } from '@/packages/client/store';
import { useSnapshots, useListSnapshots, useDeleteSnapshot } from '@/packages/client/hooks/useSnapshots';
import { useEffect } from 'react';

export function SnapshotManager() {
  const store = useStore();
  const snapshots = useStore(state => Array.from(state.snapshots.values()));
  const { delete: deleteSnapshot, loading: deleteLoading } = useDeleteSnapshot(store);
  const { refetch } = useListSnapshots(store);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const handleDelete = async (snapshotId: string) => {
    if (!confirm('Delete this snapshot?')) return;
    await deleteSnapshot(snapshotId);
  };

  return (
    <div>
      <h2>Snapshots</h2>
      <button onClick={() => refetch()}>Refresh</button>

      {snapshots.length === 0 ? (
        <p>No snapshots saved yet</p>
      ) : (
        <div className="snapshot-grid">
          {snapshots.map(snapshot => (
            <div key={snapshot.id} className="snapshot-card">
              <h3>{snapshot.title}</h3>
              <p>{snapshot.agentName}</p>
              <p>{new Date(snapshot.createdAt).toLocaleString()}</p>
              <p>{snapshot.fileCount} files</p>

              <button onClick={() => store.loadSnapshot(snapshot.id)}>
                View
              </button>
              <button
                onClick={() => handleDelete(snapshot.id)}
                disabled={deleteLoading}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Example 3: SnapshotViewer Component

```tsx
import { useStore } from '@/packages/client/store';
import { useRestoreFiles } from '@/packages/client/hooks/useSnapshots';
import { useState } from 'react';

export function SnapshotViewer() {
  const currentSnapshot = useStore(state => state.currentSnapshot);
  const { restore, loading: restoreLoading } = useRestoreFiles(useStore());
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);

  if (!currentSnapshot) {
    return <div>No snapshot loaded</div>;
  }

  const handleRestore = async () => {
    await restore(currentSnapshot.id, selectedFiles.length > 0 ? selectedFiles : undefined);
  };

  return (
    <div>
      <h2>{currentSnapshot.title}</h2>
      <p>Agent: {currentSnapshot.agentName}</p>
      <p>Created: {new Date(currentSnapshot.createdAt).toLocaleString()}</p>

      {currentSnapshot.description && (
        <p>{currentSnapshot.description}</p>
      )}

      <h3>Conversation Output</h3>
      <div className="conversation">
        {currentSnapshot.outputs.map((output, idx) => (
          <div key={idx} className={output.isUserPrompt ? 'user-prompt' : 'output'}>
            {output.text}
          </div>
        ))}
      </div>

      <h3>Files</h3>
      <div className="file-list">
        {currentSnapshot.files.map((file, idx) => (
          <div key={idx} className="file-item">
            <label>
              <input
                type="checkbox"
                checked={selectedFiles.includes(file.path)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedFiles([...selectedFiles, file.path]);
                  } else {
                    setSelectedFiles(selectedFiles.filter(p => p !== file.path));
                  }
                }}
              />
              {file.path} ({file.type})
            </label>
          </div>
        ))}
      </div>

      <button
        onClick={handleRestore}
        disabled={restoreLoading || selectedFiles.length === 0}
      >
        {restoreLoading ? 'Restoring...' : 'Restore Selected Files'}
      </button>
    </div>
  );
}
```

### Example 4: Star Button in Terminal Header

```tsx
import { useStore } from '@/packages/client/store';
import { useModalState } from '@/packages/client/hooks/useModalState';

export function TerminalHeader({ agentId, agentName }) {
  const snapshotModal = useModalState<{ agentId: string; agentName: string }>();

  const handleStarClick = () => {
    snapshotModal.open({ agentId, agentName });
  };

  return (
    <div className="terminal-header">
      <h3>{agentName}</h3>

      <button
        onClick={handleStarClick}
        className="star-button"
        title="Save snapshot"
      >
        ⭐
      </button>

      {/* Pass modal state to SaveSnapshotModal */}
      <SaveSnapshotModal
        isOpen={snapshotModal.isOpen}
        onClose={snapshotModal.close}
        agentId={agentId}
        agentName={agentName}
      />
    </div>
  );
}
```

## Hook Usage Patterns

### Using useSnapshots (Combined Hook)

```tsx
const snapshots = useSnapshots(store);

// In effect
useEffect(() => {
  snapshots.list.refetch();
}, []);

// Create new snapshot
const handleCreate = async () => {
  const result = await snapshots.create.create(
    agentId, agentName, title, description
  );
  if (result) {
    console.log('Created:', result.id);
  }
};

// Load snapshot
const handleLoad = async (id: string) => {
  await snapshots.load.load(id);
};

// Delete snapshot
const handleDelete = async (id: string) => {
  await snapshots.delete.delete(id);
};

// Restore files
const handleRestore = async (id: string, files?: string[]) => {
  await snapshots.restore.restore(id, files);
};
```

### Using Individual Hooks

```tsx
// Just list
const { snapshots, loading, error, refetch } = useListSnapshots(store);

// Just create
const { create, loading, error, success } = useCreateSnapshot(store);

// Just load
const { snapshot, loading, error, load } = useLoadSnapshot(store);

// Just delete
const { delete: deleteSnapshot, loading, error, success } = useDeleteSnapshot(store);

// Just restore
const { restore, loading, error, success } = useRestoreFiles(store);
```

## State Management Patterns

### Accessing Snapshots State Directly

```tsx
import { useStore } from '@/packages/client/store';

function MyComponent() {
  // Get all snapshots
  const snapshots = useStore(state => {
    return Array.from(state.snapshots.values());
  });

  // Get current snapshot
  const currentSnapshot = useStore(state => state.currentSnapshot);

  // Get loading/error state
  const isLoading = useStore(state => state.snapshotsLoading);
  const error = useStore(state => state.snapshotsError);
}
```

### Using Selectors

```tsx
import {
  useSnapshots,
  useCurrentSnapshot,
  useSnapshotsLoading,
  useSnapshotsError
} from '@/packages/client/store';

function MyComponent() {
  const snapshots = useSnapshots();          // Array of SnapshotListItem
  const current = useCurrentSnapshot();      // ConversationSnapshot | null
  const loading = useSnapshotsLoading();     // boolean
  const error = useSnapshotsError();         // string | null
}
```

## Integration Steps

1. **Store Integration** ✅
   - Snapshots store created
   - Integrated into main Store
   - Selectors created

2. **Component Creation** (Waiting for Dragonite)
   - SaveSnapshotModal.tsx
   - SnapshotManager.tsx
   - SnapshotViewer.tsx
   - Star button in terminal header

3. **Component Wiring** (Waiting for component creation)
   - Connect components to store
   - Wire up all actions
   - Test state transitions

4. **API Integration** (Waiting for Ditto)
   - Backend API endpoints ready
   - File tracking service
   - Persistence layer

## Testing Checklist

### Unit Tests
- [ ] Store actions (create, fetch, delete, restore, load)
- [ ] Hooks (useSnapshots, useCreateSnapshot, etc.)
- [ ] Selectors (useSnapshots, useCurrentSnapshot, etc.)
- [ ] Error handling and edge cases

### Integration Tests
- [ ] Star button → Modal appears
- [ ] Modal → Snapshot created
- [ ] Snapshot list displays correctly
- [ ] Click snapshot → Viewer loads
- [ ] File restoration works
- [ ] Delete with confirmation works

### E2E Tests
- [ ] Full workflow: Create → List → View → Restore → Delete
- [ ] Persist across page reload
- [ ] Error handling (API failures)
- [ ] Multiple concurrent operations
- [ ] Large conversations and files

## Dependencies

### Waiting for Ditto (Backend)
- [ ] POST /api/snapshots - Create
- [ ] GET /api/snapshots - List
- [ ] GET /api/snapshots/:id - Get details
- [ ] DELETE /api/snapshots/:id - Delete
- [ ] POST /api/snapshots/:id/restore - Restore files
- [ ] File tracking service
- [ ] Persistence layer

### Waiting for Dragonite (UI Components)
- [ ] SaveSnapshotModal component
- [ ] SnapshotManager component
- [ ] SnapshotViewer component
- [ ] Star button in terminal header
- [ ] Navigation integration

## Type Safety

All types are properly typed:

```tsx
import type {
  ConversationSnapshot,
  SnapshotListItem,
  SnapshotFile,
  SnapshotActions,
  SnapshotStoreState
} from '@/packages/client/store/snapshots';

import type {
  UseSnapshotsResult,
  UseCreateSnapshotResult,
  UseListSnapshotsResult,
  UseLoadSnapshotResult,
  UseDeleteSnapshotResult,
  UseRestoreFilesResult
} from '@/packages/client/hooks/useSnapshots';
```

## Notes

- The store uses optimistic updates where possible
- Error handling is comprehensive with clear error messages
- Loading states prevent multiple concurrent operations
- All async operations properly handle cleanup
- Selectors use memoization to prevent unnecessary re-renders

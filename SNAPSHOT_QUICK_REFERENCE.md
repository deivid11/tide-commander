# Snapshot Feature - Quick Reference Card

## Store Integration

### Access Store
```tsx
import { useStore } from '@/packages/client/store';
const store = useStore();
```

### State Access
```tsx
// Get all snapshots
const snapshots = useStore(state => Array.from(state.snapshots.values()));

// Get current snapshot
const current = useStore(state => state.currentSnapshot);

// Get loading/error
const loading = useStore(state => state.snapshotsLoading);
const error = useStore(state => state.snapshotsError);
```

### Use Selectors (Recommended)
```tsx
import {
  useSnapshots,
  useCurrentSnapshot,
  useSnapshotsLoading,
  useSnapshotsError
} from '@/packages/client/store';

const snapshots = useSnapshots();        // SnapshotListItem[]
const current = useCurrentSnapshot();    // ConversationSnapshot | null
const loading = useSnapshotsLoading();   // boolean
const error = useSnapshotsError();       // string | null
```

## Hooks Usage

### List Snapshots
```tsx
import { useListSnapshots } from '@/packages/client/hooks/useSnapshots';

const { snapshots, loading, error, refetch } = useListSnapshots(store);

useEffect(() => { refetch(); }, []);
```

### Create Snapshot
```tsx
import { useCreateSnapshot } from '@/packages/client/hooks/useSnapshots';

const { create, loading, error, success } = useCreateSnapshot(store);

const handleCreate = async () => {
  const snapshot = await create(agentId, agentName, title, description);
  if (snapshot) { /* success */ }
};
```

### Load Snapshot
```tsx
import { useLoadSnapshot } from '@/packages/client/hooks/useSnapshots';

const { snapshot, loading, error, load } = useLoadSnapshot(store);

const handleLoad = async (id) => {
  await load(id);
};
```

### Delete Snapshot
```tsx
import { useDeleteSnapshot } from '@/packages/client/hooks/useSnapshots';

const { delete: deleteSnapshot, loading, error } = useDeleteSnapshot(store);

const handleDelete = async (id) => {
  await deleteSnapshot(id);
};
```

### Restore Files
```tsx
import { useRestoreFiles } from '@/packages/client/hooks/useSnapshots';

const { restore, loading, error } = useRestoreFiles(store);

const handleRestore = async (id, files) => {
  await restore(id, files);
};
```

### Combined Hook
```tsx
import { useSnapshots } from '@/packages/client/hooks/useSnapshots';

const snaps = useSnapshots(store);

// snaps.list.refetch()
// snaps.create.create(...)
// snaps.load.load(...)
// snaps.delete.delete(...)
// snaps.restore.restore(...)
```

## Direct Store Actions

```tsx
const store = useStore();

// Fetch list
await store.fetchSnapshots();

// Create snapshot
const snapshot = await store.createSnapshot(
  agentId,
  agentName,
  title,
  description,
  outputs,
  files
);

// Load snapshot
await store.loadSnapshot(snapshotId);

// Delete snapshot
await store.deleteSnapshot(snapshotId);

// Restore files
await store.restoreFiles(snapshotId, filePaths);

// Set loading
store.setLoading(true/false);

// Set error
store.setError('Error message');
store.clearError();

// Reset all
store.reset();
```

## Type Definitions

```tsx
import type {
  ConversationSnapshot,
  SnapshotListItem,
  SnapshotFile,
  SnapshotActions,
  SnapshotStoreState
} from '@/packages/client/store/snapshots';

// ConversationSnapshot
interface ConversationSnapshot {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  description?: string;
  outputs: Array<{
    text: string;
    isStreaming: boolean;
    timestamp: number;
    isUserPrompt?: boolean;
  }>;
  files: SnapshotFile[];
  createdAt: number;
  metadata?: Record<string, unknown>;
}

// SnapshotListItem
interface SnapshotListItem {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  description?: string;
  createdAt: number;
  fileCount: number;
}

// SnapshotFile
interface SnapshotFile {
  path: string;
  content: string;
  type: 'created' | 'modified';
  size?: number;
  mimeType?: string;
}
```

## Component Integration Pattern

```tsx
export function MySnapshotComponent() {
  const store = useStore();
  const { list, create, load, delete: deleteSnapshot, restore } =
    useSnapshots(store);

  useEffect(() => {
    list.refetch();
  }, [list]);

  return (
    <div>
      {list.loading && <p>Loading...</p>}
      {list.error && <p className="error">{list.error}</p>}

      {list.snapshots.map(snap => (
        <div key={snap.id}>
          <h3>{snap.title}</h3>
          <button onClick={() => load.load(snap.id)}>View</button>
          <button onClick={() => deleteSnapshot.delete(snap.id)}>Delete</button>
        </div>
      ))}
    </div>
  );
}
```

## Error Handling

```tsx
try {
  const snapshot = await store.createSnapshot(...);
  if (snapshot) {
    // Success
  }
} catch (error) {
  console.error('Failed to create snapshot:', error);
  // Error is also in store.snapshotsError
}
```

## Loading States

```tsx
// During operations, these are true:
// - fetchSnapshots()
// - createSnapshot()
// - loadSnapshot()
// - deleteSnapshot()
// - restoreFiles()

if (useSnapshotsLoading()) {
  return <LoadingSpinner />;
}
```

## Async Patterns

```tsx
// Create and fetch
const snapshot = await store.createSnapshot(...);
await store.fetchSnapshots(); // Update list

// Load and view
await store.loadSnapshot(id);
const current = useStore(state => state.currentSnapshot);

// Delete and refresh
await store.deleteSnapshot(id);
await store.fetchSnapshots(); // Update list

// Restore files
await store.restoreFiles(id, selectedFiles);
```

## Performance Tips

1. **Use selectors instead of direct state access**
   - `useSnapshots()` instead of `state.snapshots`

2. **Memoize callbacks**
   ```tsx
   const handleCreate = useCallback(async () => {
     await store.createSnapshot(...);
   }, []);
   ```

3. **Use React.memo for list items**
   ```tsx
   const SnapshotItem = React.memo(({ snapshot, onLoad, onDelete }) => {
     return <div>...</div>;
   });
   ```

4. **Debounce search/filter**
   ```tsx
   const [search, setSearch] = useState('');
   const debouncedSearch = useMemo(
     () => debounce(setSearch, 300),
     []
   );
   ```

## Testing

```tsx
import { describe, it, expect, vi } from 'vitest';
import { createSnapshotActions } from '@/packages/client/store/snapshots';

describe('Snapshots', () => {
  it('should create snapshot', () => {
    // See src/packages/client/store/__tests__/snapshots.test.ts
  });
});
```

## Debugging

```tsx
// Log current state
console.log(useStore.getState());

// Log snapshots
console.log(Array.from(useStore.getState().snapshots.values()));

// Log current snapshot
console.log(useStore.getState().currentSnapshot);

// Monitor store changes
useStore.subscribe(state => {
  console.log('State updated:', state);
});
```

## Common Patterns

### Refresh on Mount
```tsx
useEffect(() => {
  store.fetchSnapshots();
}, [store]);
```

### Confirmation Dialog
```tsx
const handleDelete = async (id) => {
  if (!confirm('Delete this snapshot?')) return;
  await store.deleteSnapshot(id);
  await store.fetchSnapshots();
};
```

### Show Success Message
```tsx
const { create, success } = useCreateSnapshot(store);
useEffect(() => {
  if (success) {
    showNotification('Snapshot created');
  }
}, [success]);
```

### Error Boundary
```tsx
const error = useSnapshotsError();
if (error) {
  return (
    <div className="error-banner">
      <p>{error}</p>
      <button onClick={() => store.clearError()}>Dismiss</button>
    </div>
  );
}
```

## Related Files

- Store: `src/packages/client/store/snapshots.ts`
- Hooks: `src/packages/client/hooks/useSnapshots.ts`
- Types: `src/packages/shared/types/snapshot.ts` (from Ditto)
- Integration Guide: `SNAPSHOT_INTEGRATION_GUIDE.md`
- Tests: `src/packages/client/store/__tests__/snapshots.test.ts`

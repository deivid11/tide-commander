/**
 * Tiny insertion-ordered LRU with a size budget — for memoizing rendered
 * HTML keyed by a content hash. `Map` keeps insertion order, so refreshing an
 * entry is delete + set, and eviction pops from the front.
 */
export class LruCache<V> {
  private readonly map = new Map<string, { value: V; size: number }>();
  private total = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxTotal: number,
    private readonly sizeOf: (value: V) => number,
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    // Refresh recency.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V): V {
    const size = this.sizeOf(value);
    if (size > this.maxTotal) return value; // never cache something bigger than the whole budget
    const prev = this.map.get(key);
    if (prev) {
      this.total -= prev.size;
      this.map.delete(key);
    }
    this.map.set(key, { value, size });
    this.total += size;
    while (this.map.size > this.maxEntries || this.total > this.maxTotal) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      const entry = this.map.get(oldest.value);
      this.map.delete(oldest.value);
      if (entry) this.total -= entry.size;
    }
    return value;
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
    this.total = 0;
  }
}

/**
 * Fast content key for strings: length + two independent 32-bit FNV-1a
 * hashes (different seeds). ~1 ms per 512 KB — far cheaper than the render
 * it guards, and collisions are astronomically unlikely for a UI memo.
 */
export function contentKey(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x27d4eb2f) + (i & 0xff);
  }
  return `${text.length}:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`;
}

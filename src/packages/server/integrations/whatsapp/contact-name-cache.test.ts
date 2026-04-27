import { describe, it, expect, vi } from 'vitest';
import { ContactNameCache, type ContactLite } from './contact-name-cache.js';

describe('ContactNameCache', () => {
  it('returns the contact name from a fresh upstream fetch and caches it', async () => {
    const fetchContacts = vi.fn(async (_sessionId: string): Promise<ContactLite[]> => [
      { id: '5215512345678@s.whatsapp.net', name: 'Juan Perez', pushname: 'Juan' },
      { id: '5215587654321@s.whatsapp.net', name: null, pushname: 'Ana' },
    ]);
    const cache = new ContactNameCache({ fetchContacts });

    expect(await cache.lookup('main', '5215512345678@s.whatsapp.net')).toBe('Juan Perez');
    expect(await cache.lookup('main', '5215587654321@s.whatsapp.net')).toBe('Ana');
    // Fetch happens once for the session, regardless of how many JIDs we look up.
    expect(fetchContacts).toHaveBeenCalledTimes(1);

    // Subsequent reads of the same key are pure cache hits — no extra fetches.
    expect(await cache.lookup('main', '5215512345678@s.whatsapp.net')).toBe('Juan Perez');
    expect(fetchContacts).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent misses into a single upstream fetch', async () => {
    let resolveFetch: (val: ContactLite[]) => void = () => {};
    const fetchContacts = vi.fn(
      () =>
        new Promise<ContactLite[]>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const cache = new ContactNameCache({ fetchContacts });

    const a = cache.lookup('main', '521@s.whatsapp.net');
    const b = cache.lookup('main', '522@s.whatsapp.net');
    const c = cache.lookup('main', '523@s.whatsapp.net');
    expect(fetchContacts).toHaveBeenCalledTimes(1);

    resolveFetch([
      { id: '521@s.whatsapp.net', name: 'A', pushname: null },
      { id: '522@s.whatsapp.net', name: null, pushname: 'B' },
      // 523 not in the response → negative-cached as null.
    ]);

    expect(await a).toBe('A');
    expect(await b).toBe('B');
    expect(await c).toBeNull();
    expect(fetchContacts).toHaveBeenCalledTimes(1);
  });

  it('refetches after the TTL window expires', async () => {
    let now = 0;
    const fetchContacts = vi
      .fn<(sid: string) => Promise<ContactLite[]>>()
      .mockResolvedValueOnce([{ id: 'jid@s.whatsapp.net', name: 'Old', pushname: null }])
      .mockResolvedValueOnce([{ id: 'jid@s.whatsapp.net', name: 'New', pushname: null }]);
    const cache = new ContactNameCache({
      ttlMs: 1000,
      now: () => now,
      fetchContacts,
    });

    expect(await cache.lookup('main', 'jid@s.whatsapp.net')).toBe('Old');
    now = 500;
    expect(await cache.lookup('main', 'jid@s.whatsapp.net')).toBe('Old'); // still fresh
    expect(fetchContacts).toHaveBeenCalledTimes(1);

    now = 2000; // past TTL
    expect(await cache.lookup('main', 'jid@s.whatsapp.net')).toBe('New');
    expect(fetchContacts).toHaveBeenCalledTimes(2);
  });

  it('returns null when fetcher throws — never propagates the error', async () => {
    const fetchContacts = vi.fn(async () => {
      throw new Error('upstream down');
    });
    const cache = new ContactNameCache({ fetchContacts });
    expect(await cache.lookup('main', 'jid@s.whatsapp.net')).toBeNull();
  });

  it('isolates by sessionId — same JID in two sessions stays separate', async () => {
    const fetchContacts = vi.fn(async (sessionId: string): Promise<ContactLite[]> => {
      if (sessionId === 'work') return [{ id: '521@s.whatsapp.net', name: 'WorkContact', pushname: null }];
      return [{ id: '521@s.whatsapp.net', name: 'PersonalContact', pushname: null }];
    });
    const cache = new ContactNameCache({ fetchContacts });

    expect(await cache.lookup('work', '521@s.whatsapp.net')).toBe('WorkContact');
    expect(await cache.lookup('personal', '521@s.whatsapp.net')).toBe('PersonalContact');
    expect(fetchContacts).toHaveBeenCalledTimes(2);
  });

  it('clear() empties cache and inflight tracking', async () => {
    const fetchContacts = vi.fn(async () => [{ id: 'jid@s.whatsapp.net', name: 'X', pushname: null }]);
    const cache = new ContactNameCache({ fetchContacts });
    await cache.lookup('main', 'jid@s.whatsapp.net');
    expect(cache.size()).toBe(1);
    cache.clear();
    expect(cache.size()).toBe(0);
    await cache.lookup('main', 'jid@s.whatsapp.net');
    expect(fetchContacts).toHaveBeenCalledTimes(2); // refetched after clear
  });
});

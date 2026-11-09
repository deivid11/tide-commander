import { describe, expect, it } from 'vitest';
import { DEFAULT_SHORTCUTS, isRetiredDefaultBinding } from './shortcuts';

describe('Tab: working-agent cycle instead of Commander View', () => {
  const byId = (id: string) => DEFAULT_SHORTCUTS.find((s) => s.id === id);

  it('binds Tab / Shift+Tab to cycling working agents and leaves Commander unbound', () => {
    expect(byId('cycle-working-next')).toMatchObject({ key: 'Tab', modifiers: {} });
    expect(byId('cycle-working-prev')).toMatchObject({ key: 'Tab', modifiers: { shift: true } });
    expect(byId('toggle-commander-tab')?.key).toBe('');
    expect(byId('toggle-commander')?.key).toBe('');
  });

  it('drops a saved copy of the old Commander Tab default, but keeps a real rebinding', () => {
    const base = byId('toggle-commander-tab')!;
    expect(isRetiredDefaultBinding({ ...base, key: 'Tab', modifiers: {} })).toBe(true);
    expect(isRetiredDefaultBinding({ ...base, key: 'Tab', modifiers: { ctrl: true } })).toBe(false);
    expect(isRetiredDefaultBinding({ ...base, key: 'c', modifiers: {} })).toBe(false);
    expect(isRetiredDefaultBinding({ ...byId('cycle-working-next')!, key: 'Tab', modifiers: {} })).toBe(false);
  });
});

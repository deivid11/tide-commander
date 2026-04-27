import { describe, it, expect } from 'vitest';
import { sanitizeFromName } from './whatsapp-trigger-handler.js';

describe('sanitizeFromName', () => {
  it('returns undefined for empty / null inputs', () => {
    expect(sanitizeFromName(undefined, '521@s.whatsapp.net')).toBeUndefined();
    expect(sanitizeFromName(null, '521@s.whatsapp.net')).toBeUndefined();
    expect(sanitizeFromName('', '521@s.whatsapp.net')).toBeUndefined();
    expect(sanitizeFromName('   ', '521@s.whatsapp.net')).toBeUndefined();
  });

  it('passes a clean human name through verbatim', () => {
    expect(sanitizeFromName('Juan Perez', '5215512345678@s.whatsapp.net')).toBe('Juan Perez');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeFromName('  Juan Perez  ', '5215512345678@s.whatsapp.net')).toBe('Juan Perez');
  });

  it('strips a JID domain that leaked into the name field', () => {
    expect(
      sanitizeFromName('5215512345678@s.whatsapp.net', '5215512345678@s.whatsapp.net'),
    ).toBeUndefined(); // bare digits matching from-jid → undefined
    expect(
      sanitizeFromName('Juan Perez@s.whatsapp.net', '5215512345678@s.whatsapp.net'),
    ).toBe('Juan Perez');
  });

  it('returns undefined when name is just the phone digits matching the from JID', () => {
    expect(sanitizeFromName('5215512345678', '5215512345678@s.whatsapp.net')).toBeUndefined();
  });

  it('keeps a name even if it CONTAINS the phone digits, as long as it has letters', () => {
    expect(sanitizeFromName('Juan 5215512345678', '5215512345678@s.whatsapp.net')).toBe(
      'Juan 5215512345678',
    );
  });

  it('keeps a digit-only name when it does NOT match the from JID', () => {
    // Edge case: a contact saved as "12345" while the message is from a totally
    // different number. We keep it — user explicitly chose that label.
    expect(sanitizeFromName('12345', '5215512345678@s.whatsapp.net')).toBe('12345');
  });

  it('handles group-participant JID without breaking', () => {
    expect(sanitizeFromName('Carlos', '5215587654321@s.whatsapp.net')).toBe('Carlos');
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILE_SEARCH_EXCLUDE_DIRS,
  isValidExcludeDirName,
  parseExcludeDirNames,
} from './file-search';

describe('file-search helpers', () => {
  it('includes node_modules, vendor and .git in the default exclude list', () => {
    expect(DEFAULT_FILE_SEARCH_EXCLUDE_DIRS).toContain('node_modules');
    expect(DEFAULT_FILE_SEARCH_EXCLUDE_DIRS).toContain('vendor');
    expect(DEFAULT_FILE_SEARCH_EXCLUDE_DIRS).toContain('.git');
  });

  it('accepts basename folder names and rejects path-like values', () => {
    expect(isValidExcludeDirName('node_modules')).toBe(true);
    expect(isValidExcludeDirName('.git')).toBe(true);
    expect(isValidExcludeDirName('  vendor  ')).toBe(true);
    expect(isValidExcludeDirName('')).toBe(false);
    expect(isValidExcludeDirName('foo/bar')).toBe(false);
    expect(isValidExcludeDirName('foo\\bar')).toBe(false);
    expect(isValidExcludeDirName('..')).toBe(false);
  });

  it('parses a comma-separated list and drops invalid names', () => {
    expect(parseExcludeDirNames('node_modules, vendor, ../etc, .git')).toEqual([
      'node_modules',
      'vendor',
      '.git',
    ]);
  });

  it('parses a string array and de-duplicates', () => {
    expect(parseExcludeDirNames(['dist', 'dist', 'build'])).toEqual(['dist', 'build']);
  });
});

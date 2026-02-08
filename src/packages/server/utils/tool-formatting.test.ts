import { describe, expect, it } from 'vitest';
import {
  formatToolActivity,
  formatToolNarrative,
  getFileName,
  getShortPath,
  getToolKeyParam,
} from './tool-formatting.js';

describe('tool-formatting', () => {
  it('returns sensible filename fallbacks', () => {
    expect(getFileName(undefined)).toBe('unknown');
    expect(getFileName('/tmp/project/src/index.ts')).toBe('index.ts');
  });

  it('shortens long paths while preserving short ones', () => {
    expect(getShortPath('/tmp/app/a.ts', 40)).toBe('/tmp/app/a.ts');
    expect(getShortPath('/very/long/path/to/project/src/file.ts', 10)).toBe('.../src/file.ts');
  });

  it('extracts key params for common tools', () => {
    expect(getToolKeyParam('Write', { file_path: '/tmp/project/src/main.ts' })).toBe('/tmp/project/src/main.ts');
    expect(getToolKeyParam('TodoWrite', { todos: [{ id: '1' }, { id: '2' }] })).toBe('2 items');
    expect(getToolKeyParam('AskUserQuestion', {})).toBe('clarification');
  });

  it('formats concise activity labels', () => {
    expect(formatToolActivity('Read', { file_path: '/tmp/project/src/main.ts' })).toBe('Read: /tmp/project/src/main.ts');
    expect(formatToolActivity('Bash', { command: 'echo hello' })).toBe('Bash: echo hello');
    expect(formatToolActivity(undefined, undefined)).toBe('Using unknown tool');
  });

  it('formats narrative strings per tool', () => {
    expect(formatToolNarrative('Read', { file_path: '/tmp/project/src/main.ts' })).toContain('Reading file "main.ts"');
    expect(formatToolNarrative('Task', { description: 'Investigate flaky tests and report root cause in detail' })).toContain('Starting sub-task');
    expect(formatToolNarrative('UnknownTool', {})).toBe('Using UnknownTool tool');
  });
});

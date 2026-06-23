/**
 * Tests for contentRendering — file mention block extraction
 *
 * Covers: extractFileMentionBlocks (strips server-injected <file>/<folder>
 * context blocks, returns cleaned display text + chip list)
 */

import { describe, it, expect } from 'vitest';
import { extractFileMentionBlocks } from '../../../utils/fileMentions';

describe('extractFileMentionBlocks', () => {
  describe('when content has no file/folder blocks', () => {
    it('returns content unchanged and empty chips', () => {
      const { displayContent, chips } = extractFileMentionBlocks('what does this file do?');
      expect(displayContent).toBe('what does this file do?');
      expect(chips).toHaveLength(0);
    });

    it('leaves [File: path] markers untouched (those are handled separately)', () => {
      const input = 'see [File: /tmp/foo.pdf]';
      const { displayContent, chips } = extractFileMentionBlocks(input);
      expect(displayContent).toBe(input);
      expect(chips).toHaveLength(0);
    });
  });

  describe('single <file> block', () => {
    it('strips block content and returns chip for a file', () => {
      const input = '<file path="src/server/routes/agents.ts">\nconst x = 1;\n</file>\n\nexplica el código';
      const { displayContent, chips } = extractFileMentionBlocks(input);
      expect(displayContent).toBe('explica el código');
      expect(chips).toHaveLength(1);
      expect(chips[0]).toEqual({ path: 'src/server/routes/agents.ts', type: 'file' });
    });

    it('does not include the file content in displayContent', () => {
      const secret = 'const SECRET_API_KEY = "abc123";';
      const input = `<file path="config.ts">\n${secret}\n</file>\n\nreview this`;
      const { displayContent } = extractFileMentionBlocks(input);
      expect(displayContent).not.toContain(secret);
      expect(displayContent).toBe('review this');
    });

    it('trims leading and trailing whitespace from displayContent', () => {
      const input = '<file path="README.md">\ncontent\n</file>\n\n\n\n  message  ';
      const { displayContent } = extractFileMentionBlocks(input);
      expect(displayContent).toBe('message');
    });
  });

  describe('single <folder> block', () => {
    it('strips block and returns chip with type dir', () => {
      const input = '<folder path="src/packages/server">\n  [file] routes.ts\n  [dir]  services/\n</folder>\n\nexplora la carpeta';
      const { displayContent, chips } = extractFileMentionBlocks(input);
      expect(displayContent).toBe('explora la carpeta');
      expect(chips).toHaveLength(1);
      expect(chips[0]).toEqual({ path: 'src/packages/server', type: 'dir' });
    });
  });

  describe('multiple blocks', () => {
    it('extracts all file blocks and preserves user text', () => {
      const input = [
        '<file path="a.ts">\ncontent a\n</file>',
        '<file path="b.ts">\ncontent b\n</file>',
        '',
        'compara ambos archivos',
      ].join('\n');

      const { displayContent, chips } = extractFileMentionBlocks(input);
      expect(displayContent).toBe('compara ambos archivos');
      expect(chips).toHaveLength(2);
      expect(chips[0]).toEqual({ path: 'a.ts', type: 'file' });
      expect(chips[1]).toEqual({ path: 'b.ts', type: 'file' });
    });

    it('handles mixed file and folder blocks', () => {
      const input = [
        '<file path="index.ts">\nexport * from "./routes";\n</file>',
        '<folder path="src/routes">\n  [file] agents.ts\n</folder>',
        '',
        'dame contexto',
      ].join('\n');

      const { displayContent, chips } = extractFileMentionBlocks(input);
      expect(displayContent).toBe('dame contexto');
      expect(chips).toHaveLength(2);
      expect(chips.find(c => c.type === 'file')).toEqual({ path: 'index.ts', type: 'file' });
      expect(chips.find(c => c.type === 'dir')).toEqual({ path: 'src/routes', type: 'dir' });
    });
  });

  describe('edge cases', () => {
    it('handles message with only a file block (no user text)', () => {
      const input = '<file path="solo.ts">\ncontent\n</file>';
      const { displayContent, chips } = extractFileMentionBlocks(input);
      expect(displayContent).toBe('');
      expect(chips).toHaveLength(1);
    });

    it('collapses excess blank lines left after block removal', () => {
      const input = '<file path="x.ts">\ncontent\n</file>\n\n\n\nhola';
      const { displayContent } = extractFileMentionBlocks(input);
      // Should not have more than two consecutive newlines
      expect(displayContent).not.toMatch(/\n{3,}/);
      expect(displayContent).toContain('hola');
    });

    it('handles multiline file content without corrupting remaining text', () => {
      const bigContent = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
      const input = `<file path="big.ts">\n${bigContent}\n</file>\n\nque hace?`;
      const { displayContent, chips } = extractFileMentionBlocks(input);
      expect(displayContent).toBe('que hace?');
      expect(chips[0].path).toBe('big.ts');
    });
  });

  describe('agent mentions (<agentes_contexto>)', () => {
    it('strips the agent context block and returns an agent chip', () => {
      const input = [
        '<agentes_contexto>',
        '  <agente id="cy3c3i3x" nombre="Scout One" clase="scout" jefe="false" estado="working" cwd="/w"/>',
        '</agentes_contexto>',
        '',
        '<instrucciones_internas>',
        'Agentes mencionados: usa el id...',
        '</instrucciones_internas>',
        '',
        'Petición: coordínate con él',
      ].join('\n');
      const { displayContent, chips } = extractFileMentionBlocks(input);
      expect(displayContent).toBe('coordínate con él');
      expect(chips).toContainEqual({ path: 'Scout One', type: 'agent' });
    });

    it('collects multiple agent chips and dedups repeats', () => {
      const input = [
        '<agentes_contexto>',
        '  <agente id="a1" nombre="Alpha" clase="scout" jefe="false" estado="idle" cwd="/w"/>',
        '  <agente id="a2" nombre="Beta" clase="boss" jefe="true" estado="idle" cwd="/w"/>',
        '  <agente id="a1" nombre="Alpha" clase="scout" jefe="false" estado="idle" cwd="/w"/>',
        '</agentes_contexto>',
        '',
        'Petición: junta a los tres',
      ].join('\n');
      const { displayContent, chips } = extractFileMentionBlocks(input);
      expect(displayContent).toBe('junta a los tres');
      const agentChips = chips.filter((c) => c.type === 'agent');
      expect(agentChips).toEqual([
        { path: 'Alpha', type: 'agent' },
        { path: 'Beta', type: 'agent' },
      ]);
    });

    it('strips both file and agent context blocks together', () => {
      const input = [
        '<archivos_contexto>',
        '  <archivo ruta="a.ts"><![CDATA[\ncontent\n]]></archivo>',
        '</archivos_contexto>',
        '',
        '<agentes_contexto>',
        '  <agente id="a1" nombre="Helper" clase="scout" jefe="false" estado="idle" cwd="/w"/>',
        '</agentes_contexto>',
        '',
        'Petición: haz ambos',
      ].join('\n');
      const { displayContent, chips } = extractFileMentionBlocks(input);
      expect(displayContent).toBe('haz ambos');
      expect(chips).toContainEqual({ path: 'a.ts', type: 'file' });
      expect(chips).toContainEqual({ path: 'Helper', type: 'agent' });
    });

    it('decodes XML entities in the agent name (round-trips server attr escaping)', () => {
      // The server escapes names via attr(): " -> &quot;, < -> &lt;, & -> &amp;
      const input = [
        '<agentes_contexto>',
        '  <agente id="a1" nombre="A &lt;b&gt; &amp; &quot;c&quot;" clase="x&amp;y" jefe="false" estado="idle" cwd="/w"/>',
        '</agentes_contexto>',
        '',
        'Petición: hola',
      ].join('\n');
      const { displayContent, chips } = extractFileMentionBlocks(input);
      expect(displayContent).toBe('hola');
      expect(chips).toContainEqual({ path: 'A <b> & "c"', type: 'agent' });
    });

    it('captures the agent name even when nombre is not the first attribute', () => {
      const input = [
        '<agentes_contexto>',
        '  <agente jefe="true" clase="boss" nombre="Late Name" id="a1" estado="idle" cwd="/w"/>',
        '</agentes_contexto>',
        '',
        'Petición: revisa',
      ].join('\n');
      const { chips } = extractFileMentionBlocks(input);
      expect(chips).toContainEqual({ path: 'Late Name', type: 'agent' });
    });

    it('leaves content untouched when there is no agent context block', () => {
      const input = 'just a plain message with no mentions';
      const { displayContent, chips } = extractFileMentionBlocks(input);
      expect(displayContent).toBe('just a plain message with no mentions');
      expect(chips.filter((c) => c.type === 'agent')).toHaveLength(0);
    });
  });
});

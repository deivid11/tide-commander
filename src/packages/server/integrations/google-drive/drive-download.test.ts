/**
 * Byte fidelity for Drive reads.
 *
 * Regression cover for the original bug: `getFileContent` asked googleapis for
 * `responseType: 'text'`, so every byte went through a UTF-8 decode before being
 * stuffed into a JSON string. Binaries (zips, PDFs, installers) came back peppered
 * with U+FFFD replacement characters, and anything past Node's max string length threw
 * `Cannot create a string longer than ...` — a 523 MB zip in a Shared Drive was simply
 * undownloadable. `downloadFile` streams to disk instead and never builds a string.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';

const filesGet = vi.fn();
const filesExport = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {}
        generateAuthUrl() { return 'https://example.test/auth'; }
        async getToken() { return { tokens: {} }; }
        getAccessToken() { return { token: 'ya29.access' }; }
        request(opts: unknown) { return Promise.resolve({ data: opts }); }
      },
    },
    drive: () => ({
      files: {
        get: (params: unknown, opts?: unknown) => filesGet(params, opts),
        export: (params: unknown, opts?: unknown) => filesExport(params, opts),
      },
    }),
    docs: () => ({}),
  },
}));

vi.mock('./drive-config.js', () => ({
  loadConfig: () => ({ enabled: true, defaultFolderId: '' }),
  updateConfig: vi.fn(),
  driveConfigSchema: [],
  getConfigValues: () => ({}),
  setConfigValues: vi.fn(),
}));

const driveClient = await import('./drive-client.js');

const ctx = {
  secrets: {
    get: (k: string) =>
      ({
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 'secret',
        GOOGLE_REFRESH_TOKEN: 'refresh',
      })[k],
    set: vi.fn(),
  },
  serverConfig: { port: 5174, host: 'localhost', baseUrl: 'http://localhost:5174' },
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
} as never;

/** A byte sequence no UTF-8 decoder can round-trip: PK zip header + 0x00 + invalid continuation bytes. */
const ZIP_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe, 0x80, 0x81, 0x0a, 0xc3]);

/** Wire up metadata + media for one fake Drive file. */
function stubFile(meta: Record<string, unknown>, media: Buffer) {
  filesGet.mockImplementation((params: { fields?: string; alt?: string }) => {
    if (params.alt === 'media') {
      return Promise.resolve({ data: media });
    }
    return Promise.resolve({ data: meta });
  });
}

let tmpDir: string;

beforeEach(async () => {
  filesGet.mockReset();
  filesExport.mockReset();
  await driveClient.init(ctx);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-download-test-'));
});

describe('getFileContent', () => {
  it('THE BUG: returns binary content intact as base64 instead of UTF-8 mojibake', async () => {
    stubFile(
      { name: 'Componentes.zip', mimeType: 'application/zip', size: String(ZIP_BYTES.length) },
      ZIP_BYTES,
    );

    const result = await driveClient.getFileContent('file-1');

    expect(result.encoding).toBe('base64');
    expect(result.bytes).toBe(ZIP_BYTES.length);
    // The whole point: the bytes survive the round-trip byte-for-byte.
    expect(Buffer.from(result.content, 'base64').equals(ZIP_BYTES)).toBe(true);
    expect(result.content).not.toContain('�');
  });

  it('still returns plain text as UTF-8', async () => {
    const text = Buffer.from('hola: mañana — ok\n', 'utf-8');
    stubFile({ name: 'notas.txt', mimeType: 'text/plain', size: String(text.length) }, text);

    const result = await driveClient.getFileContent('file-2');

    expect(result.encoding).toBe('utf-8');
    expect(result.content).toBe('hola: mañana — ok\n');
  });

  it('treats octet-stream text as text and octet-stream binary as base64', async () => {
    const text = Buffer.from('plain enough', 'utf-8');
    stubFile({ name: 'unlabeled', mimeType: 'application/octet-stream', size: String(text.length) }, text);
    await expect(driveClient.getFileContent('file-3')).resolves.toMatchObject({ encoding: 'utf-8' });

    stubFile({ name: 'unlabeled.bin', mimeType: 'application/octet-stream', size: String(ZIP_BYTES.length) }, ZIP_BYTES);
    await expect(driveClient.getFileContent('file-4')).resolves.toMatchObject({ encoding: 'base64' });
  });

  it('refuses oversized files up front and points at the download endpoint', async () => {
    // 523 MB — the real file that could not be fetched. Nothing is transferred: the
    // size check fires on metadata alone, before any bytes move.
    stubFile({ name: 'Componentes.zip', mimeType: 'application/zip', size: String(523 * 1024 * 1024) }, Buffer.alloc(0));

    await expect(driveClient.getFileContent('file-5')).rejects.toThrow(/download\?destPath/);
    expect(filesGet).not.toHaveBeenCalledWith(expect.objectContaining({ alt: 'media' }), expect.anything());
  });

  it('exports Google Docs as text', async () => {
    filesGet.mockResolvedValue({ data: { name: 'Manual', mimeType: 'application/vnd.google-apps.document' } });
    filesExport.mockResolvedValue({ data: Buffer.from('exported body', 'utf-8') });

    const result = await driveClient.getFileContent('doc-1');

    expect(filesExport).toHaveBeenCalledWith(
      { fileId: 'doc-1', mimeType: 'text/plain' },
      { responseType: 'arraybuffer' },
    );
    expect(result).toMatchObject({ content: 'exported body', encoding: 'utf-8', mimeType: 'text/plain' });
  });
});

describe('downloadFile', () => {
  it('writes the exact bytes to an explicit destination path', async () => {
    filesGet.mockImplementation((params: { alt?: string }) =>
      params.alt === 'media'
        ? Promise.resolve({ data: Readable.from([ZIP_BYTES]) })
        : Promise.resolve({ data: { name: 'Componentes.zip', mimeType: 'application/zip', size: String(ZIP_BYTES.length) } }),
    );

    const dest = path.join(tmpDir, 'nested', 'out.zip');
    const result = await driveClient.downloadFile('file-6', { destPath: dest });

    expect(result.path).toBe(dest);
    expect(result.bytes).toBe(ZIP_BYTES.length);
    expect(fs.readFileSync(dest).equals(ZIP_BYTES)).toBe(true);
    // No leftover .part file from the atomic write.
    expect(fs.readdirSync(path.dirname(dest))).toEqual(['out.zip']);
  });

  it('uses the Drive file name when destPath is a directory', async () => {
    filesGet.mockImplementation((params: { alt?: string }) =>
      params.alt === 'media'
        ? Promise.resolve({ data: Readable.from([ZIP_BYTES]) })
        : Promise.resolve({ data: { name: 'Componentes.zip', mimeType: 'application/zip' } }),
    );

    const result = await driveClient.downloadFile('file-7', { destPath: tmpDir });

    expect(result.path).toBe(path.join(tmpDir, 'Componentes.zip'));
    expect(fs.existsSync(result.path)).toBe(true);
  });

  it('appends the export extension for Google Workspace files', async () => {
    filesGet.mockResolvedValue({ data: { name: 'Presupuesto', mimeType: 'application/vnd.google-apps.spreadsheet' } });
    filesExport.mockResolvedValue({ data: Readable.from([Buffer.from('a,b\n1,2\n')]) });

    const result = await driveClient.downloadFile('sheet-1', { destPath: tmpDir });

    expect(result.exported).toBe(true);
    expect(result.path).toBe(path.join(tmpDir, 'Presupuesto.csv'));
    expect(fs.readFileSync(result.path, 'utf-8')).toBe('a,b\n1,2\n');
  });

  it('leaves no truncated file behind when the transfer fails mid-stream', async () => {
    const failing = new Readable({
      read() {
        this.push(Buffer.from('partial'));
        this.destroy(new Error('connection reset'));
      },
    });
    filesGet.mockImplementation((params: { alt?: string }) =>
      params.alt === 'media'
        ? Promise.resolve({ data: failing })
        : Promise.resolve({ data: { name: 'big.zip', mimeType: 'application/zip' } }),
    );

    const dest = path.join(tmpDir, 'big.zip');
    await expect(driveClient.downloadFile('file-8', { destPath: dest })).rejects.toThrow(/connection reset/);

    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  it('refuses to clobber an existing file when overwrite is false', async () => {
    const dest = path.join(tmpDir, 'existing.zip');
    fs.writeFileSync(dest, 'keep me');
    filesGet.mockImplementation((params: { alt?: string }) =>
      params.alt === 'media'
        ? Promise.resolve({ data: Readable.from([ZIP_BYTES]) })
        : Promise.resolve({ data: { name: 'existing.zip', mimeType: 'application/zip' } }),
    );

    await expect(driveClient.downloadFile('file-9', { destPath: dest, overwrite: false }))
      .rejects.toThrow(/already exists/);
    expect(fs.readFileSync(dest, 'utf-8')).toBe('keep me');
  });
});

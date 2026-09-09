/**
 * Tests for the image generation service: key resolution order, output-path
 * containment/naming, the gpt-image vs DALL·E payload split, and the
 * write-to-disk / failure paths of generateImages.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// The service resolves DATA_DIR at module load (via data/index.js) — point it
// at a throwaway directory before importing it.
const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-images-test-'));
process.env.XDG_DATA_HOME = TEST_HOME;

vi.mock('./secrets-service.js', () => ({
  getSecretByKey: vi.fn(() => undefined),
}));

const { getSecretByKey } = await import('./secrets-service.js');
const {
  buildOutputPaths,
  buildRequestPayload,
  generateImages,
  getStatus,
  isSafeOutputDir,
  maskKey,
  resolveApiKey,
  sanitizeFilenameStem,
  slugifyPrompt,
} = await import('./image-service.js');

const mockedGetSecret = vi.mocked(getSecretByKey);

/** 1x1 transparent PNG. */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const KEY_FILE = path.join(TEST_HOME, 'openai-key');

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function errorResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

let outDir: string;

beforeEach(() => {
  mockedGetSecret.mockReturnValue(undefined);
  delete process.env.OPENAI_API_KEY;
  process.env.TIDE_OPENAI_KEY_FILE = KEY_FILE;
  fs.writeFileSync(KEY_FILE, 'sk-file-key\n');
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-images-out-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(outDir, { recursive: true, force: true });
});

describe('resolveApiKey', () => {
  it('prefers the configured secret over the environment and the key file', () => {
    mockedGetSecret.mockReturnValue({
      id: 's1', name: 'OpenAI', key: 'OPENAI_API_KEY', value: '  sk-secret-key  ',
      createdAt: 0, updatedAt: 0,
    });
    process.env.OPENAI_API_KEY = 'sk-env-key';

    expect(resolveApiKey()).toEqual({ key: 'sk-secret-key', source: 'secret' });
  });

  it('falls back to the environment when no secret is set', () => {
    process.env.OPENAI_API_KEY = 'sk-env-key';
    expect(resolveApiKey()).toEqual({ key: 'sk-env-key', source: 'env' });
  });

  it('falls back to the key file, trimming the trailing newline', () => {
    expect(resolveApiKey()).toEqual({ key: 'sk-file-key', source: 'file' });
  });

  it('reports unconfigured when nothing provides a key', () => {
    fs.rmSync(KEY_FILE);
    expect(resolveApiKey()).toEqual({ key: null, source: null });
    expect(getStatus().configured).toBe(false);
  });

  it('never exposes the raw key through the status endpoint', () => {
    const status = getStatus();
    expect(status.configured).toBe(true);
    expect(status.maskedKey).not.toContain('file-key');
    expect(maskKey('sk-proj-abcdefghijklmnop')).toBe('sk-proj-…mnop');
  });
});

describe('isSafeOutputDir', () => {
  it('accepts directories under home, cwd and tmp, including ones not created yet', () => {
    expect(isSafeOutputDir(path.join(os.homedir(), 'pictures', 'brand-new'))).toBe(true);
    expect(isSafeOutputDir(path.join(process.cwd(), 'tmp-art'))).toBe(true);
    expect(isSafeOutputDir(outDir)).toBe(true);
  });

  it('rejects paths outside the allowed roots and empty input', () => {
    expect(isSafeOutputDir('/etc/tide-art')).toBe(false);
    expect(isSafeOutputDir(path.join(os.homedir(), '..', '..', 'etc'))).toBe(false);
    expect(isSafeOutputDir('')).toBe(false);
  });
});

describe('filename derivation', () => {
  it('slugifies a prompt, dropping accents and punctuation', () => {
    expect(slugifyPrompt('A watercolor Lighthouse at dusk, muted teal.')).toBe(
      'a-watercolor-lighthouse-at-dusk-muted-teal',
    );
    expect(slugifyPrompt('Ilustración de un pingüino')).toBe('ilustracion-de-un-pinguino');
    expect(slugifyPrompt('!!!')).toBe('image');
  });

  it('strips directories, traversal and extensions from a caller filename', () => {
    expect(sanitizeFilenameStem('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilenameStem('my logo.PNG')).toBe('my-logo');
    expect(sanitizeFilenameStem('  ../.. ')).toBe('image');
  });

  it('numbers a batch and never overwrites an existing file', () => {
    expect(buildOutputPaths('/out', 'fox', 1, 'png', () => false)).toEqual(['/out/fox.png']);
    expect(buildOutputPaths('/out', 'fox', 2, 'webp', () => false)).toEqual([
      '/out/fox-1.webp',
      '/out/fox-2.webp',
    ]);
    expect(buildOutputPaths('/out', 'fox', 1, 'jpeg', (p) => p === '/out/fox.jpg')).toEqual([
      '/out/fox-2.jpg',
    ]);
  });
});

describe('buildRequestPayload', () => {
  it('sends the gpt-image vocabulary for the default model', () => {
    expect(
      buildRequestPayload({
        prompt: 'a fox', size: '1024x1536', quality: 'high', background: 'transparent',
        format: 'webp', compression: 80, n: 3,
      }),
    ).toEqual({
      model: 'gpt-image-1', prompt: 'a fox', n: 3, size: '1024x1536', quality: 'high',
      background: 'transparent', output_format: 'webp', output_compression: 80,
    });
  });

  it('maps quality and asks for base64 on DALL·E, dropping gpt-image-only fields', () => {
    const payload = buildRequestPayload({
      prompt: 'a fox', model: 'dall-e-3', quality: 'high', background: 'transparent', format: 'webp',
    });
    expect(payload).toEqual({
      model: 'dall-e-3', prompt: 'a fox', n: 1, quality: 'hd', response_format: 'b64_json',
    });
    expect(buildRequestPayload({ prompt: 'a fox', model: 'dall-e-3', quality: 'low' }).quality)
      .toBe('standard');
  });

  it('clamps n to the 1-10 range', () => {
    expect(buildRequestPayload({ prompt: 'x', n: 99 }).n).toBe(10);
    expect(buildRequestPayload({ prompt: 'x', n: 0 }).n).toBe(1);
    expect(buildRequestPayload({ prompt: 'x', n: -4 }).n).toBe(1);
  });
});

describe('generateImages', () => {
  it('writes every returned image to disk and reports the paths', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      okResponse({
        data: [{ b64_json: PNG_B64 }, { b64_json: PNG_B64 }],
        usage: { total_tokens: 120, input_tokens: 20, output_tokens: 100 },
      }),
    );

    const result = await generateImages({
      prompt: 'a tiny red circle', outputDir: path.join(outDir, 'nested'), n: 2, agentId: 'agent-1',
    });

    expect(result.ok).toBe(true);
    expect(result.images).toHaveLength(2);
    expect(result.images.map((i) => i.filename)).toEqual([
      'a-tiny-red-circle-1.png',
      'a-tiny-red-circle-2.png',
    ]);
    for (const image of result.images) {
      expect(fs.existsSync(image.path)).toBe(true);
      expect(fs.statSync(image.path).size).toBe(image.bytes);
    }
    expect(result.usage).toEqual({ totalTokens: 120, inputTokens: 20, outputTokens: 100 });
    expect(result.agentId).toBe('agent-1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-file-key');
  });

  it('downloads url-only results (DALL·E) instead of failing', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okResponse({ data: [{ url: 'https://cdn.example/img.png', revised_prompt: 'a red circle, centered' }] }))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => Buffer.from(PNG_B64, 'base64'),
      } as unknown as Response);

    const result = await generateImages({ prompt: 'a red circle', model: 'dall-e-3', outputDir: outDir });

    expect(result.ok).toBe(true);
    expect(result.revisedPrompt).toBe('a red circle, centered');
    expect(fs.existsSync(result.images[0].path)).toBe(true);
  });

  it('returns ok:false with the OpenAI message instead of throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      errorResponse(400, { error: { message: 'Your request was rejected by our safety system.' } }),
    );

    const result = await generateImages({ prompt: 'something disallowed', outputDir: outDir });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('safety system');
    expect(result.images).toEqual([]);
    expect(fs.readdirSync(outDir)).toEqual([]);
  });

  it('explains a 403 as a possible org-verification problem', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(errorResponse(403, { error: { message: 'must be verified' } }));
    const result = await generateImages({ prompt: 'a fox', outputDir: outDir });
    expect(result.error).toContain('403');
    expect(result.error).toContain('verified');
  });

  it('reports a missing API key as a result, not an exception', async () => {
    fs.rmSync(KEY_FILE);
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await generateImages({ prompt: 'a fox', outputDir: outDir });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('OPENAI_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to write outside the allowed roots, without calling the API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(generateImages({ prompt: 'a fox', outputDir: '/etc/tide-art' }))
      .rejects.toThrow(/outside the home/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an empty prompt', async () => {
    await expect(generateImages({ prompt: '   ', outputDir: outDir })).rejects.toThrow(/prompt/i);
  });

  it('surfaces an empty data array as a failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({ data: [] }));
    const result = await generateImages({ prompt: 'a fox', outputDir: outDir });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('no images');
  });
});

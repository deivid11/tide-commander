import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CadRequestError, normalizeCadJobRequest } from './cad-service.js';

const temporaryDirectories: string[] = [];

async function workspace(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-cad-test-'));
  temporaryDirectories.push(directory);
  await fs.writeFile(path.join(directory, 'model.py'), 'def build():\n    return None\n', 'utf8');
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('normalizeCadJobRequest', () => {
  it('normalizes a complete workspace-confined job', async () => {
    const root = await workspace();
    const request = await normalizeCadJobRequest({
      workspace: root,
      script: 'model.py',
      parameters: { wall: 2 },
      outputs: [
        { format: 'fcstd', path: 'generated/model.FCStd', document: 'Case' },
        { format: 'stl', path: 'generated/model.stl', objects: ['lower', 'lower'] },
      ],
      renders: [{ path: 'renders/isometric.png', view: 'isometric', width: 800, height: 600 }],
      checks: [{
        type: 'clearance',
        a: { object: 'pcb' },
        b: { document: 'Case', object: 'lid' },
        minimum: 0.5,
      }],
    });

    expect(request.workspace).toBe(await fs.realpath(root));
    expect(request.script).toBe('model.py');
    expect(request.entrypoint).toBe('build');
    expect(request.timeoutMs).toBe(300_000);
    expect(request.outputs?.[1].objects).toEqual(['lower']);
    expect(request.renders?.[0]).toMatchObject({ view: 'isometric', width: 800, height: 600 });
    expect(request.checks?.[0]).toMatchObject({ type: 'clearance', minimum: 0.5 });
  });

  it('allows load-only legacy scripts with a null entrypoint', async () => {
    const root = await workspace();
    const request = await normalizeCadJobRequest({ workspace: root, script: 'model.py', entrypoint: null });
    expect(request.entrypoint).toBeNull();
  });

  it('rejects scripts that traverse outside the workspace', async () => {
    const root = await workspace();
    await expect(normalizeCadJobRequest({ workspace: root, script: '../model.py' }))
      .rejects.toThrow(CadRequestError);
  });

  it('rejects artifact paths that escape the workspace', async () => {
    const root = await workspace();
    await expect(normalizeCadJobRequest({
      workspace: root,
      script: 'model.py',
      outputs: [{ format: 'stl', path: '../outside.stl' }],
    })).rejects.toThrow('escapes workspace');
  });

  it('rejects output directories that are symlinks to another tree', async () => {
    const root = await workspace();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-cad-outside-'));
    temporaryDirectories.push(outside);
    await fs.symlink(outside, path.join(root, 'linked-output'));

    await expect(normalizeCadJobRequest({
      workspace: root,
      script: 'model.py',
      renders: [{ path: 'linked-output/view.png' }],
    })).rejects.toThrow('outside workspace');
  });

  it('requires the extension to match the requested artifact format', async () => {
    const root = await workspace();
    await expect(normalizeCadJobRequest({
      workspace: root,
      script: 'model.py',
      outputs: [{ format: 'step', path: 'generated/model.stl' }],
    })).rejects.toThrow('must end in .step');
  });

  it('rejects duplicate final artifact paths', async () => {
    const root = await workspace();
    await expect(normalizeCadJobRequest({
      workspace: root,
      script: 'model.py',
      renders: [
        { path: 'renders/same.png', view: 'top' },
        { path: 'renders/same.png', view: 'bottom' },
      ],
    })).rejects.toThrow('Artifact paths must be unique');
  });
});

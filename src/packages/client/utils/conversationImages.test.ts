import { describe, expect, it } from 'vitest';
import { collectConversationImages, findConversationImageIndex } from './conversationImages';
import { resolveAgentFilePath } from './filePaths';

const builders = {
  localFile: (path: string) => `/api/files/binary?path=${encodeURIComponent(path)}&token=t`,
  attachment: (ref: string) => (ref.startsWith('http') ? ref : `/uploads/${ref.split('/').pop()}`),
};

describe('collectConversationImages', () => {
  it('collects Read-on-image rows, attachments and view_image in display order', () => {
    const history = [
      { type: 'user', content: 'check this [Image: /tmp/tide-commander-uploads/image-k7lm3d.png] please' },
      { type: 'tool_use', content: '', toolName: 'Read', toolInput: { file_path: '/pg/shots/04-alta-cliente.png' } },
      { type: 'tool_use', content: '', toolName: 'Read', toolInput: { file_path: '/repo/src/App.tsx' } }, // not an image
      { type: 'tool_use', content: '', toolName: 'view_image', toolInput: { path: '/pg/shots/05-detalle.jpg' } },
      { type: 'tool_result', content: 'ok' },
    ];
    const outputs = [
      // pi-normalized read + its "Tool input:" echo: one image, not two
      { text: 'Using tool: Read', toolName: 'Read', toolInput: { path: '/pg/shots/06-configuracion.png' } },
      { text: 'Tool input: {}', toolName: 'Read', toolInput: { path: '/pg/shots/06-configuracion.png' } },
      { text: 'done [Image: original 2474x1323, displayed at 2000x1070.]' }, // a caption, not a path
    ];

    const images = collectConversationImages(history, outputs, builders);
    expect(images.map((image) => image.name)).toEqual([
      'image-k7lm3d.png',
      '04-alta-cliente.png',
      '05-detalle.jpg',
      '06-configuracion.png',
    ]);
    expect(images[1].url).toBe('/api/files/binary?path=%2Fpg%2Fshots%2F04-alta-cliente.png&token=t');
  });

  it('ignores tool rows that are not images and never duplicates a URL', () => {
    const history = [
      { type: 'tool_use', content: '', toolName: 'Read', toolInput: { file_path: '/a/x.png' } },
      { type: 'tool_use', content: '', toolName: 'Read', toolInput: { file_path: '/a/x.png' } },
      { type: 'tool_use', content: '', toolName: 'Edit', toolInput: { file_path: '/a/logo.svg' } },
    ];
    expect(collectConversationImages(history, [], builders).map((image) => image.ref)).toEqual(['/a/x.png']);
  });
});

describe('findConversationImageIndex', () => {
  const images = collectConversationImages([
    { type: 'tool_use', content: '', toolName: 'Read', toolInput: { file_path: '/pg/a.png' } },
    { type: 'tool_use', content: '', toolName: 'Read', toolInput: { file_path: '/pg/b.png' } },
  ], [], builders);

  it('matches by exact URL, then by the streamed path, then by name', () => {
    expect(findConversationImageIndex(images, builders.localFile('/pg/b.png'), 'b.png')).toBe(1);
    // Same file, different auth token in the URL.
    expect(findConversationImageIndex(images, '/api/files/binary?path=%2Fpg%2Fb.png&token=other', 'b.png')).toBe(1);
    expect(findConversationImageIndex(images, 'blob:xyz', 'a.png')).toBe(0);
    expect(findConversationImageIndex(images, 'blob:nope', 'missing.png')).toBe(-1);
  });
});

describe('relative image paths (pi / Codex)', () => {
  it('resolve against the agent cwd, so the gallery URL matches the row thumbnail', () => {
    // pi reads `private/…/preview.png` relative to its cwd; unresolved, the
    // server 404s and the thumbnail hides itself.
    const cwd = '/home/riven/d/smash-web/';
    const cwdBuilders = { ...builders, localFile: (path: string) => builders.localFile(resolveAgentFilePath(path, cwd)) };
    const history = [
      { type: 'tool_use', content: '', toolName: 'Read', toolInput: { path: 'private/characters/local.tanjiro/masters/tanjiro-preview.png' } },
    ];
    const [image] = collectConversationImages(history, [], cwdBuilders);
    const rowUrl = builders.localFile('/home/riven/d/smash-web/private/characters/local.tanjiro/masters/tanjiro-preview.png');
    expect(image.url).toBe(rowUrl);
    expect(findConversationImageIndex([image], rowUrl, 'tanjiro-preview.png')).toBe(0);
  });
});

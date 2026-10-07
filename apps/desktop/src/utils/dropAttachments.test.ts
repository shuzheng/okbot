import assert from 'node:assert/strict';
import {
  ATTACH_IMAGE_EXTENSIONS,
  classifyAttachPath,
  collectDroppedAttachments,
  dataTransferHasFiles,
} from './dropAttachments';

assert.equal(classifyAttachPath('/tmp/photo.PNG'), 'image');
assert.equal(classifyAttachPath('/tmp/photo.jpeg'), 'image');
assert.equal(classifyAttachPath('/tmp/notes.txt'), 'file');
assert.equal(classifyAttachPath('/tmp/photo.heic'), 'file'); // not in picker filters
assert.equal(classifyAttachPath('/tmp/docs', { isDirectory: true }), 'folder');
assert.equal(classifyAttachPath('/tmp/docs.png', { isDirectory: true }), 'folder');
assert.ok(ATTACH_IMAGE_EXTENSIONS.has('webp'));
assert.ok(!ATTACH_IMAGE_EXTENSIONS.has('svg'));

assert.equal(dataTransferHasFiles({ types: ['Files'] } as unknown as DataTransfer), true);
assert.equal(dataTransferHasFiles({ types: ['text/plain'] } as unknown as DataTransfer), false);
assert.equal(dataTransferHasFiles(null), false);

function fakeFile(name: string, path: string): File {
  const f = new File(['x'], name, { type: '' });
  Object.defineProperty(f, 'path', { value: path });
  return f;
}

// Prefer DataTransferItem + webkitGetAsEntry for directories.
{
  const dirFile = fakeFile('docs', '/tmp/drop/docs');
  const imgFile = fakeFile('a.png', '/tmp/drop/a.png');
  const dt = {
    types: ['Files'],
    items: [
      {
        kind: 'file',
        getAsFile: () => dirFile,
        webkitGetAsEntry: () => ({ isDirectory: true, isFile: false }),
      },
      {
        kind: 'file',
        getAsFile: () => imgFile,
        webkitGetAsEntry: () => ({ isDirectory: false, isFile: true }),
      },
      {
        kind: 'string',
        getAsFile: () => null,
      },
    ],
    files: [dirFile, imgFile],
  } as unknown as DataTransfer;

  const got = collectDroppedAttachments(dt);
  assert.deepEqual(got, [
    { kind: 'folder', path: '/tmp/drop/docs', name: 'docs' },
    { kind: 'image', path: '/tmp/drop/a.png', name: 'a.png' },
  ]);
}

// Deduplicate paths; skip entries without a resolvable path.
{
  const withPath = fakeFile('a.txt', '/tmp/a.txt');
  const noPath = new File(['x'], 'b.txt');
  const dt = {
    types: ['Files'],
    items: [
      {
        kind: 'file',
        getAsFile: () => withPath,
        webkitGetAsEntry: () => ({ isDirectory: false, isFile: true }),
      },
      {
        kind: 'file',
        getAsFile: () => withPath,
        webkitGetAsEntry: () => ({ isDirectory: false, isFile: true }),
      },
      {
        kind: 'file',
        getAsFile: () => noPath,
        webkitGetAsEntry: () => ({ isDirectory: false, isFile: true }),
      },
    ],
    files: [],
  } as unknown as DataTransfer;

  const got = collectDroppedAttachments(dt);
  assert.deepEqual(got, [{ kind: 'file', path: '/tmp/a.txt', name: 'a.txt' }]);
}

// getPathForFile override (Electron 32+ webUtils).
{
  const f = new File(['x'], 'c.gif');
  const dt = {
    types: ['Files'],
    items: [
      {
        kind: 'file',
        getAsFile: () => f,
        webkitGetAsEntry: () => ({ isDirectory: false, isFile: true }),
      },
    ],
    files: [],
  } as unknown as DataTransfer;
  const got = collectDroppedAttachments(dt, {
    getPathForFile: () => '/abs/c.gif',
  });
  assert.deepEqual(got, [{ kind: 'image', path: '/abs/c.gif', name: 'c.gif' }]);
}

// Fallback to files list when items is empty.
{
  const f = fakeFile('readme.md', '/proj/readme.md');
  const dt = {
    types: ['Files'],
    items: [] as unknown as DataTransferItemList,
    files: [f],
  } as unknown as DataTransfer;
  const got = collectDroppedAttachments(dt);
  assert.deepEqual(got, [{ kind: 'file', path: '/proj/readme.md', name: 'readme.md' }]);
}

console.log('dropAttachments.test.ts: ok');

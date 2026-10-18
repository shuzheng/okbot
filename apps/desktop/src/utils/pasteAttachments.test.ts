import assert from 'node:assert/strict';
import { clipboardHasFiles, collectPastedFiles } from './pasteAttachments';

function fakeFile(name: string, type: string, body = 'x'): File {
  return new File([body], name, { type });
}

{
  const img = fakeFile('a.png', 'image/png');
  const dt = {
    items: [
      { kind: 'file', type: 'image/png', getAsFile: () => img },
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
    ],
    files: [img],
  } as unknown as DataTransfer;
  const got = collectPastedFiles(dt);
  assert.equal(got.length, 1);
  assert.equal(got[0]!.kind, 'image');
  assert.equal(got[0]!.name, 'a.png');
  assert.equal(clipboardHasFiles(dt), true);
}

{
  // Screenshot paste often has empty filename.
  const img = new File(['png'], '', { type: 'image/png' });
  const dt = {
    items: [{ kind: 'file', type: 'image/png', getAsFile: () => img }],
    files: [img],
  } as unknown as DataTransfer;
  const got = collectPastedFiles(dt);
  assert.equal(got.length, 1);
  assert.equal(got[0]!.kind, 'image');
  assert.ok(got[0]!.name.startsWith('clipboard.'));
}

{
  const dt = {
    items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
    files: [],
  } as unknown as DataTransfer;
  assert.equal(collectPastedFiles(dt).length, 0);
  assert.equal(clipboardHasFiles(dt), false);
  assert.equal(clipboardHasFiles(null), false);
}

console.log('pasteAttachments.test.ts: ok');

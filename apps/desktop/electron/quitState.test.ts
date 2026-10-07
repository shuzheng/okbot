import assert from 'node:assert/strict';
import { getAllowQuit, setAllowQuit, getIsQuitting, setIsQuitting } from './quitState';

// Mirror updater restartToInstall failure path: allowQuit must be clearable.
setAllowQuit(true);
assert.equal(getAllowQuit(), true);
setAllowQuit(false);
assert.equal(getAllowQuit(), false);

setIsQuitting(true);
assert.equal(getIsQuitting(), true);
setIsQuitting(false);
assert.equal(getIsQuitting(), false);

// Mirror updater restartToInstall non-darwin quitAndInstall failure: allowQuit must reset.
setAllowQuit(true);
try {
  throw new Error('quitAndInstall failed');
} catch {
  setAllowQuit(false);
}
assert.equal(getAllowQuit(), false);

console.log('quitState.test.ts: ok');

import assert from 'node:assert/strict';
import {
  resolveSessionAvatarMotion,
  SESSION_AVATAR_IDLE_MS,
} from './sessionAvatarMotion';

const now = 1_000_000;

{
  const m = resolveSessionAvatarMotion({
    active: true,
    busy: false,
    lastInteractedAt: undefined,
    now,
  });
  assert.deepEqual(m, { busy: false, animate: true, paused: false });
}

{
  const m = resolveSessionAvatarMotion({
    active: true,
    busy: true,
    lastInteractedAt: now - SESSION_AVATAR_IDLE_MS * 2,
    now,
  });
  assert.deepEqual(m, { busy: true, animate: true, paused: false });
}

{
  const m = resolveSessionAvatarMotion({
    active: false,
    busy: true,
    lastInteractedAt: undefined,
    now,
  });
  assert.deepEqual(m, { busy: true, animate: true, paused: false });
}

{
  const m = resolveSessionAvatarMotion({
    active: false,
    busy: false,
    lastInteractedAt: now - (SESSION_AVATAR_IDLE_MS - 1),
    now,
  });
  assert.deepEqual(m, { busy: false, animate: true, paused: false });
}

{
  const m = resolveSessionAvatarMotion({
    active: false,
    busy: false,
    lastInteractedAt: now - SESSION_AVATAR_IDLE_MS - 1,
    now,
  });
  assert.deepEqual(m, { busy: false, animate: false, paused: true });
}

{
  const m = resolveSessionAvatarMotion({
    active: false,
    busy: false,
    lastInteractedAt: undefined,
    now,
  });
  assert.deepEqual(m, { busy: false, animate: false, paused: true });
}

console.log('sessionAvatarMotion.test.ts: ok');

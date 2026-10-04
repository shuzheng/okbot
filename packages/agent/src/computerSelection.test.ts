import assert from 'node:assert/strict';
import {
  computersMentioned,
  effectiveDefaultComputerId,
  formatComputerRoutingSection,
  selectComputerForTool,
  type ComputerRoute,
} from './computerSelection.js';

const mini = { id: 'computer_mini', name: 'Mac mini', host: '127.0.0.1', port: 1, token: 't' };
const air = { id: 'computer_air', name: 'MacBook Air', host: '127.0.0.1', port: 2, token: 't' };
const base: ComputerRoute = { computers: [mini, air] };

assert.equal(effectiveDefaultComputerId(base), 'local');
assert.equal(effectiveDefaultComputerId({ ...base, defaultComputerId: 'missing' }), '');
assert.equal(selectComputerForTool({ ...base, defaultComputerId: 'missing' }).ok, false);
assert.equal(effectiveDefaultComputerId({ ...base, defaultComputerId: 'computer_mini' }), 'computer_mini');
assert.equal(
  effectiveDefaultComputerId({ ...base, defaultComputerId: 'computer_mini', turnComputerId: 'computer_air' }),
  'computer_air',
);

assert.equal(selectComputerForTool(base).id, 'local');
assert.equal(selectComputerForTool({ ...base, defaultComputerId: 'computer_air' }).id, 'computer_air');

const named = selectComputerForTool({
  ...base,
  defaultComputerId: 'local',
  userText: '请在 Mac mini 上跑 uname',
});
assert.equal(named.ok && named.id, 'computer_mini');

const localNamed = selectComputerForTool({
  ...base,
  defaultComputerId: 'computer_mini',
  userText: '在本机上看一下磁盘',
});
assert.equal(localNamed.ok && localNamed.id, 'local');

assert.deepEqual(
  computersMentioned('localhost 不是电脑', base).map((c) => c.id),
  [],
);

const both = selectComputerForTool({
  ...base,
  userText: '分别在 Mac mini 和 MacBook Air 上执行 uname',
});
assert.equal(both.ok, false);
const onAir = selectComputerForTool(
  { ...base, userText: '分别在 Mac mini 和 MacBook Air 上执行 uname' },
  'MacBook Air',
);
assert.equal(onAir.ok && onAir.id, 'computer_air');
const onId = selectComputerForTool(
  { ...base, userText: '分别在 Mac mini 和 MacBook Air 上执行 uname' },
  'computer_mini',
);
assert.equal(onId.ok && onId.id, 'computer_mini');

const unknown = selectComputerForTool(base, '不存在的电脑');
assert.equal(unknown.ok, false);

const nested = computersMentioned('只在 Mac mini 上', {
  computers: [
    mini,
    { id: 'computer_mac', name: 'Mac', host: '127.0.0.1', port: 3, token: 't' },
  ],
});
assert.deepEqual(nested.map((c) => c.id), ['computer_mini']);

const section = formatComputerRoutingSection({ ...base, defaultComputerId: 'computer_mini' });
assert.match(section, /默认电脑：Mac mini/);
assert.match(section, /id=local/);
assert.match(section, /多台/);

const off = { id: 'computer_off', name: 'Offbox', host: '127.0.0.1', port: 9, token: 't', enabled: false as const };
const disabledRoute: ComputerRoute = {
  computers: [mini, off],
  defaultComputerId: 'computer_off',
  userText: '在 Offbox 上跑 uname',
};
assert.equal(effectiveDefaultComputerId(disabledRoute), '');
assert.equal(selectComputerForTool({ ...disabledRoute, userText: '跑一下' }).ok, false);
assert.deepEqual(computersMentioned('在 Offbox 上跑', disabledRoute).map((c) => c.id), []);
assert.equal(selectComputerForTool(disabledRoute, 'Offbox').ok, false);
const miniStill = selectComputerForTool({ ...disabledRoute, userText: '请在 Mac mini 上跑' });
assert.equal(miniStill.ok && miniStill.id, 'computer_mini');


assert.deepEqual(computersMentioned('/usr/local/bin/okbot', { ...base, defaultComputerId: 'computer_mini' }).map((c) => c.id), []);
assert.deepEqual(computersMentioned('the local repo', base).map((c) => c.id), []);
const pathNamed = selectComputerForTool({
  ...base,
  defaultComputerId: 'computer_mini',
  userText: '运行 /usr/local/bin/okbot',
});
assert.equal(pathNamed.ok && pathNamed.id, 'computer_mini');
const explicitLocal = selectComputerForTool({ ...base, defaultComputerId: 'computer_mini' }, 'local');
assert.equal(explicitLocal.ok && explicitLocal.id, 'local');
const hyphen = computersMentioned('分别在 Mac mini-MacBook Air 上', base).map((c) => c.id).sort();
assert.deepEqual(hyphen, ['computer_air', 'computer_mini']);
const badTurn = selectComputerForTool({ ...base, defaultComputerId: 'computer_mini', turnComputerId: 'gone' });
assert.equal(badTurn.ok, false);

console.log('computerSelection.test.ts: ok');

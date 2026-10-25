/**
 * Busy composer → soft-steer append (no parallel); schedule stays parallel;
 * Stop during soft-steer must not startBotTurn.
 */
import assert from 'node:assert/strict';
import {
  listOwnerRunIds,
  registerOwnerRun,
  resetOwnerRunQueuesForTests,
  unregisterOwnerRun,
  type AbortControllerMap,
} from '../ownerRuns';
import {
  cancelAutoContinues,
  clearAutoContinueCancel,
  resetAutoContinueStateForTests,
} from '../autoContinueGate';
import {
  cancelSoftSteers,
  getSoftSteerEpoch,
  resetSoftSteerStateForTests,
} from '../softSteerGate';
import { orchestrateBotTurn } from './orchestrateBotTurn';
import { AUTO_CONTINUE_STALL_ESCALATION_TEXT, AUTO_CONTINUE_USER_TEXT } from './turnContext';

resetOwnerRunQueuesForTests();
resetSoftSteerStateForTests();

{
  // Race: busy → soft-steer delay → Stop → must not startBotTurn.
  const map: AbortControllerMap = new Map();
  const controller = new AbortController();
  registerOwnerRun(map, 'bot_race', 'run_1', controller);

  let steerStarted!: () => void;
  const steerGate = new Promise<void>((resolve) => {
    steerStarted = resolve;
  });
  let releaseSteer!: () => void;
  const steerHold = new Promise<void>((resolve) => {
    releaseSteer = resolve;
  });

  const startCalls: string[] = [];
  const softSteerCalls: string[] = [];
  const appended: string[] = [];

  const ctx = {
    abortControllers: map,
    storage: {
      listBots: () => [{ id: 'bot_race', providerId: 'p', modelId: 'm', name: 'R' }],
      getSettings: () => ({ model: { providers: [], defaultProviderId: '', defaultModelId: '' } }),
      getMessages: () => [
        {
          id: 'u1',
          role: 'user',
          content: '写一个脚本',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      appendMessage: (_id: string, msg: { content: string }) => {
        appended.push(msg.content);
      },
      touchBot: () => undefined,
      getMessageById: () => null,
      loadTasks: () => [],
    },
    sendRuntimeEvent: () => undefined,
  };

  const turnPromise = orchestrateBotTurn(
    ctx as never,
    { botId: 'bot_race', text: '继续', origin: 'composer' },
    '继续',
    {
      softSteer: async () => {
        softSteerCalls.push('soft');
        steerStarted();
        await steerHold;
        return { steered: true, superseded: true };
      },
      startTurn: async (_c, _p, text) => {
        startCalls.push(text);
        return {
          userMessage: {
            id: 'm',
            role: 'user',
            content: text,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        };
      },
    },
  );

  await steerGate;
  const epochBeforeStop = getSoftSteerEpoch('bot_race');
  cancelSoftSteers('bot_race');
  assert.ok(getSoftSteerEpoch('bot_race') > epochBeforeStop);
  unregisterOwnerRun(map, 'bot_race', 'run_1', controller);
  releaseSteer();

  const result = await turnPromise;
  assert.equal(result.superseded, true);
  assert.deepEqual(startCalls, [], 'must not startBotTurn after Stop during soft-steer');
  assert.deepEqual(softSteerCalls, ['soft']);
  assert.deepEqual(appended, ['继续']);
}

{
  // Non-composer (schedule) while busy: parallel start, never soft-steer.
  resetSoftSteerStateForTests();
  resetOwnerRunQueuesForTests();
  const map: AbortControllerMap = new Map();
  const controller = new AbortController();
  registerOwnerRun(map, 'bot_sched', 'run_s', controller);

  const startCalls: string[] = [];
  const softSteerCalls: string[] = [];
  const ctx = {
    abortControllers: map,
    storage: {
      listBots: () => [{ id: 'bot_sched', providerId: 'p', modelId: 'm', name: 'S' }],
      getSettings: () => ({ model: { providers: [], defaultProviderId: '', defaultModelId: '' } }),
      getMessages: () => [],
      appendMessage: () => undefined,
      touchBot: () => undefined,
      getMessageById: () => null,
      loadTasks: () => [],
    },
    sendRuntimeEvent: () => undefined,
  };

  await orchestrateBotTurn(
    ctx as never,
    { botId: 'bot_sched', text: '定时任务', origin: 'schedule' },
    '定时任务',
    {
      softSteer: async () => {
        softSteerCalls.push('soft');
        return { steered: true, superseded: false };
      },
      startTurn: async (_c, _p, text) => {
        startCalls.push(text);
        return {
          userMessage: {
            id: 'm',
            role: 'user',
            content: text,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        };
      },
    },
  );
  assert.deepEqual(startCalls, ['定时任务']);
  assert.deepEqual(softSteerCalls, []);
  // Long run still registered (schedule parallel; not soft-steered).
  assert.deepEqual(listOwnerRunIds(map, 'bot_sched'), ['run_s']);
  unregisterOwnerRun(map, 'bot_sched', 'run_s', controller);
}

{
  // Busy + composer (including former "clock" / short asks): always soft-steer,
  // never register a second parallel composer run.
  resetSoftSteerStateForTests();
  resetOwnerRunQueuesForTests();
  const map: AbortControllerMap = new Map();
  const controller = new AbortController();
  registerOwnerRun(map, 'bot_clock', 'run_long', controller);

  const startCalls: string[] = [];
  const softSteerCalls: string[] = [];
  const ctx = {
    abortControllers: map,
    storage: {
      listBots: () => [{ id: 'bot_clock', providerId: 'p', modelId: 'm', name: 'C' }],
      getSettings: () => ({ model: { providers: [], defaultProviderId: '', defaultModelId: '' } }),
      getMessages: () => [
        {
          id: 'u1',
          role: 'user',
          content: '调研 3 个技术各 5 步',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      appendMessage: () => undefined,
      touchBot: () => undefined,
      getMessageById: () => null,
      loadTasks: () => [],
    },
    sendRuntimeEvent: () => undefined,
  };

  await orchestrateBotTurn(
    ctx as never,
    { botId: 'bot_clock', text: '现在几点了', origin: 'composer' },
    '现在几点了',
    {
      softSteer: async () => {
        softSteerCalls.push('soft');
        unregisterOwnerRun(map, 'bot_clock', 'run_long', controller);
        return { steered: true, superseded: false };
      },
      startTurn: async (_c, _p, text) => {
        startCalls.push(text);
        return {
          userMessage: {
            id: 'm',
            role: 'user',
            content: text,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        };
      },
    },
  );
  assert.deepEqual(softSteerCalls, ['soft'], 'composer busy must soft-steer, not parallel');
  assert.deepEqual(startCalls, ['现在几点了']);
  assert.deepEqual(listOwnerRunIds(map, 'bot_clock'), [], 'long run aborted; no parallel peer left');
}

{
  // Busy + supplement-style composer: soft-steer then restart (same path).
  resetSoftSteerStateForTests();
  resetOwnerRunQueuesForTests();
  const map: AbortControllerMap = new Map();
  const controller = new AbortController();
  registerOwnerRun(map, 'bot_sup', 'run_1', controller);

  const startCalls: string[] = [];
  const softSteerCalls: string[] = [];
  const ctx = {
    abortControllers: map,
    storage: {
      listBots: () => [{ id: 'bot_sup', providerId: 'p', modelId: 'm', name: 'S' }],
      getSettings: () => ({ model: { providers: [], defaultProviderId: '', defaultModelId: '' } }),
      getMessages: () => [],
      appendMessage: () => undefined,
      touchBot: () => undefined,
      getMessageById: () => null,
      loadTasks: () => [],
    },
    sendRuntimeEvent: () => undefined,
  };

  await orchestrateBotTurn(
    ctx as never,
    { botId: 'bot_sup', text: '改成只调研前两个', origin: 'composer' },
    '改成只调研前两个',
    {
      softSteer: async () => {
        softSteerCalls.push('soft');
        unregisterOwnerRun(map, 'bot_sup', 'run_1', controller);
        return { steered: true, superseded: false };
      },
      startTurn: async (_c, _p, text) => {
        startCalls.push(text);
        return {
          userMessage: {
            id: 'm',
            role: 'user',
            content: text,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        };
      },
    },
  );
  assert.deepEqual(softSteerCalls, ['soft']);
  assert.deepEqual(startCalls, ['改成只调研前两个']);
}

{
  // Idle composer: soft-steer no-op (empty runs) then startTurn — catches racing AC.
  resetSoftSteerStateForTests();
  resetOwnerRunQueuesForTests();
  const map: AbortControllerMap = new Map();
  const startCalls: string[] = [];
  const softSteerCalls: string[] = [];
  const ctx = {
    abortControllers: map,
    storage: {
      listBots: () => [{ id: 'bot_idle', providerId: 'p', modelId: 'm', name: 'I' }],
      getSettings: () => ({ model: { providers: [], defaultProviderId: '', defaultModelId: '' } }),
      getMessages: () => [],
      appendMessage: () => undefined,
      touchBot: () => undefined,
      getMessageById: () => null,
      loadTasks: () => [],
    },
    sendRuntimeEvent: () => undefined,
  };

  await orchestrateBotTurn(
    ctx as never,
    { botId: 'bot_idle', text: '你好', origin: 'composer' },
    '你好',
    {
      softSteer: async () => {
        softSteerCalls.push('soft');
        return { steered: false, superseded: false };
      },
      startTurn: async (_c, _p, text) => {
        startCalls.push(text);
        return {
          userMessage: {
            id: 'm',
            role: 'user',
            content: text,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        };
      },
    },
  );
  assert.deepEqual(softSteerCalls, ['soft'], 'composer always soft-steers (idle = no-op abort)');
  assert.deepEqual(startCalls, ['你好']);
}


{
  // Clean done + unfinished task-progress → host auto-continue (quiet).
  resetSoftSteerStateForTests();
  resetOwnerRunQueuesForTests();
  resetAutoContinueStateForTests();
  const map: AbortControllerMap = new Map();
  const startCalls: string[] = [];
  let progressItems: Array<{ id: string; title: string; status: string }> = [
    { id: '1', title: 'A', status: 'done' },
    { id: '2', title: 'B', status: 'pending' },
  ];
  const ctx = {
    abortControllers: map,
    storage: {
      listBots: () => [{ id: 'bot_ac', providerId: 'p', modelId: 'm', name: 'A' }],
      getSettings: () => ({ model: { providers: [], defaultProviderId: '', defaultModelId: '' } }),
      getMessages: () => [],
      appendMessage: () => undefined,
      touchBot: () => undefined,
      getMessageById: () => null,
      loadTasks: () => [
        {
          v: 1 as const,
          id: 'task_1',
          title: 't',
          status: (progressItems.some((i) => i.status === 'pending' || i.status === 'in_progress')
            ? (progressItems.some((i) => i.status === 'in_progress') ? 'in_progress' : 'pending')
            : 'done') as 'pending' | 'in_progress' | 'done',
          steps: progressItems,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
    sendRuntimeEvent: () => undefined,
  };

  await orchestrateBotTurn(
    ctx as never,
    { botId: 'bot_ac', text: '开干', origin: 'composer' },
    '开干',
    {
      softSteer: async () => ({ steered: false, superseded: false }),
      startTurn: async (_c, payload, text) => {
        startCalls.push(`${payload.origin || 'unset'}:${text}`);
        if (payload.origin === 'auto_continue') {
          // Simulate progress advancing so the next loop can finish.
          progressItems = [
            { id: '1', title: 'A', status: 'done' },
            { id: '2', title: 'B', status: 'done' },
          ];
        }
        return {
          userMessage: {
            id: 'm',
            role: 'user',
            content: text,
            createdAt: '2026-01-01T00:00:00.000Z',
            ...(payload.origin === 'auto_continue' ? { autoContinue: true } : {}),
          },
        };
      },
    },
  );
  assert.deepEqual(startCalls, [
    'composer:开干',
    `auto_continue:${AUTO_CONTINUE_USER_TEXT}`,
  ]);
}

{
  // Unchanged fingerprint with unfinished tasks: keep AC (escalated prompt);
  // do not stop solely for no-spin. Cancel after several AC turns to end the loop.
  resetSoftSteerStateForTests();
  resetOwnerRunQueuesForTests();
  resetAutoContinueStateForTests();
  const map: AbortControllerMap = new Map();
  const startCalls: string[] = [];
  const startTexts: string[] = [];
  let acCount = 0;
  const stuck = {
    v: 1,
    title: 't',
    items: [
      { id: '1', title: 'A', status: 'done' },
      { id: '2', title: 'B', status: 'pending' },
    ],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const ctx = {
    abortControllers: map,
    storage: {
      listBots: () => [{ id: 'bot_stall', providerId: 'p', modelId: 'm', name: 'S' }],
      getSettings: () => ({ model: { providers: [], defaultProviderId: '', defaultModelId: '' } }),
      getMessages: () => [],
      appendMessage: () => undefined,
      touchBot: () => undefined,
      getMessageById: () => null,
      loadTasks: () => [
        {
          v: 1 as const,
          id: 'task_1',
          title: stuck.title,
          status: 'pending' as const,
          steps: stuck.items,
          updatedAt: stuck.updatedAt,
        },
      ],
    },
    sendRuntimeEvent: () => undefined,
  };

  await orchestrateBotTurn(
    ctx as never,
    { botId: 'bot_stall', text: '开干', origin: 'composer' },
    '开干',
    {
      startTurn: async (_c, payload, text) => {
        startCalls.push(payload.origin || 'unset');
        startTexts.push(text);
        if (payload.origin === 'auto_continue') {
          acCount += 1;
          // Past the old stop-at-2 threshold: still continuing; cancel to end test.
          if (acCount >= 4) {
            cancelAutoContinues('bot_stall');
          }
        }
        return {
          userMessage: {
            id: 'm',
            role: 'user',
            content: text,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        };
      },
    },
  );
  assert.equal(startCalls[0], 'composer');
  assert.ok(
    startCalls.filter((x) => x === 'auto_continue').length >= 4,
    `expected >=4 auto_continues while unfinished+unchanged, got ${startCalls.filter((x) => x === 'auto_continue').length}`,
  );
  assert.equal(startTexts[1], AUTO_CONTINUE_USER_TEXT);
  assert.equal(startTexts[2], AUTO_CONTINUE_STALL_ESCALATION_TEXT);
  assert.equal(startTexts[3], AUTO_CONTINUE_STALL_ESCALATION_TEXT);
  clearAutoContinueCancel('bot_stall');
}

{
  // Escalated retry that advances progress continues the chain (status-ask stall recovery).
  resetSoftSteerStateForTests();
  resetOwnerRunQueuesForTests();
  resetAutoContinueStateForTests();
  const map: AbortControllerMap = new Map();
  const startCalls: string[] = [];
  let acCount = 0;
  let progressItems: Array<{ id: string; title: string; status: string }> = [
    { id: '1', title: 'A', status: 'done' },
    { id: '2', title: 'B', status: 'in_progress' },
  ];
  const ctx = {
    abortControllers: map,
    storage: {
      listBots: () => [{ id: 'bot_escal', providerId: 'p', modelId: 'm', name: 'E' }],
      getSettings: () => ({ model: { providers: [], defaultProviderId: '', defaultModelId: '' } }),
      getMessages: () => [],
      appendMessage: () => undefined,
      touchBot: () => undefined,
      getMessageById: () => null,
      loadTasks: () => [
        {
          v: 1 as const,
          id: 'task_1',
          title: 't',
          status: (progressItems.some((i) => i.status === 'pending' || i.status === 'in_progress')
            ? (progressItems.some((i) => i.status === 'in_progress') ? 'in_progress' : 'pending')
            : 'done') as 'pending' | 'in_progress' | 'done',
          steps: progressItems,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
    sendRuntimeEvent: () => undefined,
  };

  await orchestrateBotTurn(
    ctx as never,
    { botId: 'bot_escal', text: '做完了吗？', origin: 'composer' },
    '做完了吗？',
    {
      startTurn: async (_c, payload, text) => {
        startCalls.push(`${payload.origin || 'unset'}`);
        if (payload.origin === 'auto_continue') {
          acCount += 1;
          // First AC: text-only stall (fingerprint unchanged). Second (escalated): mark done.
          if (acCount >= 2) {
            progressItems = [
              { id: '1', title: 'A', status: 'done' },
              { id: '2', title: 'B', status: 'done' },
            ];
          }
        }
        return {
          userMessage: {
            id: 'm',
            role: 'user',
            content: text,
            createdAt: '2026-01-01T00:00:00.000Z',
            ...(payload.origin === 'auto_continue' ? { autoContinue: true } : {}),
          },
        };
      },
    },
  );
  assert.deepEqual(startCalls, ['composer', 'auto_continue', 'auto_continue']);
}

{
  // Aborted turn must not auto-continue.
  resetSoftSteerStateForTests();
  resetOwnerRunQueuesForTests();
  resetAutoContinueStateForTests();
  const map: AbortControllerMap = new Map();
  const startCalls: string[] = [];
  const ctx = {
    abortControllers: map,
    storage: {
      listBots: () => [{ id: 'bot_ab', providerId: 'p', modelId: 'm', name: 'A' }],
      getSettings: () => ({ model: { providers: [], defaultProviderId: '', defaultModelId: '' } }),
      getMessages: () => [],
      appendMessage: () => undefined,
      touchBot: () => undefined,
      getMessageById: () => null,
      loadTasks: () => [
        {
          v: 1 as const,
          id: 'task_1',
          status: 'pending' as const,
          steps: [{ id: '1', title: 'A', status: 'pending' as const }],
          updatedAt: 't',
        },
      ],
    },
    sendRuntimeEvent: () => undefined,
  };

  const result = await orchestrateBotTurn(
    ctx as never,
    { botId: 'bot_ab', text: '开干', origin: 'composer' },
    '开干',
    {
      startTurn: async (_c, _p, text) => {
        startCalls.push(text);
        return {
          userMessage: {
            id: 'm',
            role: 'user',
            content: text,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          aborted: true,
        };
      },
    },
  );
  assert.equal(result.aborted, true);
  assert.deepEqual(startCalls, ['开干']);
}

{
  // Stop cancel flag skips auto-continue even after clean done.
  resetSoftSteerStateForTests();
  resetOwnerRunQueuesForTests();
  resetAutoContinueStateForTests();
  const map: AbortControllerMap = new Map();
  const startCalls: string[] = [];
  const ctx = {
    abortControllers: map,
    storage: {
      listBots: () => [{ id: 'bot_stop_ac', providerId: 'p', modelId: 'm', name: 'A' }],
      getSettings: () => ({ model: { providers: [], defaultProviderId: '', defaultModelId: '' } }),
      getMessages: () => [],
      appendMessage: () => undefined,
      touchBot: () => undefined,
      getMessageById: () => null,
      loadTasks: () => [
        {
          v: 1 as const,
          id: 'task_1',
          status: 'pending' as const,
          steps: [{ id: '1', title: 'A', status: 'pending' as const }],
          updatedAt: 't',
        },
      ],
    },
    sendRuntimeEvent: () => undefined,
  };

  // Simulate Stop during the turn: cancel is set before maybeAutoContinue runs.
  await orchestrateBotTurn(
    ctx as never,
    { botId: 'bot_stop_ac', text: '开干', origin: 'composer' },
    '开干',
    {
      startTurn: async (_c, _p, text) => {
        startCalls.push(text);
        cancelAutoContinues('bot_stop_ac');
        return {
          userMessage: {
            id: 'm',
            role: 'user',
            content: text,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        };
      },
    },
  );
  assert.deepEqual(startCalls, ['开干']);
  clearAutoContinueCancel('bot_stop_ac');
}


{
  // No max-count cap: keep auto-continuing while progress advances.
  resetSoftSteerStateForTests();
  resetOwnerRunQueuesForTests();
  resetAutoContinueStateForTests();
  const map: AbortControllerMap = new Map();
  const startCalls: string[] = [];
  let step = 0;
  const ctx = {
    abortControllers: map,
    storage: {
      listBots: () => [{ id: 'bot_many', providerId: 'p', modelId: 'm', name: 'M' }],
      getSettings: () => ({ model: { providers: [], defaultProviderId: '', defaultModelId: '' } }),
      getMessages: () => [],
      appendMessage: () => undefined,
      touchBot: () => undefined,
      getMessageById: () => null,
      loadTasks: () => {
        // After N continue turns have finished, mark done.
        const pendingLeft = Math.max(0, 5 - step);
        const steps = [];
        for (let i = 0; i < 5; i++) {
          steps.push({
            id: String(i + 1),
            title: `S${i + 1}`,
            status: (i < 5 - pendingLeft ? 'done' : 'pending') as 'done' | 'pending',
          });
        }
        return [
          {
            v: 1 as const,
            id: 'task_1',
            title: 'many',
            status: (pendingLeft > 0 ? 'pending' : 'done') as 'pending' | 'done',
            steps,
            updatedAt: 't',
          },
        ];
      },
    },
    sendRuntimeEvent: () => undefined,
  };

  await orchestrateBotTurn(
    ctx as never,
    { botId: 'bot_many', text: '开干', origin: 'composer' },
    '开干',
    {
      startTurn: async (_c, payload, text) => {
        startCalls.push(payload.origin || 'unset');
        if (payload.origin === 'auto_continue') {
          step += 1;
        }
        return {
          userMessage: {
            id: 'm',
            role: 'user',
            content: text,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        };
      },
    },
  );
  // 1 composer + 5 auto-continues (each advances one item) > any 1–3 cap.
  assert.equal(startCalls[0], 'composer');
  assert.equal(startCalls.filter((x) => x === 'auto_continue').length, 5);
  assert.ok(startCalls.length === 6, `expected 6 turns, got ${startCalls.length}`);
}



{
  // Race: auto_continue registered → composer soft-steer must abort it (no parallel).
  resetSoftSteerStateForTests();
  resetOwnerRunQueuesForTests();
  resetAutoContinueStateForTests();
  const map: AbortControllerMap = new Map();
  const acCtrl = new AbortController();
  registerOwnerRun(map, 'bot_race_ac', 'run_ac', acCtrl);

  const startCalls: string[] = [];
  const softSteerCalls: string[] = [];
  const ctx = {
    abortControllers: map,
    storage: {
      listBots: () => [{ id: 'bot_race_ac', providerId: 'p', modelId: 'm', name: 'R' }],
      getSettings: () => ({ model: { providers: [], defaultProviderId: '', defaultModelId: '' } }),
      getMessages: () => [],
      appendMessage: () => undefined,
      touchBot: () => undefined,
      getMessageById: () => null,
      loadTasks: () => [],
    },
    sendRuntimeEvent: () => undefined,
  };

  await orchestrateBotTurn(
    ctx as never,
    { botId: 'bot_race_ac', text: '插一句', origin: 'composer' },
    '插一句',
    {
      softSteer: async () => {
        softSteerCalls.push('soft');
        assert.equal(acCtrl.signal.aborted, false);
        // Real softSteerNewestRun would abort; simulate abort+unregister.
        acCtrl.abort();
        unregisterOwnerRun(map, 'bot_race_ac', 'run_ac', acCtrl);
        return { steered: true, superseded: false };
      },
      startTurn: async (_c, _p, text) => {
        startCalls.push(text);
        return {
          userMessage: {
            id: 'm',
            role: 'user',
            content: text,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        };
      },
    },
  );
  assert.deepEqual(softSteerCalls, ['soft']);
  assert.deepEqual(startCalls, ['插一句']);
  assert.equal(acCtrl.signal.aborted, true);
  assert.deepEqual(listOwnerRunIds(map, 'bot_race_ac'), [], 'AC aborted; only composer turn');
}

console.log('orchestrateBotTurn.test.ts OK');

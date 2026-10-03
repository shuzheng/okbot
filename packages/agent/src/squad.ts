import { Agent, OpenAIProvider, Runner, tool, type Session, type SessionInputCallback } from '@openai/agents';
import { addTokenUsage, emptyTokenUsage, type TokenUsage } from '@okbot/shared';
import { z } from 'zod';
import type {
  ChatMessage,
  ResolvedModelConfig,
  SecuritySettings,
  SquadSettings,
  ToolPreferences,
} from '@okbot/shared';
import {
  DEFAULT_SECURITY,
  DEFAULT_SQUAD_SETTINGS,
  DEFAULT_TOOL_PREFERENCES,
} from '@okbot/shared';
import { normalizeMarkdownHeadings } from './promptContext.js';
import {
  formatHistoryBlock,
  formatSessionSummarySection,
  listEnabledToolIds,
} from './instructions.js';
import { VISION_TURN_INSTRUCTION } from './visionInput.js';
import {
  buildRunOpts,
  consumeAgentTextStream,
  runHitlStreamLoop,
  type AgentRunStreamResult,
} from './hitl.js';
import { buildTools, type SkillLookup } from './tools.js';
import type { ExecutionBackend } from './executionBackend.js';
import { formatComputerRoutingSection, type ComputerRoute } from './computerSelection.js';
import { wrapToolExecute, type ToolRunBudget } from './toolRunBudget.js';
import { assertModel } from './model.js';
import type { HitlLoopHooks, RunChatResult } from './types.js';

export interface SquadMemberAgentSpec {
  botId: string;
  name: string;
  description: string;
  role: string;
  agentsMd?: string;
  /** Catalog-only skills for this member's nested run. */
  skillsText?: string;
  /** Resolve full skill body for this member's `read_skill` tool. */
  skillLookup?: SkillLookup;
  memoriesText?: string;
}

export interface RunSquadChatInput extends HitlLoopHooks {
  squadName: string;
  squadDescription: string;
  /** Global settings.squad (persona / playbook / maxTurns). */
  squadSettings?: SquadSettings;
  /** All member seats; built-in captain is not among them. */
  members: SquadMemberAgentSpec[];
  sessionSummary?: string;
  model: ResolvedModelConfig;
  tools?: ToolPreferences;
  security?: SecuritySettings;
  /** Shared budget for captain tools + nested member tool executes. */
  toolRunBudget?: ToolRunBudget;
  session?: Session;
  sessionInputCallback?: SessionInputCallback;
  /** Current user turn includes vision image attachments. */
  hasVisionInput?: boolean;
  /** Squad id — generated images land in `~/.okbot/<ownerId>/resources/`. */
  ownerId: string;
  /** Absolute `~/.okbot/<ownerId>/resources` directory. */
  resourcesDir: string;
  /** Shell/fs backend for this run. Ignored when computerRoute is set. */
  executionBackend?: ExecutionBackend;
  /** Per-call computer selection for captain and member shell/fs tools. */
  computerRoute?: ComputerRoute;
  history?: ChatMessage[];
  userText: string;
}

function sanitizeToolName(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return s || 'member';
}

/** Unique ask_* tool names parallel to members (ask_base, ask_base_2, …). */
export function allocateAskToolNames(members: { name: string; botId: string }[]): string[] {
  const usedNames = new Set<string>();
  return members.map((member) => {
    const base = sanitizeToolName(member.name || member.botId);
    let toolName = `ask_${base}`;
    let n = 2;
    while (usedNames.has(toolName)) {
      toolName = `ask_${base}_${n}`;
      n += 1;
    }
    usedNames.add(toolName);
    return toolName;
  });
}


/**
 * Sync read-modify-write for shared member usage under concurrent ask_* executes.
 * Must stay synchronous (no await between reads/writes); Node's single-threaded event
 * loop then makes overlapping tool completes safe without an async mutex.
 */
export function recordMemberTokenUsage(
  state: { acc: TokenUsage; byBot: Record<string, TokenUsage> },
  botId: string,
  usage: TokenUsage,
): void {
  state.acc = addTokenUsage(state.acc, usage);
  state.byBot[botId] = addTokenUsage(state.byBot[botId] ?? emptyTokenUsage(), usage);
}

function buildMemberSquadInstructions(
  squadName: string,
  member: SquadMemberAgentSpec,
  prefs: ToolPreferences,
  computerRouting?: string,
): string {
  const roleLine = `你在《${squadName}》小队中的角色是：${member.role || '成员'}。请严格按该角色完成队长交给你的子任务，直接给出结果，不要扮演队长或调用其他队员。`;
  return normalizeMarkdownHeadings(
    [
      `你是「${member.name || 'OkBot'}」，小队成员助手。`,
      roleLine,
      member.description?.trim() ? `对外简介：${member.description.trim()}` : '',
      member.agentsMd?.trim()
        ? `以下是本机器人的 AGENTS.md（系统提示，须遵守）：\n\n${member.agentsMd.trim()}`
        : '',
      member.memoriesText?.trim()
        ? `## 记忆（须遵守；过期项已过滤）\n\n${member.memoriesText.trim()}`
        : '',
      member.skillsText?.trim()
        ? `## Skills（目录；须先加载再遵循）\n\n下方为技能目录。匹配时须先调用 read_skill（传入 slug）加载完整正文再执行；有匹配技能时不要另起炉灶。\n\n${member.skillsText.trim()}`
        : '',
      '用简洁、清楚的中文回答。只处理队长通过工具传入的任务，完成后把结论返回给队长。',
      computerRouting?.trim() || '',
      (() => {
        const enabled = listEnabledToolIds(prefs);
        return enabled.length
          ? `你当前可用的本机工具：${enabled.join('、')}。`
          : '当前没有启用任何本机工具，请直接回答。';
      })(),
    ]
      .filter(Boolean)
      .join('\n\n'),
  );
}

export function buildCaptainSquadInstructions(input: {
  squadName: string;
  squadDescription: string;
  persona: string;
  playbook: string;
  members: SquadMemberAgentSpec[];
  /** Parallel to members — real ask_* names including _2 suffixes. */
  askToolNames: string[];
  prefs: ToolPreferences;
  sessionSummary?: string;
  history: ChatMessage[];
  hasVisionInput?: boolean;
  computerRouting?: string;
}): string {
  const roster = input.members
    .map((m) => {
      return `- ${m.name}：角色「${m.role || '成员'}」${m.description?.trim() ? ` — ${m.description.trim()}` : ''}`;
    })
    .join('\n');
  const toolHint = input.members.length
    ? `你可以调用以下队员工具完成子任务（队员之间不会互相通话；无依赖时可在同一轮并行调用多名，有依赖时等返回后再决定下一步）：${input.members
        .map((m, i) => `${input.askToolNames[i] || `ask_${sanitizeToolName(m.name || m.botId)}`}（参数 task：子任务说明；${m.name} / ${m.role || '成员'}）`)
        .join('、')}。`
    : '当前没有可调用的队员工具，请亲自回答。';
  const enabled = listEnabledToolIds(input.prefs);
  const localTools = enabled.length
    ? `你自己也可用本机工具：${enabled.join('、')}。`
    : '';
  return normalizeMarkdownHeadings(
    [
      `你是《${input.squadName}》小队的内置虚拟队长（编排者），不是普通助手列表中的机器人。`,
      input.squadDescription?.trim() ? `小队简介：${input.squadDescription.trim()}` : '',
      input.persona?.trim() ? `## 队长人设\n\n${input.persona.trim()}` : '',
      `## 小队花名册与角色\n\n${roster || '（无）'}`,
      input.playbook?.trim() ? `## 协作指引\n\n${input.playbook.trim()}` : '',
      formatSessionSummarySection(input.sessionSummary),
      '星型协作：队员只向你汇报；不要假设队员之间能对话。无依赖的子任务可在同一轮并行调用多名队员工具。',
      toolHint,
      localTools,
      input.hasVisionInput ? VISION_TURN_INSTRUCTION : '',
      input.computerRouting?.trim() || '',
      '用简洁、清楚的中文回答用户；整合队员结果后给出最终答复。',
      formatHistoryBlock(input.history),
    ]
      .filter(Boolean)
      .join('\n\n'),
  );
}

/**
 * Squad chat: built-in captain Agent with members exposed as ask_* tools (parallel star topology).
 * Captain remains the only hub; members do not talk to each other. When the model emits multiple
 * ask_* tool calls in one turn, the Agents SDK runs their execute handlers concurrently
 * (maxFunctionToolConcurrency unset → all in-flight).
 */
export async function runSquadChat(input: RunSquadChatInput): Promise<
  RunChatResult & { memberUsageByBot?: Record<string, TokenUsage> }
> {
  assertModel(input.model);
  if (input.signal?.aborted) return { content: '' };

  const toolPrefs = input.tools ?? DEFAULT_TOOL_PREFERENCES;
  const security = input.security ?? DEFAULT_SECURITY;
  const squadSettings = input.squadSettings ?? DEFAULT_SQUAD_SETTINGS;
  const captainMaxTurns = squadSettings.captainMaxTurns;
  const memberMaxTurns = squadSettings.memberMaxTurns;
  const provider = new OpenAIProvider({
    apiKey: input.model.apiKey,
    baseURL: input.model.baseURL.replace(/\/$/, ''),
    useResponses: input.model.apiFormat === 'responses',
  });
  const historyForInstructions = input.session ? [] : (input.history ?? []);

  const memberTools = [];
  const memberUsageState: { acc: TokenUsage; byBot: Record<string, TokenUsage> } = {
    acc: emptyTokenUsage(),
    byBot: {},
  };
  const askToolNames = allocateAskToolNames(input.members);
  for (let i = 0; i < input.members.length; i++) {
    const member = input.members[i]!;
    const capturedName = askToolNames[i]!;
    const capturedMember = member;
    memberTools.push(
      tool({
        name: capturedName,
        description: `向小队成员「${capturedMember.name}」咨询（角色：${capturedMember.role || '成员'}）。传入清晰的子任务说明；成员会自行作答并返回给你。`,
        parameters: z.object({
          task: z.string().describe('交给该成员的子任务说明（越具体越好）'),
        }),
        // No HITL for squad handoffs — the exchange is shown in the transcript instead.
        execute: wrapToolExecute(capturedName, input.toolRunBudget, async ({ task }) => {
          try {
          const taskText = String(task ?? '').trim();
          if (!taskText) return '（空任务，已跳过）';
          input.onSquadExchange?.({
            kind: 'ask',
            memberBotId: capturedMember.botId,
            memberName: capturedMember.name,
            toolName: capturedName,
            content: taskText,
          });
          const memberAgent = new Agent({
            name: capturedMember.name || capturedName,
            instructions: buildMemberSquadInstructions(
              input.squadName,
              capturedMember,
              toolPrefs,
              input.computerRoute ? formatComputerRoutingSection(input.computerRoute) : '',
            ),
            model: input.model.model,
            ...(typeof input.model.maxTokens === 'number' && input.model.maxTokens >= 1
              ? { modelSettings: { maxTokens: input.model.maxTokens } }
              : {}),
            tools: buildTools(toolPrefs, security, input.toolRunBudget, {
              skillLookup: capturedMember.skillLookup,
              imageApi: {
                baseURL: input.model.baseURL,
                apiKey: input.model.apiKey,
                catalogModelIds: input.model.providerModelIds,
                providerName: input.model.providerName,
              },
              imageAssets: { ownerId: input.ownerId, resourcesDir: input.resourcesDir },
              backend: input.computerRoute ? undefined : input.executionBackend,
              computerRoute: input.computerRoute
                ? {
                    ...input.computerRoute,
                    userText: [input.computerRoute.userText, taskText].filter(Boolean).join('\n'),
                  }
                : undefined,
            }),
          });
          const memberRunner = new Runner({
            modelProvider: provider,
            model: input.model.model,
          });
          const memberRunOpts: {
            stream: true;
            signal?: AbortSignal;
            maxTurns?: number;
          } = { stream: true, signal: input.signal, maxTurns: memberMaxTurns };
          let memberResult = (await memberRunner.run(
            memberAgent,
            taskText,
            memberRunOpts,
          )) as AgentRunStreamResult;
          // Do not stream member tokens into the captain bubble.
          let memberStreamed = await consumeAgentTextStream(
            memberResult,
            undefined,
            input.signal,
          );
          const memberOut = await runHitlStreamLoop(
            memberAgent,
            memberRunner,
            memberRunOpts,
            memberResult,
            memberStreamed,
            {
              signal: input.signal,
              onDelta: undefined,
              toolRunBudget: input.toolRunBudget,
              onToolApprovalRequest: input.onToolApprovalRequest,
              onToolResult: input.onToolResult,
            },
          );
          const reply = memberOut.content?.trim() || '（成员未返回内容）';
          const mu = memberOut.usage ?? emptyTokenUsage();
          recordMemberTokenUsage(memberUsageState, capturedMember.botId, mu);
          input.onSquadExchange?.({
            kind: 'reply',
            memberBotId: capturedMember.botId,
            memberName: capturedMember.name,
            toolName: capturedName,
            content: reply,
            usage: mu,
          });
          return reply;
          } catch (err) {
            // One member's failure must not cancel sibling ask_* calls (SDK sibling cancellation).
            if (input.signal?.aborted) throw err;
            const msg = err instanceof Error ? err.message : String(err);
            const failed = `（成员「${capturedMember.name}」执行失败：${msg}）`;
            input.onSquadExchange?.({
              kind: 'reply',
              memberBotId: capturedMember.botId,
              memberName: capturedMember.name,
              toolName: capturedName,
              content: failed,
            });
            return failed;
          }
        }),
      }),
    );
  }

  const captain = new Agent({
    name: input.squadName || '小队队长',
    instructions: buildCaptainSquadInstructions({
      squadName: input.squadName,
      squadDescription: input.squadDescription,
      persona: squadSettings.captainPersona,
      playbook: squadSettings.playbook,
      members: input.members,
      askToolNames,
      prefs: toolPrefs,
      sessionSummary: input.sessionSummary,
      history: historyForInstructions,
      hasVisionInput: input.hasVisionInput === true,
      computerRouting: input.computerRoute ? formatComputerRoutingSection(input.computerRoute) : '',
    }),
    model: input.model.model,
    modelSettings: {
      // Provider may emit multiple ask_* in one turn; SDK then runs executes concurrently.
      parallelToolCalls: true,
      ...(typeof input.model.maxTokens === 'number' && input.model.maxTokens >= 1
        ? { maxTokens: input.model.maxTokens }
        : {}),
    },
    tools: [
      ...buildTools(toolPrefs, security, input.toolRunBudget, {
        imageApi: {
          baseURL: input.model.baseURL,
          apiKey: input.model.apiKey,
          catalogModelIds: input.model.providerModelIds,
          providerName: input.model.providerName,
        },
        imageAssets: { ownerId: input.ownerId, resourcesDir: input.resourcesDir },
        backend: input.computerRoute ? undefined : input.executionBackend,
        computerRoute: input.computerRoute,
      }),
      ...memberTools,
    ],
  });

  const runner = new Runner({
    modelProvider: provider,
    model: input.model.model,
  });
  const runOpts = { ...buildRunOpts(input), maxTurns: captainMaxTurns };

  let result = (await runner.run(captain, input.userText, runOpts)) as AgentRunStreamResult;
  const streamed = await consumeAgentTextStream(result, input.onDelta, input.signal);
  const captainOut = await runHitlStreamLoop(captain, runner, runOpts, result, streamed, input);
  const usage = addTokenUsage(captainOut.usage ?? emptyTokenUsage(), memberUsageState.acc);
  return {
    content: captainOut.content,
    usage,
    memberUsageByBot: memberUsageState.byBot,
  };
}

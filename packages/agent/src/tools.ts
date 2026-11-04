import { tool } from '@openai/agents';
import { z } from 'zod';
import type { SecuritySettings, ToolPreferences } from '@okbot/shared';
import { DEFAULT_SECURITY } from '@okbot/shared';
import {
  buildToolInputGuardrails,
  buildToolOutputGuardrails,
  ownerWorkDirFromResourcesDir,
  resolveOwnerLibraryIndexTarget,
} from './guardrails.js';

import { wrapToolExecute, type ToolRunBudget } from './toolRunBudget.js';
import {
  formatGenerateImageToolOutput,
  generateImage,
  GENERATE_IMAGE_UNSUPPORTED_MESSAGE,
  IMAGE_ASPECT_RATIOS,
  inferImageCapability,
  OPENAI_DEFAULT_IMAGE_MODELS,
  type ImageApiCredentials,
  type ImageCapability,
} from './generateImage.js';
import {
  formatUntrusted,
  formatWebFetchToolOutput,
  webFetch,
} from './webFetch.js';
import {
  formatWebSearchToolOutput,
  webSearch,
  webSearchNotConfiguredMessage,
} from './webSearch.js';
import type { WebSettings } from '@okbot/shared';
import {
  createLocalExecutionBackend,
  type ExecutionBackend,
  resolveExecutionBackend,
  resolveShellExec,
  type ResolveShellExecOptions,
  type ShellExecSpec,
} from './executionBackend.js';
import {
  defaultComputerLabel,
  selectComputerForTool,
  type ComputerRoute,
} from './computerSelection.js';

export type { ExecutionBackend, ShellExecSpec, ResolveShellExecOptions };
export { resolveShellExec, createLocalExecutionBackend };

const MAX_TOOL_OUTPUT = 24_000;

function truncate(text: string, max = MAX_TOOL_OUTPUT): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n…(已截断，共 ${text.length} 字符)`;
}

export type SkillLookupResult = {
  slug: string;
  name: string;
  description: string;
  body: string;
  /** True when loaded from ~/.agents/skills (enabled global). */
  global?: boolean;
};

/** Resolve an enabled skill body by slug for the current bot (or squad member). */
export type SkillLookup = (slug: string) => SkillLookupResult | null;

/** Search this chat's history (scoped by the desktop host). */
export type HistorySearch = (
  query: string,
  limit: number,
) => Promise<string> | string;

/** Manage timed wakeups for the current bot/squad (scoped by the desktop host). */
export type ScheduleManage = (input: {
  action: 'create' | 'list' | 'pause' | 'resume' | 'delete';
  prompt?: string | null;
  title?: string | null;
  schedule?: string | null;
  timezone?: string | null;
  job_id?: string | null;
  once?: boolean | null;
}) => Promise<string> | string;


/**
 * Models often send checklist ids as numbers (`1`) or omit them; schema must coerce.
 * Inner type is `.nullable().optional()` so OpenAI strict JSON Schema conversion succeeds
 * (bare `.optional()` throws UserError: all fields must be required).
 */
const optionalToolId = z.preprocess((v) => {
  if (v == null || v === '') return undefined;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return v;
}, z.string().nullable().optional());

/** Manage durable multi-task list for the current bot/squad (scoped by the desktop host). */
export type TaskProgressManage = (input: {
  action: 'add' | 'update' | 'list';
  id?: string | null;
  title?: string | null;
  note?: string | null;
  status?: 'backlog' | 'pending' | 'in_progress' | 'done' | null;
  steps?: Array<{
    id?: string | null;
    title: string;
    status?:
      | 'pending'
      | 'in_progress'
      | 'blocked'
      | 'succeeded'
      | 'failed'
      | 'cancelled'
      | null;
    note?: string | null;
  }> | null;
  step_id?: string | null;
  step_title?: string | null;
  step_status?:
    | 'pending'
    | 'in_progress'
    | 'blocked'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | null;
  step_note?: string | null;
  step_new_title?: string | null;
  include_done?: boolean | null;
}) => Promise<string> | string;

/** Create/update HTML notes in the per-owner resources library (scoped by the host). */
export type NoteManage = (input: {
  action: 'create' | 'update' | 'list' | 'get';
  title?: string | null;
  html?: string | null;
  id?: string | null;
  path?: string | null;
}) => Promise<string> | string;

/** Pin / forget / promote memories for the current bot (scoped by the desktop host). */
export type MemoryManage = (input: {
  action: 'list' | 'pin' | 'unpin' | 'promote' | 'forget';
  memory_id?: string | null;
  scope?: 'global' | 'bot' | null;
  include_candidates?: boolean | null;
}) => Promise<string> | string;

/** Emit a standalone assistant chat bubble mid-run (host seals/rotates live id). */
/** Plain string = text bubble (legacy). Object may be text, reaction, or both. */
export type EmitAssistantMessageInput =
  | string
  | {
      /** Markdown bubble body. Omit for reaction-only. */
      content?: string;
      /** User bubble id: place/clear an emoji reaction (no new timeline row). */
      reactToMessageId?: string;
      /** Emoji for reactToMessageId; empty string clears the assistant reaction. */
      emoji?: string;
    };

export type EmitAssistantMessage = (
  input: EmitAssistantMessageInput,
) => Promise<void> | void;

export type BuildToolsOptions = {
  /** Required for `read_skill` to return bodies; omit when no skill catalog is bound. */
  skillLookup?: SkillLookup;
  /**
   * Required for `search_history`. Host must scope to the current bot/squad only
   * and redact/truncate results. Omit to disable the tool body.
   */
  historySearch?: HistorySearch;
  /**
   * Required for `manage_schedule`. Host must scope to the current bot/squad only.
   */
  scheduleManage?: ScheduleManage;
  /**
   * Required for `manage_task_progress`. Host must scope to the current bot/squad only.
   */
  taskProgressManage?: TaskProgressManage;
  /**
   * Required for `manage_note`. Host must scope to the current bot/squad only.
   */
  noteManage?: NoteManage;
  /**
   * Required for `manage_memory`. Bot host: global+bot memory.md; squad host: global only.
   */
  memoryManage?: MemoryManage;
  /**
   * Required for `send_message` to create a UI bubble. 1:1 hosts bind this;
   * omit on squad (execute returns a clear error).
   */
  emitAssistantMessage?: EmitAssistantMessage;
  /**
   * Fired at the start of each auto-allow / post-HITL tool execute (except
   * send_message / ask_assistant). Host seals visible live narration so
   * mid-run progress appears without waiting for done/abort.
   */
  onBeforeToolExecute?: () => void | Promise<void>;
  /**
   * Credentials for `generate_image` (same provider baseURL/apiKey as chat).
   * When omitted/unsupported, the tool reports a clear error if invoked.
   * Capability is auto-inferred: OpenAI/Azure host, or catalog dall-e·gpt-image.
   */
  imageApi?: ImageApiCredentials;
  /**
   * Owner `resources/` dir + id for generate_image media URLs, and for indexing
   * library files written under that dir (`generate_image`, `write_file`, `edit_file`).
   */
  imageAssets?: {
    ownerId: string;
    resourcesDir: string;
    /** Index into resources.jsonl after a successful library save (host-provided). */
    onSaved?: (info: { filePath: string; assetRel: string; title?: string }) => void;
  };
  /**
   * Host same-topic gate for write_file under owner resources/.
   * Return a tool error string to reject create of a colliding new path;
   * null/undefined allows. Same-path overwrite is decided by the host
   * (typically allowed). Remote computers skip this gate.
   */
  assertLibraryWriteAllowed?: (input: { filePath: string }) => string | null | undefined;
  /**
   * Shell + fs execution target. Default = local desktop host.
   * Skills + image gen always stay on the desktop host (not routed here).
   * Ignored when `computerRoute` is set (per-call routing).
   */
  backend?: ExecutionBackend;
  /**
   * Per-call computer selection. When set, shell/fs tools take an optional
   * `computer` argument and otherwise follow this route.
   */
  computerRoute?: ComputerRoute;
  /**
   * Built-in web tools config (`settings.web`).
   * Search needs provider + API key; fetch uses SSRF defaults unless allowPrivateNetwork.
   */
  web?: WebSettings;
};


/**
 * Whether the chat provider looks like an OpenAI-compatible Images API.
 * `buildTools` still registers `generate_image` when prefs enable it; this
 * result is used for model defaults and execute-time support checks.
 */
export function resolveImageCapability(
  imageApi?: ImageApiCredentials | null,
): ImageCapability | null {
  const baseURL = imageApi?.baseURL?.trim();
  if (!baseURL) return null;
  return inferImageCapability({
    baseURL,
    catalogModelIds: imageApi?.catalogModelIds,
    providerName: imageApi?.providerName,
  });
}

export function buildTools(
  prefs: ToolPreferences,
  security?: SecuritySettings,
  budget?: ToolRunBudget,
  options?: BuildToolsOptions,
) {
  const list = [];
  const resourcesDir = options?.imageAssets?.resourcesDir?.trim() || '';
  const workDir = resourcesDir ? ownerWorkDirFromResourcesDir(resourcesDir) : '';
  const route = options?.computerRoute;
  const inputGuardrails = buildToolInputGuardrails(security ?? DEFAULT_SECURITY, {
    resourcesDir: resourcesDir || null,
    workDir: workDir || null,
    computerRoute: route ?? null,
  });
  const outputGuardrails = buildToolOutputGuardrails(security ?? DEFAULT_SECURITY);
  const guardrailOpts = {
    ...(inputGuardrails.length ? { inputGuardrails } : {}),
    ...(outputGuardrails.length ? { outputGuardrails } : {}),
  };
  const backend =
    options?.backend ??
    createLocalExecutionBackend({
      resourcesDir: resourcesDir || null,
      workDir: workDir || null,
    });
  const where = route ? defaultComputerLabel(route) : backend.label || '本机';
  const onBeforeToolExecute = options?.onBeforeToolExecute;
  /** Local wrap: always attach tool-boundary seal hook when provided. */
  function wrapExec<TArgs, TResult>(
    name: string,
    execute: (args: TArgs) => Promise<TResult> | TResult,
  ): (args: TArgs) => Promise<TResult> {
    return wrapToolExecute(name, budget, execute, onBeforeToolExecute);
  }
  // OpenAI strict tool schemas: optional params need `.nullable()` (not bare `.optional()`).
  const computerParam = z
    .string()
    .nullable()
    .optional()
    .describe('目标电脑的 id 或名称。省略时：用户只点了一台就用那台，否则用默认电脑。用户点了多台时必填。');

  function backendFor(requested?: string): ExecutionBackend | string {
    const req = (requested || '').trim();
    if (!route) {
      if (req) return `当前会话没有电脑路由，不能按 computer=${req} 执行。`;
      return backend;
    }
    const picked = selectComputerForTool(route, requested);
    if (!picked.ok) return picked.message;
    return resolveExecutionBackend({
      computerId: picked.id,
      computers: route.computers,
      resourcesDir: resourcesDir || null,
      workDir: workDir || null,
    });
  }

  function localFsForComputer(computer?: string | null): boolean {
    if (!route) return true;
    const picked = selectComputerForTool(route, computer);
    if (!picked.ok) return false;
    return picked.id === 'local';
  }

  /** Index a successful local write/edit under owner resources/ into resources.jsonl. */
  function indexLibraryWriteIfNeeded(filePath: string, computer?: string | null): void {
    const assets = options?.imageAssets;
    if (!assets?.onSaved) return;
    const target = resolveOwnerLibraryIndexTarget({
      filePath,
      resourcesDir: assets.resourcesDir,
      ownerId: assets.ownerId,
      localFs: localFsForComputer(computer),
    });
    if (!target) return;
    try {
      assets.onSaved(target);
    } catch (err) {
      console.error('[okbot] library file index failed', err);
    }
  }

  const shellHint = route
    ? '按目标电脑系统选择 shell（Windows：PowerShell Core / cmd；macOS/Linux：系统 shell）'
    : process.platform === 'win32'
      ? 'Windows 优先 PowerShell Core，找不到时用 cmd'
      : '系统 shell（如 zsh / bash）';

  if (prefs.run_shell.enabled) {
    list.push(
      tool({
        name: 'run_shell',
        description: route
          ? `在电脑上执行一条命令（默认「${where}」；${shellHint}）。用户点名电脑时传 computer（id 或名称）；点了多台时每次都要传。危险命令会先请求批准。`
          : `在「${where}」通过系统命令行执行一条命令（${shellHint}）。仅在用户明确需要时使用；危险命令会先请求用户批准。`,
        parameters: z.object({
          command: z.string().describe('要执行的命令'),
          cwd: z
            .string()
            .nullable()
            .optional()
            .describe(
              workDir
                ? `可选工作目录，支持 ~；省略时默认当前助手/小队 temp/（${workDir}/temp）；持久状态勿覆盖；资料库用 resources/…`
                : '可选工作目录，支持 ~；省略时默认用户主目录',
            ),
          computer: computerParam,
        }),
        needsApproval: prefs.run_shell.approval === 'ask',
        ...guardrailOpts,
        execute: wrapExec(
          'run_shell',
          async ({ command, cwd, computer }: { command: string; cwd?: string | null; computer?: string | null }) => {
            const target = backendFor(computer ?? undefined);
            if (typeof target === 'string') return target;
            return target.runShell(command, cwd ?? undefined, budget?.signal);
          },
        ),
      }),
    );
  }

  if (prefs.read_file.enabled) {
    list.push(
      tool({
        name: 'read_file',
        description: route
          ? `读取电脑上的一个文本文件（默认「${where}」）。用户点名电脑时传 computer。`
          : `读取「${where}」上的一个文本文件；相对路径默认在当前助手/小队工作根目录（资料用 resources/，临时用 temp/；shell 默认 cwd 为 temp/）。`,
        parameters: z.object({
          path: z
            .string()
            .describe(
              '文件路径：相对路径默认落到当前助手/小队工作根目录；资料库文件用 resources/…，临时脚本/产出用 temp/…；勿覆盖 session.jsonl 等持久状态；也可用绝对路径或 ~/…',
            ),
          computer: computerParam,
        }),
        needsApproval: prefs.read_file.approval === 'ask',
        ...guardrailOpts,
        execute: wrapExec(
          'read_file',
          async ({ path: filePath, computer }: { path: string; computer?: string | null }) => {
            const target = backendFor(computer ?? undefined);
            if (typeof target === 'string') return target;
            const content = await target.readFile(filePath);
            if (typeof content !== 'string') return content;
            // Error strings from the backend stay bare; only file bodies are untrusted.
            if (content.startsWith('错误：') || content.startsWith('Error:')) return content;
            return formatUntrusted(content);
          },
        ),
      }),
    );
  }

  if (prefs.read_skill.enabled) {
    list.push(
      tool({
        name: 'read_skill',
        description:
          '按 slug 加载本助手已启用技能的完整 SKILL.md 正文（含名称与描述）。系统提示仅含技能目录；当用户请求与某技能的名称或描述匹配时，必须先调用本工具再按正文执行，不要凭空发明步骤。',
        parameters: z.object({
          slug: z.string().describe('技能目录名（kebab-case slug，见系统提示技能目录）'),
        }),
        needsApproval: prefs.read_skill.approval === 'ask',
        ...guardrailOpts,
        execute: wrapExec(
          'read_skill',
          async ({ slug }: { slug: string }) => {
            const key = slug.trim();
            if (!key) return '错误：slug 不能为空';
            const lookup = options?.skillLookup;
            if (!lookup) {
              return '错误：当前会话未绑定技能查阅（无助手技能目录）。';
            }
            const skill = lookup(key);
            if (!skill) {
              return `错误：未找到已启用的技能「${key}」。请核对系统提示技能目录中的 slug。`;
            }
            const source = skill.global
              ? '来源：全局技能（~/.agents/skills）'
              : '来源：本助手技能';
            return truncate(
              [
                `# ${skill.name} (\`${skill.slug}\`)`,
                source,
                `何时使用：${skill.description}`,
                '',
                skill.body.trim() || '（正文为空）',
              ].join('\n'),
            );
          },
        ),
      }),
    );
  }

  if (prefs.search_history.enabled) {
    list.push(
      tool({
        name: 'search_history',
        description:
          '按关键词检索当前会话更早的聊天原文（仅本助手或本小队；不含其他会话）。摘要不够时用来找回细节。默认需要用户批准。',
        parameters: z.object({
          query: z.string().describe('要搜索的关键词或短句'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(20)
            .nullable()
            .optional()
            .describe('最多返回几条（默认 8，上限 20）'),
        }),
        needsApproval: prefs.search_history.approval === 'ask',
        ...guardrailOpts,
        execute: wrapExec(
          'search_history',
          async ({ query, limit }: { query: string; limit?: number | null }) => {
            const q = (query || '').trim();
            if (!q) return '错误：query 不能为空';
            const search = options?.historySearch;
            if (!search) {
              return '错误：当前会话未绑定历史检索。';
            }
            const cap = typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : 8;
            try {
              const body = truncate(await search(q, Math.min(20, Math.max(1, cap))));
              // History may contain pasted web/file text — fence like read_file / MCP.
              return formatUntrusted(body);
            } catch (err) {
              return `错误：检索失败 — ${err instanceof Error ? err.message : String(err)}`;
            }
          },
        ),
      }),
    );
  }

  if (prefs.manage_schedule.enabled) {
    list.push(
      tool({
        name: 'manage_schedule',
        description:
          '管理当前助手/小队的定时任务（到点后会像用户发消息一样唤醒一轮对话；定时轮次沿用当前工具审批/预算，无单独收紧）。action=create|list|pause|resume|delete。create 时传 schedule（如 daily 09:00、每天 09:00、hourly、every 15m、cron 0 9 * * 1-5）与 prompt；可选 title、timezone（IANA，省略则用 settings.timezone，再否则用运行 OkBot 的机器本地时区）、once。pause/resume/delete 传 job_id（或唯一 title）。未用到的可选字段请省略，不要传 null。create/delete 始终需要用户确认；list 不需确认。边界：明确时间/周期用本工具；无排期的当场事项/需求池用 manage_task_progress。',
        parameters: z.object({
          action: z
            .enum(['create', 'list', 'pause', 'resume', 'delete'])
            .describe('create / list / pause / resume / delete'),
          prompt: z.string().nullable().optional().describe('create：到点后发给本会话的提示词'),
          title: z.string().nullable().optional().describe('可选标题；pause/resume/delete 也可用来匹配唯一任务'),
          schedule: z
            .string()
            .nullable()
            .optional()
            .describe('create：daily 09:00 / 每天 09:00 / hourly / every 15m / cron 0 9 * * 1-5'),
          timezone: z.string().nullable().optional().describe('可选 IANA 时区，如 Asia/Shanghai'),
          job_id: z.string().nullable().optional().describe('pause/resume/delete：任务 id'),
          once: z.boolean().nullable().optional().describe('create：只触发一次后自动停用'),
        }),
        // create/delete always HITL (persistent self-wake / injection). Other actions follow pref.
        needsApproval: async (_ctx, input) => {
          const action =
            input && typeof input === 'object' && input !== null && 'action' in input
              ? String((input as { action?: unknown }).action || '')
              : '';
          // create/delete always HITL. list is read-only — never park a card.
          if (action === 'create' || action === 'delete') return true;
          if (action === 'list') return false;
          return prefs.manage_schedule.approval === 'ask';
        },
        ...guardrailOpts,
        execute: wrapExec(
          'manage_schedule',
          async (args: {
            action: 'create' | 'list' | 'pause' | 'resume' | 'delete';
            prompt?: string | null;
            title?: string | null;
            schedule?: string | null;
            timezone?: string | null;
            job_id?: string | null;
            once?: boolean | null;
          }) => {
            const manage = options?.scheduleManage;
            if (!manage) {
              return '错误：当前会话未绑定定时任务管理。';
            }
            try {
              return truncate(await manage(args));
            } catch (err) {
              return `错误：定时任务操作失败 — ${err instanceof Error ? err.message : String(err)}`;
            }
          },
        ),
      }),
    );
  }

  if (prefs.manage_task_progress.enabled) {
    list.push(
      tool({
        name: 'manage_task_progress',
        description:
          '管理当前助手/小队的多任务（持久 tasks.jsonl：一行一任务；add 追加；update 按任务 id 原地改写该行；list 查看）。主机不判断新任务/更新/取消——由你用本工具维护。任务 status=backlog|pending|in_progress|done（backlog=未做池，仅显式设置；出池设 pending）。步骤 status=pending|in_progress|blocked|succeeded|failed|cancelled（无 backlog；旧 done 已改为 succeeded）。推导：任一步 in_progress/blocked ⇒ 任务 in_progress；全部步骤终态 ⇒ 任务 done；全 pending ⇒ pending。整任务取消：update status=done（未终态步骤→cancelled，任务→done）。backlog 中禁止把步骤标 in_progress。按添加顺序串行推进。软接管后先 list/对照再继续。有可推进的未完成任务时自动继续；步骤 blocked 时暂停自动续跑。未用到的可选字段请省略，不要传 null。对用户只用产品语言（任务/未完成任务），不要说「队列」或工具名/tasks.jsonl。边界：有明确时间点或周期（明天9点、每周一、cron等）→用 manage_schedule，不要建成任务；当场要办或只记需求、无排期 →用本工具（可 backlog）。',
        parameters: z.object({
          action: z.enum(['add', 'update', 'list']).describe('add / update / list'),
          id: optionalToolId.describe('update：任务 id（ULID）；add：可选，须为 ULID，否则主机自动生成'),
          title: z.string().nullable().optional().describe('任务标题（add/update）'),
          note: z.string().nullable().optional().describe('任务备注（空字符串清除）'),
          status: z
            .enum(['backlog', 'pending', 'in_progress', 'done'])
            .nullable()
            .optional()
            .describe('任务状态；通常由步骤推导。backlog 仅显式入池；出池用 pending；done 取消/结束整任务'),
          steps: z
            .array(
              z.object({
                id: optionalToolId.describe('可选步骤 id；省略时主机生成 ULID'),
                title: z.string().describe('步骤标题'),
                status: z
                  .enum(['pending', 'in_progress', 'blocked', 'succeeded', 'failed', 'cancelled'])
                  .nullable()
                  .optional()
                  .describe('默认 pending；完成用 succeeded'),
                note: z.string().nullable().optional().describe('可选备注'),
              }),
            )
            .nullable()
            .optional()
            .describe('add：初始步骤；update：传入则整表替换步骤'),
          step_id: optionalToolId.describe('update：按步骤 id 单条更新'),
          step_title: z.string().nullable().optional().describe('update：按唯一步骤标题定位'),
          step_status: z
            .enum(['pending', 'in_progress', 'blocked', 'succeeded', 'failed', 'cancelled'])
            .nullable()
            .optional()
            .describe('update：步骤新状态（完成用 succeeded）'),
          step_note: z.string().nullable().optional().describe('update：步骤备注（空字符串清除）'),
          step_new_title: z.string().nullable().optional().describe('update：重命名步骤'),
          include_done: z
            .boolean()
            .nullable()
            .optional()
            .describe('list：true 时含已完成历史；默认仅未完成'),
        }),
        needsApproval: prefs.manage_task_progress.approval === 'ask',
        ...guardrailOpts,
        execute: wrapExec(
          'manage_task_progress',
          async (args: {
            action: 'add' | 'update' | 'list';
            id?: string | null;
            title?: string | null;
            note?: string | null;
            status?: 'backlog' | 'pending' | 'in_progress' | 'done' | null;
            steps?: Array<{
              id?: string | null;
              title: string;
              status?:
                | 'pending'
                | 'in_progress'
                | 'blocked'
                | 'succeeded'
                | 'failed'
                | 'cancelled'
                | null;
              note?: string | null;
            }> | null;
            step_id?: string | null;
            step_title?: string | null;
            step_status?:
              | 'pending'
              | 'in_progress'
              | 'blocked'
              | 'succeeded'
              | 'failed'
              | 'cancelled'
              | null;
            step_note?: string | null;
            step_new_title?: string | null;
            include_done?: boolean | null;
          }) => {
            const manage = options?.taskProgressManage;
            if (!manage) {
              return '错误：当前会话未绑定任务进度管理。';
            }
            try {
              return truncate(await manage(args));
            } catch (err) {
              return `错误：任务进度操作失败 — ${err instanceof Error ? err.message : String(err)}`;
            }
          },
        ),
      }),
    );
  }



  if (prefs.manage_note.enabled) {
    list.push(
      tool({
        name: 'manage_note',
        description:
          '管理当前助手/小队的笔记（持久 resources.jsonl + resources/*.html）。action=create|update|list|get。' +
          '用户只要「记一下 / 维护笔记 / 写设计稿/需求/报告」且无明确排期、也不是要你当场逐步执行的任务清单时，用本工具；不要建成 manage_task_progress 任务。' +
          'create：传 title 与完整自包含 html（inline CSS，可读浅色/深色优先，无重依赖；非报告类默认文首 TOC/大纲，href="#id" 对齐标题 id）。' +
          'update（维护同一篇）：传 id（或 path）与新的完整 html，可选 title。' +
          'list / get：查看已有笔记；不要把整库塞进对用户的回复。' +
          '未用到的可选字段请省略，不要传 null。对用户只用产品语言（笔记/已记下/已维护），不要说工具名或 resources.jsonl。',
        parameters: z.object({
          action: z.enum(['create', 'update', 'list', 'get']),
          title: z.string().nullable().optional().describe('笔记标题（列表/卡片不显示 .html）'),
          html: z
            .string()
            .nullable()
            .optional()
            .describe('完整自包含 HTML 文档（create/update 必填）'),
          id: z.string().nullable().optional().describe('update/get：笔记资源 id'),
          path: z
            .string()
            .nullable()
            .optional()
            .describe('update：资料库内绝对路径（与 id 二选一）'),
        }),
        needsApproval: prefs.manage_note.approval === 'ask',
        ...guardrailOpts,
        execute: wrapExec(
          'manage_note',
          async (args: {
            action: 'create' | 'update' | 'list' | 'get';
            title?: string | null;
            html?: string | null;
            id?: string | null;
            path?: string | null;
          }) => {
            const manage = options?.noteManage;
            if (!manage) return '错误：当前会话未绑定 manage_note。';
            return await manage(args);
          },
        ),
      }),
    );
  }

  if (prefs.manage_memory.enabled) {
    list.push(
      tool({
        name: 'manage_memory',
        description:
          '管理长期记忆：list / pin / unpin / promote / forget。候选记忆默认不注入提示词；置顶或提升为 durable 后才会常驻召回。forget 会物理删除（需确认）。scope 默认 bot；全局记忆用 scope=global。未用到的可选字段请省略。',
        parameters: z.object({
          action: z
            .enum(['list', 'pin', 'unpin', 'promote', 'forget'])
            .describe('list / pin / unpin / promote / forget'),
          memory_id: z.string().nullable().optional().describe('pin/unpin/promote/forget：记忆 id'),
          scope: z
            .enum(['global', 'bot'])
            .nullable()
            .optional()
            .describe('global=全局记忆，bot=本助手（默认）'),
          include_candidates: z
            .boolean()
            .nullable()
            .optional()
            .describe('list：为 true 时包含候选（默认只列 durable/pinned）'),
        }),
        needsApproval: async (_ctx, input) => {
          const action =
            input && typeof input === 'object' && input !== null && 'action' in input
              ? String((input as { action?: unknown }).action || '')
              : '';
          if (action === 'forget') return true;
          if (action === 'list') return false;
          return prefs.manage_memory.approval === 'ask';
        },
        ...guardrailOpts,
        execute: wrapExec(
          'manage_memory',
          async (args: {
            action: 'list' | 'pin' | 'unpin' | 'promote' | 'forget';
            memory_id?: string | null;
            scope?: 'global' | 'bot' | null;
            include_candidates?: boolean | null;
          }) => {
            const manage = options?.memoryManage;
            if (!manage) {
              return '错误：当前会话未绑定记忆管理。';
            }
            try {
              return truncate(await manage(args));
            } catch (err) {
              return `错误：记忆操作失败 — ${err instanceof Error ? err.message : String(err)}`;
            }
          },
        ),
      }),
    );
  }

  if (prefs.send_message.enabled) {
    list.push(
      tool({
        name: 'send_message',
        description:
          '向用户界面回复：① content=markdown 独立气泡（多条进度/确认）；② reactToMessageId+emoji=在用户气泡上放/清表情回应（不新增时间线）。纯表情回应只传 reactToMessageId+emoji，不要再传 content，也不要在最终流式回复里再输出同一个表情；下一轮也禁止把该表情当作正文重发，需表态则再次 react，否则写有字 content。简单确认、轻量情绪优先用表情回应，不必再写「好的/收到」。清除回应时必须显式传 emoji 为空字符串；仅传 reactToMessageId 会报错。不要把同一段文字既写入本工具又在最终流式回复里重复。未用到的可选字段请省略，不要传 null。',
        parameters: z.object({
          content: z
            .string()
            .optional()
            .describe('消息正文（markdown）。纯表情回应时省略'),
          reactToMessageId: z
            .string()
            .optional()
            .describe('用户气泡 id；与 emoji 一起传入时在该气泡放表情回应'),
          emoji: z
            .string()
            .optional()
            .describe('单个 emoji；与 reactToMessageId 一起用（必填）。空字符串=清除此前回应；省略会报错，不会清除'),
        }),
        // Never HITL: emitting a bubble must not park an approval card.
        needsApproval: false,
        ...guardrailOpts,
        execute: wrapExec(
          'send_message',
          async (args: {
            content?: string;
            reactToMessageId?: string;
            emoji?: string;
          }) => {
            const emit = options?.emitAssistantMessage;
            if (!emit) {
              return '错误：当前会话未绑定 send_message（仅 1:1 助手支持）。';
            }
            const content = typeof args?.content === 'string' ? args.content.trim() : '';
            const reactToMessageId =
              typeof args?.reactToMessageId === 'string' ? args.reactToMessageId.trim() : '';
            const emojiRaw = args?.emoji;
            const hasEmojiArg = typeof emojiRaw === 'string';
            const emoji = hasEmojiArg ? emojiRaw.trim() : undefined;
            if (!reactToMessageId && !content) {
              return '错误：请传 content，或传 reactToMessageId + emoji 做表情回应';
            }
            try {
              if (reactToMessageId) {
                if (!hasEmojiArg) {
                  return '错误：表情回应请传 emoji；清除时传 emoji 为空字符串 ""';
                }
                // Host drops content when it is solely this emoji / emoji-only.
                await emit({
                  reactToMessageId,
                  emoji,
                  ...(content ? { content } : {}),
                });
                const bits: string[] = [];
                bits.push(
                  emoji ? `已在用户气泡上回应 ${emoji}` : '已清除该气泡上的表情回应',
                );
                // Only claim a text bubble when content is non-emoji prose.
                if (content && content !== emoji) bits.push('并已回复消息');
                return `${bits.join('，')}。`;
              }
              await emit(content);
              return '已回复消息。';
            } catch (err) {
              return `错误：回复消息失败 — ${err instanceof Error ? err.message : String(err)}`;
            }
          },
        ),
      }),
    );
  }

  if (prefs.write_file.enabled) {
    list.push(
      tool({
        name: 'write_file',
        description: route
          ? `写入（覆盖）电脑上的一个文本文件（默认「${where}」）；必要时创建父目录。用户点名电脑时传 computer。`
          : `写入（覆盖）「${where}」上的一个文本文件；相对路径默认写到当前助手/小队工作根目录；交付资料用 resources/…，临时脚本/产出用 temp/…；禁止覆盖 session.jsonl / resources.jsonl / tasks.jsonl / memory.md 等持久状态；必要时创建父目录。适合新建文件或整文件重写。`,
        parameters: z.object({
          path: z
            .string()
            .describe(
              '文件路径：相对路径默认落到当前助手/小队工作根目录；资料库文件用 resources/…，临时脚本/产出用 temp/…；勿覆盖 session.jsonl 等持久状态；也可用绝对路径或 ~/…',
            ),
          content: z.string().describe('要写入的完整 UTF-8 文本内容'),
          computer: computerParam,
        }),
        needsApproval: prefs.write_file.approval === 'ask',
        ...guardrailOpts,
        execute: wrapExec(
          'write_file',
          async ({ path: filePath, content, computer }: { path: string; content: string; computer?: string | null }) => {
            const target = backendFor(computer ?? undefined);
            if (typeof target === 'string') return target;
            // Same-topic host gate (local resources/ only): block create of a
            // second file with the same filename/title; same-path overwrite OK.
            if (localFsForComputer(computer ?? undefined) && options?.assertLibraryWriteAllowed) {
              const blocked = options.assertLibraryWriteAllowed({ filePath });
              if (blocked?.trim()) return blocked.trim();
            }
            const result = await target.writeFile(filePath, content);
            indexLibraryWriteIfNeeded(filePath, computer ?? undefined);
            return result;
          },
        ),
      }),
    );
  }

  if (prefs.edit_file.enabled) {
    list.push(
      tool({
        name: 'edit_file',
        description: route
          ? `对电脑上已存在的文本文件做一次精确替换（默认「${where}」）。用户点名电脑时传 computer。匹配 0 次或多于 1 次则不改。`
          : `对「${where}」上已存在的文本文件做一次精确字符串替换（old_text → new_text）；相对路径默认在当前助手/小队工作根目录（资料 resources/，临时 temp/）；禁止改写 session.jsonl 等持久状态。适合小范围修改；若匹配 0 次或多于 1 次则报错不改。`,
        parameters: z.object({
          path: z
            .string()
            .describe(
              '文件路径：相对路径默认落到当前助手/小队工作根目录；资料库文件用 resources/…，临时脚本/产出用 temp/…；勿覆盖 session.jsonl 等持久状态；也可用绝对路径或 ~/…',
            ),
          old_text: z.string().describe('要替换的原文本（须在文件中恰好出现一次）'),
          new_text: z.string().describe('替换后的新文本'),
          computer: computerParam,
        }),
        needsApproval: prefs.edit_file.approval === 'ask',
        ...guardrailOpts,
        execute: wrapExec(
          'edit_file',
          async ({
            path: filePath,
            old_text,
            new_text,
            computer,
          }: {
            path: string;
            old_text: string;
            new_text: string;
            computer?: string | null;
          }) => {
            const target = backendFor(computer ?? undefined);
            if (typeof target === 'string') return target;
            const result = await target.editFile(filePath, old_text, new_text);
            indexLibraryWriteIfNeeded(filePath, computer ?? undefined);
            return result;
          },
        ),
      }),
    );
  }

  // Gate: prefs only (lockstep with listEnabledToolIds). Capability is checked at
  // execute time — same pattern as web_search when search is unconfigured.
  // Image gen always runs on the desktop host (not ExecutionBackend).
  // Uses the current chat provider only (no cross-provider fallback / private model switch).
  if (prefs.generate_image.enabled) {
    const imageCapability = resolveImageCapability(options?.imageApi);
    const models = imageCapability?.models?.length
      ? imageCapability.models
      : [...OPENAI_DEFAULT_IMAGE_MODELS];
    const defaultModel = imageCapability?.defaultModel || models[0]!;
    const modelHint = models.join(' / ');
    const protocolHint =
      imageCapability?.protocol === 'openai_images'
        ? `OpenAI 兼容 POST {baseURL}/images/generations（模型默认 ${defaultModel}）`
        : `使用当前对话供应商的 OpenAI 兼容 /images/generations（不支持则返回错误，不会改用其它供应商）`;
    const promptMax = '最长 4000 字符';
    list.push(
      tool({
        name: 'generate_image',
        description:
          `当用户要求画图/生成图片时必须调用本工具（不要用 SVG、ASCII、write_file 手绘或 data:image 代替）。${protocolHint}。可选模型：${modelHint}。图片保存到当前助手/小队目录的 resources/；工具结果含一行绝对网关路径 markdown（/v1/media/<ownerId>/resources/…），你必须原样写入回复以便气泡内嵌显示。失败时只如实转述本工具错误，禁止改用 data:、file://、外链 https 或手绘冒充。`,
        parameters: z.object({
          prompt: z
            .string()
            .describe(`图片的详细文本描述（${promptMax}）`),
          aspect_ratio: z
            .enum(IMAGE_ASPECT_RATIOS)
            .nullable()
            .optional()
            .describe('宽高比，默认 1:1（OpenAI 兼容接口会映射为 size）'),
          model: z
            .string()
            .nullable()
            .optional()
            .describe(`图像模型，默认 ${defaultModel}；可选：${modelHint}`),
        }),
        needsApproval: prefs.generate_image.approval === 'ask',
        ...guardrailOpts,
        execute: wrapExec(
          'generate_image',
          async ({
            prompt,
            aspect_ratio,
            model,
          }: {
            prompt: string;
            aspect_ratio?: (typeof IMAGE_ASPECT_RATIOS)[number] | null;
            model?: string | null;
          }) => {
            const creds = options?.imageApi;
            if (!creds?.baseURL?.trim() || !creds?.apiKey?.trim()) {
              return '错误：未配置模型供应商 baseURL/API Key，无法生成图片。请先在设置 → 模型接入中填写。不要用 SVG 或 data:image 冒充。';
            }
            if (!imageCapability) {
              return `错误：${GENERATE_IMAGE_UNSUPPORTED_MESSAGE}`;
            }
            const assets = options?.imageAssets;
            if (!assets?.ownerId?.trim() || !assets?.resourcesDir?.trim()) {
              return '错误：未绑定助手/小队 resources 目录，无法保存生成图片。';
            }
            try {
              const result = await generateImage(
                creds,
                {
                  prompt,
                  aspectRatio: aspect_ratio ?? undefined,
                  model: model ?? undefined,
                },
                {
                  ownerId: assets.ownerId,
                  resourcesDir: assets.resourcesDir,
                  capability: imageCapability,
                  signal: budget?.signal,
                },
              );
              try {
                assets.onSaved?.({
                  filePath: result.filePath,
                  assetRel: result.assetRel,
                  title: prompt.length > 80 ? `${prompt.slice(0, 77)}…` : prompt,
                });
              } catch (err) {
                console.error('[okbot] generate_image onSaved index failed', err);
              }
              return formatGenerateImageToolOutput(result);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              return `错误：图片生成失败 — ${msg}。不要用 SVG、ASCII 画、write_file 或 data:image 冒充文生图。`;
            }
          },
        ),
      }),
    );
  }

  if (prefs.web_fetch.enabled) {
    list.push(
      tool({
        name: 'web_fetch',
        description:
          '拉取一个公开网页的可读正文（HTML 会转成纯文本）。适合打开用户给出的 URL 或搜索结果链接。默认阻止本机/内网地址（SSRF）；超时与体积有上限。',
        parameters: z.object({
          url: z.string().describe('要拉取的 http(s) URL'),
        }),
        needsApproval: prefs.web_fetch.approval === 'ask',
        ...guardrailOpts,
        execute: wrapExec(
          'web_fetch',
          async ({ url }: { url: string }) => {
            try {
              const result = await webFetch(url, options?.web?.fetch, {
                signal: budget?.signal,
              });
              return truncate(formatWebFetchToolOutput(result));
            } catch (err) {
              return `错误：网页拉取失败 — ${err instanceof Error ? err.message : String(err)}`;
            }
          },
        ),
      }),
    );
  }

  if (prefs.web_search.enabled) {
    list.push(
      tool({
        name: 'web_search',
        description:
          '用用户在设置里配置的第三方搜索服务（Tavily / Brave / Serper）检索公开网页。未配置 API Key 时会返回明确错误，提示去设置 → 工具 → 网页填写。',
        parameters: z.object({
          query: z.string().describe('搜索关键词或短句'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(10)
            .nullable()
            .optional()
            .describe('最多返回几条（默认 5，上限 10）'),
        }),
        needsApproval: prefs.web_search.approval === 'ask',
        ...guardrailOpts,
        execute: wrapExec(
          'web_search',
          async ({ query, limit }: { query: string; limit?: number | null }) => {
            const q = (query || '').trim();
            if (!q) return '错误：query 不能为空';
            const searchCfg = options?.web?.search;
            if (!searchCfg?.apiKey?.trim()) {
              return webSearchNotConfiguredMessage();
            }
            try {
              const result = await webSearch(searchCfg, q, {
                limit: limit ?? undefined,
                signal: budget?.signal,
              });
              return truncate(formatWebSearchToolOutput(result));
            } catch (err) {
              return `错误：网页搜索失败 — ${err instanceof Error ? err.message : String(err)}`;
            }
          },
        ),
      }),
    );
  }

  return list;
}

export const TOOL_BLURBS: Record<string, string> = {
  run_shell: '执行命令',
  read_file: '读文件',
  read_skill: '加载技能正文',
  write_file: '新建/整文件覆盖写入',
  edit_file: '精确单处替换',
  generate_image: '文生图（OpenAI 兼容 /images/generations）',
  search_history: '搜索聊天记录',
  manage_schedule: '管理定时任务',
  manage_task_progress: '管理多任务（tasks.jsonl）',
  manage_note: '管理笔记（resources.jsonl）',
  manage_memory: '置顶/遗忘/提升记忆',
  send_message: '回复消息或表情回应',
  web_fetch: '拉取网页正文',
  web_search: '第三方网页搜索',
};

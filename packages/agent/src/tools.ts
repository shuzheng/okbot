import { tool } from '@openai/agents';
import { z } from 'zod';
import type { SecuritySettings, ToolPreferences } from '@okbot/shared';
import { DEFAULT_SECURITY } from '@okbot/shared';
import { buildToolInputGuardrails } from './guardrails.js';
import { wrapToolExecute, type ToolRunBudget } from './toolRunBudget.js';
import {
  formatGenerateImageToolOutput,
  generateImage,
  inferImageCapability,
  IMAGE_ASPECT_RATIOS,
  type ImageApiCredentials,
  type ImageCapability,
} from './generateImage.js';
import {
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
  prompt?: string;
  title?: string;
  schedule?: string;
  timezone?: string;
  job_id?: string;
  once?: boolean;
}) => Promise<string> | string;

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
   * Credentials for `generate_image` (same provider baseURL/apiKey as chat).
   * When omitted, the tool reports a config error if invoked.
   * Capability is auto-inferred from OpenAI host / OpenAI-style catalog models.
   */
  imageApi?: ImageApiCredentials;
  /**
   * Where to save generated images: bot/squad `resources/` dir + owner id for
   * `okbot-asset:<ownerId>/resources/…` markdown.
   */
  imageAssets?: { ownerId: string; resourcesDir: string };
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

export function buildTools(
  prefs: ToolPreferences,
  security?: SecuritySettings,
  budget?: ToolRunBudget,
  options?: BuildToolsOptions,
) {
  const list = [];
  const inputGuardrails = buildToolInputGuardrails(security ?? DEFAULT_SECURITY);
  const guardrailOpts = inputGuardrails.length ? { inputGuardrails } : {};
  const route = options?.computerRoute;
  const backend = options?.backend ?? createLocalExecutionBackend();
  const where = route ? defaultComputerLabel(route) : backend.label || '本机';
  const computerParam = z
    .string()
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
    return resolveExecutionBackend({ computerId: picked.id, computers: route.computers });
  }

  if (prefs.run_shell.enabled) {
    list.push(
      tool({
        name: 'run_shell',
        description: route
          ? `在电脑上执行一条命令（默认「${where}」；Windows 优先 PowerShell Core，找不到时用 cmd）。用户点名电脑时传 computer（id 或名称）；点了多台时每次都要传。危险命令会先请求批准。`
          : `在「${where}」通过系统命令行执行一条命令（Windows 优先 PowerShell Core，找不到时使用 cmd）。仅在用户明确需要时使用；危险命令会先请求用户批准。`,
        parameters: z.object({
          command: z.string().describe('要执行的命令'),
          cwd: z.string().optional().describe('可选工作目录，支持 ~'),
          computer: computerParam,
        }),
        needsApproval: prefs.run_shell.approval === 'ask',
        ...guardrailOpts,
        execute: wrapToolExecute(
          'run_shell',
          budget,
          async ({ command, cwd, computer }: { command: string; cwd?: string; computer?: string }) => {
            const target = backendFor(computer);
            if (typeof target === 'string') return target;
            return target.runShell(command, cwd, budget?.signal);
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
          : `读取「${where}」上的一个文本文件。`,
        parameters: z.object({
          path: z.string().describe('文件绝对路径或 ~/…'),
          computer: computerParam,
        }),
        needsApproval: prefs.read_file.approval === 'ask',
        ...guardrailOpts,
        execute: wrapToolExecute(
          'read_file',
          budget,
          async ({ path: filePath, computer }: { path: string; computer?: string }) => {
            const target = backendFor(computer);
            if (typeof target === 'string') return target;
            return target.readFile(filePath);
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
        execute: wrapToolExecute(
          'read_skill',
          budget,
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
            .optional()
            .describe('最多返回几条（默认 8，上限 20）'),
        }),
        needsApproval: prefs.search_history.approval === 'ask',
        ...guardrailOpts,
        execute: wrapToolExecute(
          'search_history',
          budget,
          async ({ query, limit }: { query: string; limit?: number }) => {
            const q = (query || '').trim();
            if (!q) return '错误：query 不能为空';
            const search = options?.historySearch;
            if (!search) {
              return '错误：当前会话未绑定历史检索。';
            }
            const cap = typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : 8;
            try {
              return truncate(await search(q, Math.min(20, Math.max(1, cap))));
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
          '管理当前助手/小队的定时任务（到点后会像用户发消息一样唤醒一轮对话；定时轮次沿用当前工具审批/预算，无单独收紧）。action=create|list|pause|resume|delete。create 时传 schedule（如 daily 09:00、每天 09:00、hourly、every 15m、cron 0 9 * * 1-5）与 prompt；可选 title、timezone（IANA，省略则用运行 OkBot 的机器本地时区）、once。pause/resume/delete 传 job_id（或唯一 title）。create/delete 始终需要用户确认。',
        parameters: z.object({
          action: z
            .enum(['create', 'list', 'pause', 'resume', 'delete'])
            .describe('create / list / pause / resume / delete'),
          prompt: z.string().optional().describe('create：到点后发给本会话的提示词'),
          title: z.string().optional().describe('可选标题；pause/resume/delete 也可用来匹配唯一任务'),
          schedule: z
            .string()
            .optional()
            .describe('create：daily 09:00 / 每天 09:00 / hourly / every 15m / cron 0 9 * * 1-5'),
          timezone: z.string().optional().describe('可选 IANA 时区，如 Asia/Shanghai'),
          job_id: z.string().optional().describe('pause/resume/delete：任务 id'),
          once: z.boolean().optional().describe('create：只触发一次后自动停用'),
        }),
        // create/delete always HITL (persistent self-wake / injection). Other actions follow pref.
        needsApproval: async (_ctx, input) => {
          const action =
            input && typeof input === 'object' && input !== null && 'action' in input
              ? String((input as { action?: unknown }).action || '')
              : '';
          if (action === 'create' || action === 'delete') return true;
          return prefs.manage_schedule.approval === 'ask';
        },
        ...guardrailOpts,
        execute: wrapToolExecute(
          'manage_schedule',
          budget,
          async (args: {
            action: 'create' | 'list' | 'pause' | 'resume' | 'delete';
            prompt?: string;
            title?: string;
            schedule?: string;
            timezone?: string;
            job_id?: string;
            once?: boolean;
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

  if (prefs.write_file.enabled) {
    list.push(
      tool({
        name: 'write_file',
        description: route
          ? `写入（覆盖）电脑上的一个文本文件（默认「${where}」）；必要时创建父目录。用户点名电脑时传 computer。`
          : `写入（覆盖）「${where}」上的一个文本文件；必要时创建父目录。适合新建文件或整文件重写。`,
        parameters: z.object({
          path: z.string().describe('文件绝对路径或 ~/…'),
          content: z.string().describe('要写入的完整 UTF-8 文本内容'),
          computer: computerParam,
        }),
        needsApproval: prefs.write_file.approval === 'ask',
        ...guardrailOpts,
        execute: wrapToolExecute(
          'write_file',
          budget,
          async ({ path: filePath, content, computer }: { path: string; content: string; computer?: string }) => {
            const target = backendFor(computer);
            if (typeof target === 'string') return target;
            return target.writeFile(filePath, content);
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
          : `对「${where}」上已存在的文本文件做一次精确字符串替换（old_text → new_text）。适合小范围修改；若匹配 0 次或多于 1 次则报错不改。`,
        parameters: z.object({
          path: z.string().describe('文件绝对路径或 ~/…'),
          old_text: z.string().describe('要替换的原文本（须在文件中恰好出现一次）'),
          new_text: z.string().describe('替换后的新文本'),
          computer: computerParam,
        }),
        needsApproval: prefs.edit_file.approval === 'ask',
        ...guardrailOpts,
        execute: wrapToolExecute(
          'edit_file',
          budget,
          async ({
            path: filePath,
            old_text,
            new_text,
            computer,
          }: {
            path: string;
            old_text: string;
            new_text: string;
            computer?: string;
          }) => {
            const target = backendFor(computer);
            if (typeof target === 'string') return target;
            return target.editFile(filePath, old_text, new_text);
          },
        ),
      }),
    );
  }

  // Gate: prefs switch AND provider inferred to support OpenAI-compatible images API.
  // Image gen always runs on the desktop host (not ExecutionBackend).
  const imageCapability: ImageCapability | null = options?.imageApi?.baseURL?.trim()
    ? inferImageCapability({
        baseURL: options.imageApi.baseURL,
        catalogModelIds: options.imageApi.catalogModelIds,
        providerName: options.imageApi.providerName,
      })
    : null;

  if (prefs.generate_image.enabled && imageCapability) {
    const modelHint = imageCapability.models.join(' / ');
    list.push(
      tool({
        name: 'generate_image',
        description:
          `当用户要求画图/生成图片时调用。使用当前模型供应商的 baseURL + API Key，调用 OpenAI 兼容 POST {baseURL}/images/generations（模型默认 ${imageCapability.defaultModel}）。可选模型：${modelHint}。图片保存到当前助手/小队目录的 resources/；工具结果含一行 okbot-asset: markdown，你必须原样写入回复以便气泡内嵌显示。`,
        parameters: z.object({
          prompt: z
            .string()
            .describe('图片的详细文本描述（最长 4000 字符）'),
          aspect_ratio: z
            .enum(IMAGE_ASPECT_RATIOS)
            .optional()
            .describe('宽高比，默认 1:1（映射为 OpenAI Images size）'),
          model: z
            .string()
            .optional()
            .describe(`图像模型，默认 ${imageCapability.defaultModel}；可选：${modelHint}`),
        }),
        needsApproval: prefs.generate_image.approval === 'ask',
        ...guardrailOpts,
        execute: wrapToolExecute(
          'generate_image',
          budget,
          async ({
            prompt,
            aspect_ratio,
            model,
          }: {
            prompt: string;
            aspect_ratio?: (typeof IMAGE_ASPECT_RATIOS)[number];
            model?: string;
          }) => {
            const creds = options?.imageApi;
            if (!creds?.baseURL?.trim() || !creds?.apiKey?.trim()) {
              return '错误：未配置模型供应商 baseURL/API Key，无法生成图片。请先在设置 → 模型接入中填写。';
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
                  aspectRatio: aspect_ratio,
                  model,
                },
                {
                  ownerId: assets.ownerId,
                  resourcesDir: assets.resourcesDir,
                  capability: imageCapability,
                  signal: budget?.signal,
                },
              );
              return formatGenerateImageToolOutput(result);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              return `错误：图片生成失败 — ${msg}`;
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
        execute: wrapToolExecute(
          'web_fetch',
          budget,
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
            .optional()
            .describe('最多返回几条（默认 5，上限 10）'),
        }),
        needsApproval: prefs.web_search.approval === 'ask',
        ...guardrailOpts,
        execute: wrapToolExecute(
          'web_search',
          budget,
          async ({ query, limit }: { query: string; limit?: number }) => {
            const q = (query || '').trim();
            if (!q) return '错误：query 不能为空';
            const searchCfg = options?.web?.search;
            if (!searchCfg?.apiKey?.trim()) {
              return webSearchNotConfiguredMessage();
            }
            try {
              const result = await webSearch(searchCfg, q, {
                limit,
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
  search_history: '检索本会话历史',
  manage_schedule: '管理定时任务',
  web_fetch: '拉取网页正文',
  web_search: '第三方网页搜索',
};

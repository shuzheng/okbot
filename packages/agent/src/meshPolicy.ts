import { DEFAULT_MESH_SETTINGS, type MeshSettings } from '@okbot/shared';
import {
  formatPeerRosterSection,
  listEnabledToolIds,
  MESH_USER_FACING_REPLY_RULE,
  REPLY_STYLE_INSTRUCTION,
  USER_FACING_PRODUCT_LANGUAGE_RULE,
  type MeshPeerRosterEntry,
} from './instructions.js';
import { normalizeMarkdownHeadings } from './promptContext.js';
import type { ToolPreferences } from '@okbot/shared';
import type { SkillLookup } from './tools.js';

export type { MeshPeerRosterEntry };
export { formatPeerRosterSection };

export const MESH_ASK_TOOL_NAME = 'ask_assistant';

export type MeshPeerSpec = MeshPeerRosterEntry & {
  soulMd?: string;
  skillsText?: string;
  skillLookup?: SkillLookup;
  memoriesText?: string;
};

export type MeshRuntimeContext = {
  /** Nesting level (0 = root user turn). Informational; not capped. */
  depth: number;
  /** Call-chain bot ids (cycle prevention). */
  stack: string[];
};

export type MeshExchangeInfo = {
  kind: 'ask' | 'reply';
  /** Stable id pairing ask + reply for one peer hop (UI status row). */
  exchangeId: string;
  peerBotId: string;
  peerName: string;
  callerBotId: string;
  callerName: string;
  content: string;
  usage?: import('@okbot/shared').TokenUsage;
};

export function resolveMeshPeer(
  peers: MeshPeerRosterEntry[],
  assistant: string,
): { ok: true; peer: MeshPeerRosterEntry } | { ok: false; error: string } {
  const key = (assistant || '').trim();
  if (!key) return { ok: false, error: '未指定助手：请传入 assistant（名称或 id）。' };

  const byName = peers.filter((p) => (p.name || '').trim() === key);
  if (byName.length === 1) return { ok: true, peer: byName[0]! };
  if (byName.length > 1) {
    const ids = byName.map((p) => p.id).join('、');
    return {
      ok: false,
      error: `助手名称「${key}」有多人同名（id：${ids}）。请改用唯一 id。`,
    };
  }

  const byId = peers.filter((p) => p.id === key);
  if (byId.length === 1) return { ok: true, peer: byId[0]! };
  if (byId.length > 1) {
    return { ok: false, error: `助手 id「${key}」匹配到多人，请检查花名册。` };
  }

  const names = peers.map((p) => (p.name || '').trim() || p.id).filter(Boolean);
  const hint = names.length ? `可用：${names.join('、')}` : '当前没有其他助手';
  return { ok: false, error: `找不到助手「${key}」。${hint}。` };
}

export function canAskMeshPeer(input: {
  stack: readonly string[];
  targetId: string;
}): { ok: true } | { ok: false; error: string } {
  if (input.stack.includes(input.targetId)) {
    return {
      ok: false,
      error: `不能向调用链上的助手求助（会形成循环）。当前链：${input.stack.join(' → ')}。`,
    };
  }
  return { ok: true };
}

export function buildMeshCalleeInstructions(input: {
  calleeName: string;
  calleeDescription: string;
  callerName: string;
  soulMd?: string;
  skillsText?: string;
  memoriesText?: string;
  prefs: ToolPreferences;
  peerRoster?: MeshPeerRosterEntry[];
  askEnabled: boolean;
  computerRouting?: string;
  imageCapable?: boolean;
}): string {
  const roleLine = `你正在协助助手「${input.callerName || '同事'}」完成子任务。直接给出可用结果，不要扮演用户，也不要向用户闲聊。`;
  const askLine = input.askEnabled
    ? '若子任务明显匹配另一名助手的描述，优先向该助手求助；不要向调用链上已出现的助手求助；仅在没有合适伙伴、伙伴失败或任务琐碎无关时才亲自做。'
    : '你不能再向其他助手求助；请亲自完成任务。'
  const userFacing = MESH_USER_FACING_REPLY_RULE;
  const roster =
    input.askEnabled && input.peerRoster && input.peerRoster.length
      ? formatPeerRosterSection(input.peerRoster)
      : '';
  const enabled = listEnabledToolIds(input.prefs, { imageCapable: input.imageCapable === true });
  const toolLine = enabled.length
    ? `你当前可用的本机工具：${enabled.join('、')}。`
    : '当前没有启用任何本机工具，请直接回答。';

  return normalizeMarkdownHeadings(
    [
      `你是「${input.calleeName || 'OkBot'}」，本机个人助手。`,
      roleLine,
      input.calleeDescription?.trim() ? `对外简介：${input.calleeDescription.trim()}` : '',
      input.soulMd?.trim()
        ? `以下是本助手的 SOUL.md（系统提示，须遵守）：\n\n${input.soulMd.trim()}`
        : '',
      input.memoriesText?.trim()
        ? `## 记忆（须遵守；过期项已过滤）\n\n${input.memoriesText.trim()}`
        : '',
      input.skillsText?.trim()
        ? `## Skills（目录；须先加载再遵循）\n\n下方为技能目录。匹配时须先调用 read_skill（传入 slug）加载完整正文再执行；有匹配技能时不要另起炉灶。\n\n${input.skillsText.trim()}`
        : '',
      REPLY_STYLE_INSTRUCTION,
      USER_FACING_PRODUCT_LANGUAGE_RULE,
      askLine,
      userFacing,
      roster,
      toolLine,
      input.computerRouting?.trim() || '',
    ]
      .filter(Boolean)
      .join('\n\n'),
  );
}

export function defaultMeshSettings(_partial?: Partial<MeshSettings>): MeshSettings {
  return { ...DEFAULT_MESH_SETTINGS };
}

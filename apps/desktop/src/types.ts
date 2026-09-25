import type { Bot, BotAvatarKind, BotAvatarShape, Squad } from '@okbot/shared';

export type Selection =
  | { kind: 'bot'; id: string }
  | { kind: 'squad'; id: string }
  | null;

export type SessionItem =
  | { kind: 'bot'; bot: Bot; updatedAt: string }
  | { kind: 'squad'; squad: Squad; updatedAt: string };

export type SquadWizardState = {
  /** Present when editing an existing squad. */
  id?: string;
  name: string;
  description: string;
  /** Ordered selected bot ids (drag order → squad.members order). */
  memberIds: string[];
  roles: Record<string, string>;
  /** Optional model override; both empty → global default. */
  providerId: string;
  modelId: string;
};

export type MenuState =
  | { kind: 'bot'; x: number; y: number; bot: Bot }
  | { kind: 'squad'; x: number; y: number; squad: Squad }
  | null;

export type RenameTarget =
  | { kind: 'bot'; id: string; name: string }
  | { kind: 'squad'; id: string; name: string }
  | null;

export type BotFormValues = {
  name: string;
  description: string;
  avatarKind: BotAvatarKind;
  emoji: string;
  color: string;
  botAvatarType: BotAvatarShape;
  providerId: string;
  modelId: string;
  /**
   * When Advanced AGENTS was edited, App writes this after updateBot
   * so it wins over syncAgentsMdProfile for that save.
   */
  agentsMd?: string | null;
  agentsMdTouched?: boolean;
  useGlobalSkills?: boolean;
  enabledGlobalSkills?: string[];
};

export type ToolCard = {
  requestId: string;
  messageId: string;
  toolName: string;
  arguments: unknown;
  status: 'pending' | 'approved' | 'denied';
  output?: string;
};

export type TurnPhase =
  | 'thinking'
  | 'replying'
  | 'awaiting_approval'
  | 'running_tool'
  | 'running_shell'
  | 'wrapping_up';

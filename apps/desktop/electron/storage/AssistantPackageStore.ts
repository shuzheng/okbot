import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { type Bot, type BotConfig, type BotRosterEntry, type BotSkill } from '@okbot/shared';
import {
  buildAssistantPackage,
  stripSecrets,
  type AssistantPackageContents,
} from '@okbot/agent';
import { ensureDir } from './fs';
import {
  writeAssistantPackageDir,
  readAssistantPackageDir,
  zipAssistantPackage,
  readAssistantPackageArchive,
} from './assistantPackageIo';
import type { OwnerLifecycle } from './ownerLifecycle';

export type AssistantPackageStoreDeps = {
  assertKnownBotId(botId: string): void;
  listRoster(): BotRosterEntry[];
  readBotConfig(botId: string): BotConfig;
  readSoulMd(botId: string): string;
  listSkills(botId: string): BotSkill[];
  createBot(input: {
    name: string;
    description?: string;
    emoji?: string;
    color?: string;
    avatarKind?: import('@okbot/shared').BotAvatarKind;
    botAvatarType?: import('@okbot/shared').BotAvatarShape;
  }): Bot;
  writeSoulMd(botId: string, content: string): void;
  writeSkill(botId: string, skill: BotSkill): void;
  writeBotConfig(config: BotConfig): void;
  deleteBot(id: string): void;
  listBots(): Bot[];
};

/** Export / import / install assistant packages (IO helpers in assistantPackageIo.ts). */
export class AssistantPackageStore {
  constructor(
    private readonly life: OwnerLifecycle,
    private readonly deps: AssistantPackageStoreDeps,
  ) {}

  /**
   * Export assistant install package (secrets stripped): avatar / name / persona /
   * SOUL.md / skills/. `targetPath` ends with `.okbot` → zip; otherwise directory.
   */
  exportAssistantPackage(botId: string, targetPath: string): { path: string } {
    this.deps.assertKnownBotId(botId);
    const roster = this.deps.listRoster().find((b) => b.id === botId);
    if (!roster) throw new Error('助手不存在');
    const config = this.deps.readBotConfig(botId);
    const soulMd = this.deps.readSoulMd(botId);
    const skills = this.deps.listSkills(botId);
    const pkg = buildAssistantPackage({
      name: roster.name,
      description: roster.description,
      avatar: {
        avatarKind: config.avatarKind,
        emoji: config.emoji,
        color: config.color,
        ...(config.botAvatarType ? { botAvatarType: config.botAvatarType } : {}),
      },
      soulMd,
      skills,
    });
    const clean = stripSecrets(pkg);
    const target = path.resolve(targetPath.trim());
    if (target.toLowerCase().endsWith('.okbot')) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-export-'));
      try {
        writeAssistantPackageDir(tmp, clean);
        zipAssistantPackage(tmp, target);
      } finally {
        try {
          fs.rmSync(tmp, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    } else {
      ensureDir(target);
      writeAssistantPackageDir(target, clean);
    }
    return { path: target };
  }

  /**
   * Import assistant package from folder or `.okbot` zip → new bot (no secrets).
   */
  importAssistantPackage(sourcePath: string): Bot {
    const src = path.resolve(sourcePath.trim());
    if (!fs.existsSync(src)) throw new Error('助手包路径不存在');
    const pkg = fs.statSync(src).isDirectory()
      ? readAssistantPackageDir(src)
      : readAssistantPackageArchive(src);
    return this.installAssistantPackage(pkg);
  }

  /** Create a bot from parsed package contents (file import and the built-in gallery). */
  installAssistantPackage(pkg: AssistantPackageContents): Bot {
    const clean = stripSecrets(pkg);
    const bot = this.deps.createBot({
      name: clean.manifest.name,
      description: clean.manifest.description,
      emoji: clean.manifest.avatar.emoji,
      color: clean.manifest.avatar.color,
      avatarKind: clean.manifest.avatar.avatarKind,
      botAvatarType: clean.manifest.avatar.botAvatarType,
    });
    try {
      if (clean.soulMd.trim()) {
        this.deps.writeSoulMd(bot.id, clean.soulMd);
      }
      for (const skill of clean.skills) {
        this.deps.writeSkill(bot.id, skill);
      }
      const cfg = this.deps.readBotConfig(bot.id);
      cfg.onboardingComplete = true;
      cfg.updatedAt = new Date().toISOString();
      this.deps.writeBotConfig(cfg);
      return this.deps.listBots().find((b) => b.id === bot.id) ?? bot;
    } catch (err) {
      try { this.deps.deleteBot(bot.id); } catch { /* leave the original error */ }
      throw err;
    }
  }
}

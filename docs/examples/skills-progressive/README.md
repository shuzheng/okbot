# 示例：Skills 渐进披露与热更新

## 行为说明

1. 系统提示里的 **Skills** 段只有目录（名称、slug、何时使用），**没有** SKILL.md 正文。
2. 模型匹配到技能后必须先调用 `read_skill({ slug })`，再按正文执行。
3. 在 `~/.okbot/<botId>/skills/<slug>/SKILL.md` 保存修改后，主进程通过 `fs.watch` 发出 `skills_changed`；**下一轮对话**自动读到新目录 / 新正文（无需重启 OkBot）。

## 中文操作步骤

1. 打开助手 → **高级** → 编辑或新增私有技能（例如 slug `okbot-demo-pack`）。
2. 用外部编辑器改同一 `SKILL.md` 的「何时使用」或 Steps，保存。
3. 回到对话，发送「按打包技能帮我导出」——模型应先 `read_skill`，再按**最新**正文执行。
4. （可选）在 Gateway 下用 SSE 观察事件流中的 `tool_result`（read_skill 输出含完整正文）。

## 自测命令

```bash
cd ~/git/github/okbot-dev
pnpm --filter @okbot/agent exec node --import tsx src/skills/catalog.test.ts
```

截图见同目录 `catalog-demo.png`、`hot-reload-demo.png`。

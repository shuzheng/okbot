# 示例：助手安装包导入 / 导出

## 包内容

```text
manifest.json     # format=okbot-assistant，名称/人设/头像元数据
AGENTS.md         # 可选
skills/<slug>/SKILL.md
```

`.okbot` 文件是上述目录的 zip。导出**不会**包含：API Key、token、session、记忆、供应商配置。

## 中文操作步骤

1. 侧栏右键任意助手 → **导出助手**，保存为 `demo.okbot`。
2. 侧栏 **+** → **导入助手**（在「新建小队」后面），选择该文件 → 侧栏会话列表自动出现新助手（头像/名称/指令/技能已恢复）。
3. 验证：新助手 **高级** 中可见相同 skills；设置里的模型密钥未被改写。

## 自测

```bash
# from the repository root
pnpm --filter @okbot/agent exec node --import tsx src/skills/catalog.test.ts
# 或跑脚本：
node --import tsx docs/examples/assistant-package/selftest.mjs
```

截图：`export-demo.png`、`import-demo.png`。

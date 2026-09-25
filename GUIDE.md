# OkBot 产品与开发指南

> 本文档描述 **当前已实现** 的产品能力与 UI 细节，供开发与联调对照。  
---

## 1. 产品定位

OkBot 是 **本机个人桌面 AI 助手**（Electron）：

- 左侧：助手 / 小队会话列表  
- 右侧：对话区（气泡、工具卡、输入框）  
- 数据纯文件落在 `~/.okbot`，无云端账号体系  
- **单实例**：主进程 `requestSingleInstanceLock()`；再启动会聚焦已有窗口（含后台隐藏时），不会开第二个进程  

技术栈：Electron + React + TypeScript + Vite（electron-vite）；pnpm monorepo（`apps/desktop`、`packages/agent`、`packages/shared`）；对话走 `@openai/agents`（Chat Completions / Responses）+ 兼容网关（如 DeepSeek）。

---

## 2. 仓库结构（关键路径）

```text
okbot/
  apps/desktop/                 # Electron 壳 + React UI
    electron/                   # main / preload / IPC / storage / updater
      ipc/                      # registerChat / registerEntity / registerSystem
      storage/                  # FileStorage、sessionJsonl、usageStore…
      updater.ts                # electron-updater + GitHub Releases
    src/
      App.tsx                   # 状态编排、会话切换、发消息、未读、更新条
      features/
        sidebar/                # SessionSidebar、宽度持久化、FLIP
        chat/                   # ChatTranscript、ChatComposer、Markdown、ToolCard
        voice/                  # MediaRecorder + on-device Whisper STT
        bots/                   # 新建/编辑助手、两步 onboarding
        squads/                 # 创建小队向导
        settings/               # SettingsModal、UsagePanel、AAR、模型编辑
        search/                 # 全局搜索（会话 / 设置 / 消息）
        about/                  # 关于对话框
      components/ui/            # FlatAvatar、SquadAvatar、Toast、icons
      styles/app.css            # 全局样式（气泡、侧栏、设置…）
      i18n.ts                   # zh / en
  packages/shared/              # 类型、默认设置、IPC channel 常量
  packages/agent/               # 跑对话、工具、小队、压缩、用量、转写
```

开发入口：`pnpm dev`（先 build shared/agent，再 desktop）。类型检查：`pnpm --filter @okbot/desktop typecheck`。开发服务器绑 `127.0.0.1`（避免部分 Mac `/etc/hosts` 缺 `localhost` 导致 `ENOTFOUND localhost`）；若其它工具仍解析失败，把 `127.0.0.1 localhost` 与 `::1 localhost` 写回 `/etc/hosts`。

---

## 3. 主界面布局

窗口：
- **macOS**：`titleBarStyle: 'hiddenInset'` + 系统红绿灯（`trafficLightPosition`），不显示自定义窗口按钮。
- **Windows**：`titleBarStyle: 'hidden'`（无系统标题栏），主顶栏操作区在「关于」右侧放自定义最小化 / 最大化(还原) / 关闭（`WindowControls`，仅 `platform === 'win32'`）。无会话时按钮浮在主区右上角。IPC：`windowMinimize` / `windowMaximizeToggle` / `windowClose` / `windowIsMaximized`（及 `windowMaximizedChanged` 推送）。
- **Linux**：保持改动前行为（既有 `titleBarStyle` + `autoHideMenuBar` / 隐藏应用菜单）；不加 Windows 式自定义窗口控件。
- **Windows / Linux** 均设 `autoHideMenuBar: true` 隐藏系统原生 File/Edit/View 菜单栏。 Windows 用最小 **Edit** 子菜单（undo/redo/cut/copy/paste/selectAll；**不要** `null`——会破坏 IME；空 `[]` 在部分 Electron 上仍缺 Edit role）； Linux 仍 `Menu.setApplicationMenu(null)`。
- **BotFormModal / SquadWizardModal**：右侧抽屉（`.drawer-backdrop` + `.form-drawer` / `.modal.form-drawer`），与左侧边栏同为**通高**：贴齐视口上/下/右缘、无浮动短面板边距与圆角；标题栏粘性固定（**无**底部分割线），关闭钮为 **»** 形双 chevron（`ChevronsRightIcon`，指向右=收起抽屉），正文滚动。autoApply：名称/描述在 IME `composition` 期间不 `onApply`，结束后/失焦再持久化，并 350ms 防抖；Windows 聚焦名称不 `select()`。backdrop / drawer / 表单控件显式 `-webkit-app-region: no-drag`。
- **删除确认**：助手/小队/供应商/模型删除使用应用内 `ConfirmHost` + `requestConfirm`（`components/ui/ConfirmModal`），不用系统 `window.confirm`；主进程 `dialog.showMessageBox` 仅用于自动更新/退出等 OS 流程。

### 3.1 侧栏（`features/sidebar`）

- **展开态**：搜索、会话列表（助手 + 小队）、底部 FAB（搜索 / 设置 / 创建菜单）。会话行名称右上角显示**上次更新时间**（`formatSessionUpdatedAt`，用 `SessionItem.updatedAt`）：当天 `HH:mm`；昨天 `昨天 HH:mm`（EN: `Yesterday HH:mm`）；一周内为星期（`星期x` / EN 本地化短星期）；一月内为 `MM/DD`；更早为 `YYYY/MM/DD`。次要 muted 文案，不挤占标题/未读。  
- **折叠态**：窄轨头像列表；悬停约 **500ms** 后显示 dock tip；底部紧凑 FAB。Mac Dock 式头像放大动效默认**关闭**（`settings.sidebarDockMagnify`，设置 → 通用 →「缩放特效」）；仅开关打开时才缩放。  
- **宽度**：可拖拽，上限约 **400px**；点击 splitter 可折叠/展开；宽度持久化（`sidebarPersistence`）。  
- **创建菜单**：创建助手 / 创建小队（独立图标）。  
- **会话项**：头像 + 名称 + 最近回复预览；右键：置顶 / 改名 / 资料 / 删除。  
- **未读回复**：非当前会话、且该会话 `hasUnreadReply` 且不在「工作中」时，头像外壳加 **unread 脉冲光晕**（`session-avatar-shell.unread`，文案 `unreadReply`）。切回会话会清未读（IPC `setChatUnread`）。  
- **小队头像**：`SquadAvatar` 田字格拼接成员 emoji/颜色（不强制 bot-avatar 造型）。

### 3.2 对话区顶栏

- 当前会话名；主题循环按钮（`system` / `light` / `dark`）。 `system` 会解析成具体的 `data-theme="light|dark"`（`matchMedia` + 主进程 `nativeTheme.updated` IPC），避免仅依赖移除属性时部分样式无 `@media (prefers-color-scheme)` 双生而混色。  
- **关于**：主题按钮右侧打开 `AboutModal`（应用信息、构建日期、复制信息）。  
- **窗口控件（仅 Windows）**：关于按钮右侧为最小化 / 最大化(还原) / 关闭；macOS 仍用系统红绿灯，Linux 不加这组控件。  
- **下载更新**：有可用/下载中/已下载更新时，主题按钮左侧出现更新按钮（见 §10）。
- **沉浸式对话**：控制不在顶栏，而在消息/转录区域（`.messages-shell`）**右下角**悬停浮层按钮（Maximize2 / Minimize2 图标）。鼠标进入消息/转录区域时淡入，离开时淡出（`opacity` 过渡；不可见时 `pointer-events: none` 不挡点击）。点击隐藏侧栏与 splitter（聊天区全宽）；再点还原侧栏（保留进入前的宽度/折叠轨态）。偏好持久化 `localStorage` 键 `okbot.immersiveChat`。文案：`开启沉浸式对话` / `关闭沉浸式对话`（EN: Enable / Exit immersive chat）。
- **macOS 沉浸式顶栏 inset**：沉浸且侧栏隐藏时，对话顶栏在 darwin 上增加左侧安全区（`--traffic-lights-inset: 76px`），避免助手头像/名称与系统红绿灯重叠；Windows / Linux 不加该左 padding。

### 3.3 消息列表（`ChatTranscript`）

- 分页上滑加载更早消息（`MESSAGE_PAGE_SIZE = 50`；游标为 `beforeMessageId` / `nextBeforeMessageId`，避免 jsonl 整文件重写后字节 offset 失效）。  
- **用户气泡**（右对齐）：  
  - 可选引用条（`bubble-quote`）在上；  
  - `bubble-body-row`：左侧悬停操作 + 右侧气泡。  
  - 悬停操作（左→右）：**复制**、查看本轮 Prompt 上下文、引用。  
  - 操作按钮用 `margin-top: 6px` 与气泡 **第一行文字** 光学垂直居中。  
- **助手气泡**（左对齐）：布局是用户侧的 **镜像**——`bubble-body-row-assistant` 内先气泡、后操作（token 用量 / 引用 / **复制**），同一套 `margin-top: 6px`，**不要**再用 absolute 叠在气泡角上。  
- 小队助手气泡：成员用对应 bot 的 `FlatAvatar`（`.bubble-speaker-avatar` 在 `.messages` 内 `position: sticky; top: 0`，长消息滚动时头像贴住视口顶，直到该条 `bubble-row` 滚出）；**队长气泡不渲染头像**（无 `has-speaker` 间距，气泡左对齐）。侧栏/列表 `SquadAvatar` 不变。  
- Markdown 渲染、代码块复制；工具调用以 `ToolCardView` 插入在对应消息附近。  
- 会话顶栏「本轮轨迹」：查看该助手/小队最近一轮 `last-run-trace.json`（只读弹层）。  
- 发送时可**自动换题压缩**（见 §8.4；设置可关）。  
- **流式性能**：`delta` 经 `requestAnimationFrame` 合并后再 `setState`（侧栏预览 + 气泡）；`MarkdownContent` / `CodeBlock` / `ChatTranscript` / `SessionSidebar` 用 `memo`，已完成气泡不因后续 token 重解析。  
- 忙碌时底部 ThinkingOrb + 阶段文案（思考中 / 正在回复 / 工具与命令 / **正在收尾**——`done` 后、`chatStart` IPC 返回前的 persist 与 AGENTS/skills/memory 刷新）；可「跳到底部」。
- **贴底滚动**：用户未主动上滑时，流式 delta / 工具卡片 / Markdown 布局增高会通过 `ResizeObserver` + `MutationObserver` + 双 `rAF` 继续钉在底部；程序化滚动用 `pinningScrollRef` 忽略，避免误判「已离开底部」。距底 ≤48px 视为贴底，距底 >80px 才显示「回到底部」（滞回，消化亚像素抖动）。发送（含中途改向）会强制重新贴底；用户上滑后不抢滚动。

### 3.4 输入区（`ChatComposer`）

- 多行输入；空闲时描边强调。  
- **引用草稿**：上方 quote 条（可关闭）；发送时写入 `quoteMessageId` + `quotePreview`（**不**把 `>` 拼进正文）。  
- **麦克风**：点击开始录音，再点停止；`MediaRecorder` 采集音频 → 渲染进程 **本地 Whisper**（`@xenova/transformers` + 内置 `whisper-tiny`）转写写入 Composer；`VoiceBeam` 可视化。**不**走 Google Web Speech，也**不**走 provider `/audio/transcriptions`。需系统麦克风权限；识别可离线。失败时有模型加载 / 识别错误的中英提示。  
- **发送 / 停止（中途改向）**：忙碌时输入框仍可编辑；有草稿时可继续发送（中途改向），Enter 同样可发送（尊重 IME）。**停止**保持独立：忙碌且草稿为空只显示停止；忙碌且有草稿时 **停止 + 发送** 同时显示。发送不会仅因忙碌而灰掉。BorderBeam / busy 一直保持到**最外层**运行真正结束（改向中途不会提前熄灭）。
- **发送失败重试**：乐观用户气泡带渲染期 `sendStatus`（`pending` | `sent` | `failed`，不落盘）。`chatStart` / `chatStartSquad`（含中途改向）拒绝或抛错时，气泡保留并在**右下角**显示红色重试按钮（i18n `retrySend`）；点击以原文 + 引用（若有）重发。失败时不再用 `getMessagesPage` 整页替换把本地气泡冲掉。

---

## 4. 助手（Bot）

### 4.1 生命周期

- 花名册：`~/.okbot/bots.json`；详情：`~/.okbot/<botId>/bot.json`。  
- **新建** → 两步 onboarding（场景 / 期望协作方式）写入 `AGENTS.md`。场景 chips：编程调试、内容创作、数据分析、日常助理、学习答疑、翻译润色、办公文档、资料检索、产品需求、运维排障、其他（id 为自由字符串，`finishBotOnboarding` 照常）。首次**成功完成**的对话会软关闭 onboarding；用户中途停止（`done.aborted`）不会标记完成。  
- 编辑资料：名称、描述、头像、颜色、可选 **模型覆盖**（`providerId` + `modelId`，皆空则用全局默认；同模型 id 可跨供应商）。  
- 资料弹层底部 **高级**（默认折叠）：**指令**（本助手 `AGENTS.md`）；**记忆**（限高列表，仅本助手；全局记忆在设置 → 记忆）；**私有技能**（限高列表编辑/删除本助手 Skills）；**全局技能**总开关（默认关）+ 按 slug 选用 `~/.agents/skills`（`bot.json`：`useGlobalSkills` / `enabledGlobalSkills`）。  
- 系统提示：`AGENTS.md`（引导写入 + 高级可编 + 跑后静默维护）；Skills：**渐进披露**——目录（名称 / slug / 何时使用）进系统提示，完整正文经 `read_skill` 按需加载（本助手 `skills/<slug>/SKILL.md` + 可选全局）；记忆：全局 `memory.md`（设置 → 记忆）+ 每助手 `memory.md`（JSONL）。

### 4.2 双轨头像（`avatarKind`）

| 模式 | 含义 | UI |
|------|------|-----|
| `bot-avatar`（**默认**，切换条左侧） | libraries.dev **bot-avatars** 立体造型 | 18 种 shape（clover/flower/…/puddle），可选颜色覆盖（含纯白）；工作态可用 `state="working"` |
| `emoji`（可选，切换条右侧） | Emoji + 可选背景色 | `FlatAvatar`；「默认」= 无色块（透明） |

创建/编辑为**右侧抽屉**（粘性标题栏 + 可滚动正文）：立体头像默认；悬停头像预览显示 **»** 形双 chevron（收起态向下 / 展开态向上，无文字）；emoji 预设、「更多」全量选择器、颜色板（一行，**「默认」打头** + 预设色含 `#FFFFFF`）；`avatarKind` 切换与 `botAvatarType` 选择。两边的「默认」均存空字符串 `color === ''`（立体头像→库默认色；emoji→无背景）。从立体头像「默认」切到 emoji **不**再 hash 出随机色。缺省 / 未知 `avatarKind` 读时归一为 `bot-avatar`（无双格式 shim）。新建助手时立体头像随机一种形状，颜色用库默认（不预选色板）。

立体头像：`.flat-avatar-bot` **不**裁剪库的 1.5× overscan（跳动/翻转要画到布局盒外）。侧栏 `session-list` 加大上下 padding，会话行 `overflow: visible` + 提高 z-index，避免被列表/`sidebar` 的 overflow 或邻行背景切掉（误看起来像头像框裁切）。`bot-avatars` 经 pnpm patch：去掉「不可见即停动画」的 IntersectionObserver（侧栏 overflow 会误判 overscan canvas），挂载期间保持闲置/工作动画。

---

## 5. 小队（Squad）

- 星型拓扑：**内置虚拟队长**（非花名册 bot，`SQUAD_CAPTAIN_SPEAKER_ID = '__captain__'`）通过 Agents-as-Tools（`ask_*`）串行咨询成员。  
- 队员工具名经 `allocateAskToolNames` 去重（`ask_base`、`ask_base_2`…）；队长 prompt 的 `toolHint` 与真实工具名一致（含后缀）。  
- 数据：`~/.okbot/squads.json` + `~/.okbot/<squadId>/session*.`。  
- **创建向导**（`SquadWizardModal` 右侧抽屉）：名称、描述、成员（搜索拖拽）、每成员角色、可选小队模型。  
- **设置 → 系统指令**：子 Tab 助手 / 小队 / AGENTS.md / 记忆 / 技能（角色句、小队人设、AGENTS/skills/记忆静默刷新的 system 与窗口条数）。  
  - 默认队长人设强调编排与把关（目标约束、角色边界、中立务实、效率可控、结果负责）；空字符串会回落到 `DEFAULT_SQUAD_CAPTAIN_PERSONA`。已写入 `settings.json` 的自定义文案不会被新默认覆盖。  
  - 默认 Playbook 覆盖准备→澄清→拆解→路由→校验→冲突→汇总→异常→边界→跨队员传递；空字符串回落 `DEFAULT_SQUAD_PLAYBOOK`，已存自定义同样不覆盖。  
- 会话 UI：成员呼叫/回复气泡带 speaker 头像；队长终泡无头像。列表仍用 `SquadAvatar`。队长分段封印后若终泡为空，聚合 usage 挂到最后一段已封印队长气泡；用量统计只记在小队 owner（不向成员 byOwner 分摊）。  
- 全局搜索 **排除** 小队聊天消息（仅助手私聊消息可搜）。  
- **中途改向（steer）**：`chatStart`（1:1 与小队）对同一 owner 不再硬拒绝并发。策略为 **abort + restart**（`@openai/agents` 无可靠 mid-query inject）：先 `appendMessage` 落盘新用户消息 → 中止当前运行（含进行中的 HITL 审批等待，reject 为已取消并清 disk pending）→ 等上一 handler 链结束 → 若仍是最新一次发送则立即以完整历史开新跑；被更新发送/停止 supersede 的请求只保留用户消息、不开跑。显式 **停止**（`chatAbort`）会 bump 代次以取消排队中的改向重启。每 owner 同时仅一条 in-flight agent run。被中止的旧跑以 `done.aborted` 正常结束（**不**再把 AbortError 抛回 `ipcRenderer.invoke`），避免连发时出现 `Request was aborted` 红字失败。

实现：`packages/agent/src/squad.ts`（`runSquadChat` + 导出 `buildCaptainSquadInstructions` / `allocateAskToolNames` + `onSquadExchange`）；压缩共用 `apps/desktop/electron/storage/sessionCompression.ts`。

---

## 6. 设置（`SettingsModal`）

左侧导航 Tab：

| Tab（侧栏文案） | 内容 |
|-----|------|
| **通用设置** | 主题（系统/浅/深）、语言（系统/中/英）、缩放特效（默认关；? 说明仿 MacOS Dock 动效）、麦克风、硬件加速（改后需重启）、数据目录说明（**不含**更新控件） |
| **工具授权** | 五工具启用 + 审批策略（自动允许 / 询问；含 `read_skill`）；**自动审批规则（AAR）** 列表（允许/先询问、关键词、失焦自动保存草稿；空规则丢弃；重名校验；列表限高滚动）；**运行限制**（`settings.toolRun`：单轮最大工具调用 / 最大时长秒 / 记录运行轨迹，见下） |
| **安全防护** | 总开关、拦截模式（reject / tripwire）、限制在家目录、允许/拒绝路径前缀、危险 shell 正则；与审批关系说明 |
| **模型接入** | **自定义供应商**（可多条：名称 / BaseURL / API Format / API Key / 每供应商模型目录）；模型行**连通测试**（按该供应商 baseURL/apiKey/apiFormat 对模型 id 发最小探针，IPC `testModelConnection`）；全局**默认模型**（下方下拉，供应商→模型；列表行不再用星标设默认）；列表顺序稳定（存盘数组序，启停不重排）；助手/小队覆盖同为 `providerId`+`modelId`；上下文压缩（自动换题、比例、保留上下限默认 5、摘要字数）、**单次运行最大回合**（1:1 `maxTurns`，默认 50） |
| **系统指令** | 子 Tab 顺序：助手 / 小队 / AGENTS.md / 记忆 / 技能。「助手」：1:1 角色句模板（`settings.instructions.assistantRoleTemplate`，`{name}` 占位，空则恢复默认）；「小队」：队长人设、Playbook、队长/队员 maxTurns（`settings.squad`，与 1:1 无关）；「AGENTS.md」：静默维护完整 system 模版（`agentsMdRefreshSystemPrompt`）+ 分析最近消息条数（`agentsMdRecentMessageLimit`，默认 12，钳制 1–100）；「记忆」：范围判定说明（`settings.memory.scopeInstruction`）+ 分析最近消息条数（`recentMessageLimit`，默认 20）；「技能」：生成/更新 skill 判定指令（`skillsCreateUpdateInstruction`，仅替换 system 中那一行）+ 分析最近消息条数（`skillsRecentMessageLimit`，默认 20）。空字符串恢复默认；缺字段读盘时由 normalize 填回，下次保存写回。侧栏图标为文档形（与小队区分）。 |
| **全局记忆** | **全局记忆**列表（`~/.okbot/memory.md`，增删改，限高滚动）。scope 判定说明已迁至 **系统指令 → 记忆**。助手资料抽屉 **高级 → 记忆** 仍只管理本助手记忆 |
| **用量分析** | 见 §9；按助手/小队列表有内边距 |
| **自动更新** | `autoUpdate` 开关与手动检查/下载/安装（从通用迁出；route id 仍为 `updates`） |

默认工具策略（`DEFAULT_TOOL_PREFERENCES`）：五工具默认全开且默认自动允许（含只读的 `read_file` / `read_skill`）。写/执行仍可走 AAR，未命中再 HITL（当审批设为询问时）。

设置内可深链 `focusSection` / `data-settings-id`（全局搜索跳转）。`SettingsHelpTip` 经 portal 挂到 `document.body`（高 z-index），避免被 settings shell / body / card 的 overflow 裁切。

**多供应商**：`settings.model` 为 `{ providers: ModelProvider[], defaultProviderId, defaultModelId }`。旧版扁平 `{ baseURL, apiKey, apiFormat, models, defaultModelId }`（及更早的 `{ model, contextWindow }`）在 `normalizeModelSettings` / 读盘时**就地改写**为一个名为「默认」的供应商，不再双读。同一供应商内模型 `id` 与 `name`（trim 后、区分大小写）均不可重复。`apiFormat` 仅 `chat_completions` | `responses`（OpenAIProvider `useResponses`）；UI 选项展示路径：`Chat Completions (/chat/completions)`、`Responses API (/responses)`。**不**支持 Anthropic `/v1/messages`。

**最大输出窗口**（模型编辑对话框「最大输出窗口」）：每模型 `maxTokens: number | null`。**不填 / `null` = 跟随服务商默认**（请求不带 `max_tokens` / `max_output_tokens`）；填了正整数才经 `resolveModelConfig` → `Agent({ modelSettings: { maxTokens } })` 发出（Chat Completions → `max_tokens`，Responses → `max_output_tokens`）。缺字段或非法值解析为 `null`，不补数字默认；已保存的数字（含旧默认 `128000`）原样保留。仍受网关/模型硬上限约束。与工具输出截断（`MAX_TOOL_OUTPUT`）无关。

**显示思考过程**（模型编辑对话框「显示思考过程」/ `showThinking`，缺省 **true**）：MiniMax 等模型回复中的 `<think>…</think>` 默认在助手气泡内以可折叠「思考过程」块展示（纯 CSS `<details>`，默认收起）；关闭后从展示路径剥离，并在落盘助手正文前剥离，历史更干净。1:1 与小队均按当前解析模型生效。

**单次运行最大回合**（设置 → 模型，上下文压缩附近；**不在**模型编辑对话框、**不在**指令 → 小队）：根级 `settings.maxTurns`，默认 **50**，钳制 **1–100**。旧配置缺字段时读盘解析为 50，下次保存写回。1 回合 = 一次模型调用；同一回合内的工具执行不另计回合；不是对话句数。经 `buildRunOpts` → `runner.run({ maxTurns })` 作用于 1:1 `runAgentChat` / HITL 恢复；避免落入 SDK `DEFAULT_MAX_TURNS=10`。小队仍用 `settings.squad.captainMaxTurns`（默认 20）与 `memberMaxTurns`（默认 10），互不影响。

**运行限制 / 熔断**（设置 → **工具**，自动审批下方；根级 `settings.toolRun`）：

| 字段 | 默认 | 钳制 | 含义 |
|------|------|------|------|
| `maxToolCalls` | **40** | 0–500（**0 = 不限制**） | 单次用户触发的运行最多执行多少次工具。计数发生在工具 `execute` 开始时（审批通过并真正执行）；HITL **拒绝不计入**。 |
| `maxDurationSec` | **600** | 0–86400（**0 = 不限制**） | 单次运行墙钟秒数上限；超时经 `AbortController.abort` 中止，并走错误路径（中文提示）。 |
| `recordTrajectory` | **true** | bool | 是否写入本会话 `last-run-trace.json`。 |

硬熔断（非 prompt）：`ToolRunBudget`（`packages/agent/src/toolRunBudget.ts`）包装 `buildTools` 的 `execute`，小队队长本机工具 + `ask_*` 队员调用 + 队员嵌套工具 **共用同一预算**（一次用户触发的外层 run）。超限抛 `CircuitBreakError`，中文错误写入对话、`appendErrorLog`，并记入轨迹 `circuit_break`。

**运行轨迹**（`recordTrajectory`）：`~/.okbot/<botId|squadId>/last-run-trace.json`，形如 `{ runId, startedAt, endedAt?, status, events[] }`。事件：`run_start` / `tool_request` / `tool_result` / `circuit_break` / `run_error` / `run_done`（参数与输出摘要截断约 2k，无密钥）。对话顶栏按钮「本轮轨迹」→ IPC `getLastRunTrace(ownerId)` → 只读弹层（同 prompt-context 样式）。

---

## 7. 本机工具与安全

工具（`packages/agent/src/tools.ts`）：

- `read_file` / `read_skill` / `write_file` / `edit_file` / `run_shell`  
- `read_skill(slug)`：加载本助手已启用技能（本地优先，其次启用的全局）的完整 SKILL.md；系统提示只含目录，属渐进披露  
- 输出截断、文件大小与二进制检测、shell 超时约 30s、cwd 默认家目录  
- `run_shell` 跨平台：Windows 优先 PATH 中的 PowerShell Core `pwsh`（`-NoProfile -NonInteractive -Command`），找不到时用 `ComSpec`（默认 `cmd.exe`）`/d /s /c`；其余平台用 `SHELL`，否则 darwin `/bin/zsh`、其它 `/bin/bash`，参数 `-lc`（见 `resolveShellExec`）

安全（`guardrails.ts` + `settings.security`）：

- **不是** OS 沙箱：`run_shell` 走本机 shell + 用户环境；防护 = 路径前缀 + 危险命令 denylist + HITL/AAR。  
- 适合可信个人本机；勿当多租户沙箱。

HITL UI：工具卡上「允许 / 永久允许 / 拒绝」。
- **停止 × 审批等待**：HITL 循环会清空工具前念叨后返回空 content；此时 **跳过** `upsertAssistantMessage`，且 storage 拒绝「无 id 匹配的空助手 upsert」，避免把上一轮助手回复 rebind 成空消息。
- **改向 × 审批等待**：用户在待审批时发送新消息 → 中止当前审批（等同取消）并按 abort+restart 开新跑；冷启动 disk pending 也会在改向时清除。明确停止仍只中止、不重启。

---

## 8. 对话增强

### 8.1 引用（quote-by-id）

- 悬停气泡 → 引用 → 输入区出现预览条。  
- 发出的用户消息带 `quoteMessageId` + `quotePreview`；气泡上方可点引用条 **跳转到原消息**（高亮）。  
- Agent 侧：`quoteContext.ts` 按 id 注入上下文（非把引用当纯文本前缀）。

### 8.2 多轮上下文结构（模型每轮所见）

主路径：`runAgentChat` + 文件 Session（`OkbotFileSession` ← `session.jsonl`）。模型每轮看到两大块：

1. **instructions**（系统材料，`buildAgentInstructions`）  
2. **session items**（SDK Session 历史，含工具调用/结果）

有 Session 时 **不会** 再把 UI 气泡 transcript 塞进 instructions（`formatHistoryBlock` 仅无 Session 的旧路径）。

#### 8.2.1 每轮拼装顺序（`registerChat`）

1. 落盘用户消息：正文；引用只写 `quoteMessageId` / `quotePreview`（**不**把 `>` 拼进正文）。  
2. 从磁盘读系统材料，按当前模型 `contextWindow` 估 token；超阈值则更新 `session-summary.json`。  
3. 构造 Session 视图（只暴露「未压缩尾部」）+ 本轮 `userText` 调模型。  
4. 流式写入助手 / 工具项到 Session；UI 由文本项投影气泡。  
5. 本轮结束后静默刷新 AGENTS.md / skills / 记忆（**下一轮**才进 prompt）。一次拉取 `Math.max` 三个配置窗口条数的消息页，再分别 `slice(-limit)`。

关键代码：`apps/desktop/electron/ipc/registerChat.ts`、`packages/agent/src/instructions.ts`、`promptContext.ts`、`quoteContext.ts`、`compression.ts`、`refresh.ts`。

#### 8.2.2 instructions 各块：来源与更新时机

由 `buildAgentInstructions` **每轮开跑时现拼**（有 Session 时 `history` 传空，不注入「最近对话」块）：

| 块 | 来源 | 更新时机 |
|---|---|---|
| 角色句（你是「某助手」…） | `settings.instructions.assistantRoleTemplate` + 当前 bot 名（`{name}`） | 设置 → 指令 → 助手；每轮现拼 |
| **机器人资料（花名册）** | `bots.json` 的 name / description；与 AGENTS 冲突时以花名册为准 | 用户改资料立刻写盘；下一轮读到新值 |
| **AGENTS.md** | `~/.okbot/<botId>/AGENTS.md` | 新建/引导写入；资料弹层「高级」可编；改名/描述时 `syncAgentsMdProfile`；用户高级写入在同次保存中优先生效；**每轮成功后** `refreshAgentsMd`（system=`settings.instructions.agentsMdRefreshSystemPrompt`，窗口=`agentsMdRecentMessageLimit`）可能静默重写（下一轮生效） |
| **记忆** | 全局 `memory.md` + 本助手 `memory.md`（JSONL）；过期过滤后 `formatMemoriesForPrompt`；设置 → 指令 → 记忆可编 scope 判定句与分析条数；设置 → 记忆可编全局列表；高级列表可编辑本助手记忆 | **开跑前**读盘；本轮结束后 `refreshMemories`（`scopeInstruction` + `recentMessageLimit`）可能 upsert；下一轮生效 |
| **更早对话摘要** | `session-summary.json` 的 `summary` | **开跑前**估 token ≥ `contextWindow × ratio` 且历史够长时增量压缩并写回，推进 `coveredThroughId`；**不删** `session.jsonl` |
| **Skills（渐进披露）** | 本助手 `skills/<slug>/SKILL.md` +（可选）`~/.agents/skills` 已启用全局 → `formatSkillsForPrompt` **仅目录**（名称 / slug / 何时使用）；完整正文不进静态系统提示，匹配后由模型调用 `read_skill(slug)`（`resolveEnabledSkill`，本地优先）加载 | **开跑前**读盘目录；`useGlobalSkills` / `enabledGlobalSkills` 在 `bot.json`；高级列表可改本地 skill / 开关全局；本轮结束后 `refreshBotSkills`（判定行=`skillsCreateUpdateInstruction`，窗口=`skillsRecentMessageLimit`）可能 upsert；下一轮生效；「查看完整上下文」同样只见目录（正文仅出现在本轮 tool 结果中） |
| 工具说明 / 编码偏好句 | 设置里的工具开关与审批模式 | 改设置后下一轮生效 |

估 token 用的静态文本大致含：AGENTS + skills + memories + 花名册 + 本轮用户正文（外加摘要与最近消息正文）。阈值始终用**当前**解析出的模型 `contextWindow`（换小窗口模型也会立刻按新窗口压）。

#### 8.2.3 session items：来源与更新时机

| 内容 | 来源 | 更新时机 |
|---|---|---|
| user / assistant / tool 项 | `~/.okbot/<botId>/session.jsonl`（v2 信封 `{v:2,id,createdAt,item:AgentInputItem,meta?}`） | 发送时 `appendMessage` 用户项；跑模型时 Runner/Session 写入助手与 tool 项；UI 气泡由 user/assistant 文本项投影；meta 可含 usage |
| 模型可见窗口 | `createSessionStore(..., { afterMessageId: coveredThroughId })` | 有压缩标记时，模型**只看到** `coveredThroughId` 之后的尾部；更早细节靠 instructions 里的摘要。全量 jsonl 仍保留，上滑加载 UI 不受影响 |
| **引用（本轮）** | 用户消息 quote 元数据；`quoteSessionInputCallback` 只改**送进模型**的最后一条 user `content` | 仅带引用的那一轮；盘上正文仍是纯 body，不持久化引用前缀 |

默认 `sessionInputCallback` 在历史已落盘时避免重复追加同一条用户 turn；有引用时把最后一条 user 内容换成「引用上下文 + 正文」。

#### 8.2.4 更新节奏（一句话）

- **开跑前读盘、可能压摘要** → 本轮真正喂给模型。  
- **跑中写 Session（含工具）** → 多轮正文变长。  
- **跑后静默维护 AGENTS / skills / 记忆** → 只影响之后轮次。

#### 8.2.5 小队

队长会话与 1:1 **同一套** Summary+Buffer：`ensureSessionCompressed` 在开跑前按小队 `contextWindow` 估 token，推进该小队的 `session-summary.json` / `coveredThroughId`，Session 视图同样只暴露未压缩尾部。静态估量含小队名/简介、队长人设与 Playbook、成员花名册（名+角色）、本轮用户正文。

成员被 `ask_*` 咨询时，带上**该成员自己的** AGENTS（及对应 skills **目录** / 记忆等）跑嵌套回合，并挂载同一套本机工具（含该成员绑定的 `read_skill`）；队长侧只有花名册与编排工具、无成员 skill 正文；队长侧 Session 留下呼叫/回复相关项，UI 画成小队气泡。

### 8.3 Prompt 上下文弹窗（实时投影）

- 用户气泡悬停「查看上下文」：按 **8.2** 用当前 SDK Session + **此刻**系统材料重建（`formatSessionPromptContext`），结构为 `## instructions` + `## session items`。  
- IPC `getPromptContext` 的 `botId` 实为 **ownerId**（助手或小队，preload 兼容旧字段名）。  
  - **1:1**：`buildAgentInstructions`（AGENTS / skills / 记忆 / 角色模板 + session summary）。  
  - **小队**：`buildCaptainSquadInstructions`（与 `runSquadChat` 一致：settings.squad 人设/playbook、成员花名册 name/role/description、`allocateAskToolNames`、summary；`history: []`；成员 AGENTS/skills/memories 不进队长 instructions）。  
- **不是**发送时冻结的历史快照；之后若静默改过 AGENTS / skills / 记忆（或小队设置），再点同一条消息可能与当时模型所见略有差异（弹窗文案已说明）。  
- 截断到该条用户消息 id；若有 `coveredThroughId`，session items **只投影未压缩尾部**（与模型本轮窗口一致），更早内容见 instructions 中的会话摘要——**不会**再把已摘要的旧气泡原文当 session items 铺开。  
- `hasPromptContext` 字段已废弃，仅兼容旧载荷。不再落盘 `contexts/`。

### 8.4 上下文压缩（Summary + Buffer）

- **比例触发**：估 token ≥ `contextWindow × ratio`（默认 ratio `0.8`），且 live buffer 长于 `keepRecentMin`。  
- **默认保留最近 5 条**原文（`keepRecentMin`/`keepRecentMax` 默认均为 `5`；窗口不够时可再对半缩小直到 `keepRecentMin`）；更早内容相对上一版摘要做**增量**压缩，结构化字段含目标 / 约定 / 路径 / 未完成 / 其他，字数受 `summaryMaxChars` 约束。  
- 写入 `session-summary.json`：`summary`、`coveredThroughId`、`updatedAt`。推进标记 **不** trim `session.jsonl`（界面气泡不删）。  
- **助手与小队共用** `ensureSessionCompressed`（`sessionCompression.ts`）；小队同样会推进自己的 `coveredThroughId`。  
- 设置：`contextCompression.*`（设置 → 模型相关区），含 **自动换题压缩** 开关（`autoTopicCompress`，默认开）。  
- **自动换题压缩**（发送路径，1:1 与小队相同）：  
  - 发送前用会话配置的模型做一次轻量 yes/no 判定（`detectTopicChange`）：新用户句是否相对近期对话 / 会话摘要开启**新话题**。  
  - 若是 → 与手动「压缩上下文」相同：`force: 'compress'`（绕过 ratio，保留最近缓冲）；**不是** `newTopic` / keep=0。  
  - 若否 / 判定失败 / live buffer 不足以压缩（≤ `keepRecentMin`）→ 不强制压缩；比例触发仍按原逻辑。  
  - 静默进行，不弹 toast。  
- 估 token / 自动压缩一律按「摘要 + `coveredThroughId` 之后的尾部」计算；`coveredThroughId` 只前进不回退。「查看完整上下文」与发送路径共用同一套投影。

### 8.5 会话存储

- 见 **8.2.3**；文件路径见 §12。  
- 小队另有 `~/.okbot/<squadId>/session.jsonl` 与 `session-summary.json`。  
- **Finalize / rebind**（`upsertAssistantMessage`）：用 `mergeUiMessageOntoRecord` 只改 id / 纯文本 / meta，**保留** SDK 原始 `item`（Responses 的 array `content` 不得压成 Chat Completions 字符串）。无先验行时才 `legacyMessageToRecord` 追加。

### 8.6 全局搜索

- 入口：侧栏搜索。分区：会话、设置项、消息命中。  
- 可选中跳转会话 / 打开设置对应区块 / 跳到消息。  
- 小队消息不参与消息搜索。

---

## 9. Token 用量

- Agent 从 SDK 抽取 input / output / **cache**（`packages/agent/src/usage.ts`）。  
- 写入助手消息 `usage`，并累计 `~/.okbot/usage.json`（lifetime、daily、byOwner）。`recordTokenUsage` 对写文件做简单串行化。  
- **小队归因**：一轮小队对话的队长+成员合计只 `recordUsage(squad.id, result.usage)` 一次；`byOwner` 下小队为**聚合**用量。成员在小队中的 token **只**挂在交换气泡的 `usage` 上，不再写入成员 `byOwner`（避免 UsagePanel「成员行 + 小队行」双计）。  
- **设置 → 用量**：总量卡片、按助手/小队分解、近 14 日 SVG 折线（input/output/cache）。  
- **助手气泡悬停**：图表图标打开该轮用量；引用；最右侧 **复制**（与用户侧「复制在最左」镜像）。

---

## 10. 打包、关于、自动更新

- **electron-builder**：`apps/desktop/electron-builder.yml`；本地产物 `apps/desktop/release/`。  
- **全平台打包上传**：`.github/workflows/release.yml`（触发后打 mac DMG/ZIP arm64+x64、win NSIS x64、linux AppImage x64，并上传到 GitHub Release）。  
- 本机 mac 脚本：`pnpm dist` / `dist:dir` / `publish:github`（仅 mac；需 `GH_TOKEN` 或已登录 `gh`）。  
- Publish 目标：GitHub `shuzheng/okbot`。  
- **electron-updater**：`autoDownload=false`；设置 `autoUpdate`（默认开）。  
- **签名现状**：Release CI 对 mac/win 关闭自动签名发现（`CSC_IDENTITY_AUTO_DISCOVERY=false`）。未签名包上自动更新可能被 OS 拦截；文档与设置文案需保持诚实，勿暗示已 notarize / 已签名。  
- **下载稳定性**：`disableDifferentialDownload=true`（跳过 Windows blockmap 差分，避免慢网回退全量导致进度条从约 90% 跳回约 1%）；UI 侧对同一次下载会话做单调进度（`Math.max(floor, percent)`），且下载中忽略后台 `checking-for-update` 对状态的覆盖。  
- UI：检查更新、下载、安装并重启；标题栏「下载更新」按钮。  
- **关于**：应用信息、构建日期等（`getAppInfo`）。

开发未打包时通常不强制网络检查更新。

---

## 11. 语音

- **录制 → 本地转写**：`MediaRecorder` 在渲染进程按所选麦克风录音；停止后用 **`@xenova/transformers` + 内置量化 `Xenova/whisper-tiny`**（ONNX / WASM）转写，文本写入 Composer。  
- **不**使用 Google Web Speech（Electron / 国内常出现假 `network` 错误）；**不**调用 provider `/audio/transcriptions` / `okbot:transcribe-audio`。  
- 模型文件在 `apps/desktop/public/models/Xenova/whisper-tiny/`（与 `resources/models` 同源），随应用打包，可离线识别；ORT WASM 在 `public/wasm/`。  
- 设置里的麦克风 `deviceId` 用于 `getUserMedia`（录音 + VoiceBeam）。UI locale `zh`→chinese、`en`→english。  
- 首次加载模型 / 识别中会显示「正在加载语音模型…」「正在识别…」。不支持 MediaRecorder、拒权、无麦、模型或识别失败有明确中英提示。

---

## 12. 数据目录一览

- **`settings.json` 损坏**：`readJsonResult` 区分 missing / ok / invalid。解析失败时备份为 `settings.json.corrupt-*`，**不**把默认配置写回原文件（避免静默抹掉 API Key）；启动 bootstrap 会 toast 提示。合法文件的 legacy 迁移写回前先 `pre-migrate` 备份。


```text
~/.okbot/
  settings.json
  settings.json.corrupt-*      # 解析失败备份（读失败不写回默认）
  settings.json.pre-migrate-* # legacy 迁移写回前备份
  usage.json
  bots.json
  squads.json
  memory.md
  logs/
    errors-YYYY-MM-DD.jsonl    # SDK/run 失败结构化日志（保留今天+前 2 个日历日）
  <botId>/
    bot.json
    AGENTS.md
    memory.md
    skills/<slug>/SKILL.md
    session.jsonl
    session-summary.json
    last-run-trace.json         # 最近一轮工具/错误轨迹（recordTrajectory）
    resources/
  <squadId>/
    session.jsonl
    session-summary.json
    last-run-trace.json
```

**错误日志**（`apps/desktop/electron/storage/errorLog.ts`）：1:1 `chatStart`、HITL `resumeHitl`、小队 `squadChat` 在 catch 并发 `type: 'error'` 时追加一行 JSON（`ts` / `ownerId` / `messageId?` / `phase` / `error` / `stack?`），含熔断（`CircuitBreakError`）。不写 API Key、不写用户正文；仍 `console.error`。每次写入时按日历日剪枝，删除早于「今天−2 天」的 `errors-*.jsonl`。与 `last-run-trace.json` 互补：前者按日汇总失败，后者保留每会话最近一轮结构化轨迹。

---

## 13. IPC 与进程边界（速查）

常量：`packages/shared` → `IpcChannels`。  
注册：`apps/desktop/electron/ipc/`（chat / entity / system）。

常见通道：bootstrap、bots/squads CRUD、settings、discoverModels、messages 分页与搜索、chatStart/Abort/Event、toolRespond、setChatUnread、getPromptContext、getLastRunTrace、转写、appInfo、updater*、getUsageStats、copyText、traffic light 位置等。

Preload 暴露 `window.okbot.*`；渲染进程不直连 Node fs。

---

## 14. UI / CSS 约定（聊天气泡）

- 用户：`bubble-row.user` → `bubble-row-cluster` →（quote）→ `bubble-body-row`（**actions | bubble**）。  
- 助手：`bubble-row.assistant` → `bubble-body-row bubble-body-row-assistant`（**bubble | actions**）。  
- 共用：`.bubble-actions` 默认透明，行 hover/focus-within 显示；`.bubble-body-row .bubble-actions { margin-top: 6px }`。  
- 小队：仅成员发言行加 `has-speaker`（头像列间距）；队长行不加，避免空头像占位。成员头像纯 CSS sticky（勿在 `.messages` 祖先加会打断 sticky 的 `overflow: hidden`）。  
- 早期产品：**就地改干净结构**，避免绝对定位「贴在气泡角上」的第二套交互；不引入 Motion 等重动画库。

相关文件：

- `apps/desktop/src/features/chat/ChatTranscript.tsx`  
- `apps/desktop/src/styles/app.css`（`.bubble*` / `.msg*` / sidebar / settings）

---

## 15. 明确未做 / 边界

- 无 MCP。  
- `run_shell` 非容器/seatbelt 沙箱。  
- 模型目录 **仅手动 + discover**，无复杂厂商 OAuth。  
- 小队搜索排除、虚拟队长非真实 bot——改相关逻辑时勿回归。

---

## 16. 文档维护

1. 合并功能或重要 UI 变更时：**同一 PR/提交或紧随提交** 更新本文件对应章节。  
2. 根目录用户文档：`README.md`（英文）与 `README_zh.md`（中文）保持短述 + 指向本指南；文首保留 `English | 中文` 相对链接，两边结构同步；勿在用户 README 写技术栈 / 当前范围 / `run_shell` 诚实边界等开发向内容（边界说明留在本指南对应章节）。  
3. 本指南**不要**写死产品版本号（版本以 Releases / `package.json` 为准）。  
4. 以代码与近期 commit 为准，避免凭记忆写「计划中」能力。

## 已知限制（小队冷启动审批）

应用重启后，**小队**会话里挂起的工具审批无法从磁盘恢复（队长成员图尚未支持冷启动重建）。重启后再次批准会提示重新发送该轮消息；普通单助手的待审批仍可冷恢复。

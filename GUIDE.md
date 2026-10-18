# OkBot 产品与开发指南

> 本文档描述 **当前已实现** 的产品能力与 UI 细节，供开发与联调对照。  
---

## 1. 产品定位

OkBot 是 **本机个人桌面 AI 助手**（Electron）：

- 左侧：助手 / 小队会话列表  
- 右侧：对话区（气泡、工具卡、输入框）  
- 数据纯文件落在 `~/.okbot`，无云端账号体系  
- **单实例**：主进程 `requestSingleInstanceLock()`；再启动会聚焦已有窗口（含后台隐藏时），不会开第二个进程。`okbot serve` 是另一个进程：同一 `~/.okbot` 只允许一个服务听端口，Electron 若发现已经在听，窗口只作界面连上去。  

技术栈：Electron + React + TypeScript + Vite（electron-vite）；pnpm monorepo（`apps/desktop`、`packages/agent`、`packages/shared`）；对话走 `@openai/agents`（Chat Completions / Responses）+ 兼容网关（如 DeepSeek）。

---

## 2. 仓库结构（关键路径）

```text
okbot/
  apps/desktop/                 # Electron 壳 + React UI
    bin/okbot.mjs               # `okbot` bin → 加载 out/main/cli.js
    electron/                   # main / preload / IPC / storage / updater
      ipc/                      # registerChat / registerEntity / registerSystem
      localHttpApi.ts           # 网关 HTTP（Electron 与 okbot serve 共用）
      cli.ts                    # `okbot serve` 入口
      attachPreload.ts          # 附着客户端 preload（令牌走请求头）
      serverPresence.ts         # 端口探测与数据目录锁
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
  apps/sandbox-agent/           # 云电脑进程（HTTP shell/fs API + Dockerfile）
```

开发入口：`pnpm dev`（先 build shared/agent，再 desktop）。类型检查：`pnpm --filter @okbot/desktop typecheck`。开发服务器绑 `127.0.0.1`（避免部分 Mac `/etc/hosts` 缺 `localhost` 导致 `ENOTFOUND localhost`）；若其它工具仍解析失败，把 `127.0.0.1 localhost` 与 `::1 localhost` 写回 `/etc/hosts`。

---

## 3. 主界面布局

窗口：
- **macOS**：`titleBarStyle: 'hiddenInset'` + 系统红绿灯（`trafficLightPosition`），不显示自定义窗口按钮。
- **Windows**：`titleBarStyle: 'hidden'`（无系统标题栏），主顶栏操作区在「关于」右侧放自定义最小化 / 最大化(还原) / 关闭（`WindowControls`，仅 `platform === 'win32'`）。无会话时按钮浮在主区右上角。IPC：`windowMinimize` / `windowMaximizeToggle` / `windowClose` / `windowIsMaximized`（及 `windowMaximizedChanged` 推送）。
- **Linux**：保持改动前行为（既有 `titleBarStyle` + `autoHideMenuBar` / 隐藏应用菜单）；不加 Windows 式自定义窗口控件。
- **Windows / Linux** 均设 `autoHideMenuBar: true` 隐藏系统原生 File/Edit/View 菜单栏。 Windows 用最小 **Edit** 子菜单（undo/redo/cut/copy/paste/selectAll；**不要** `null`——会破坏 IME；空 `[]` 在部分 Electron 上仍缺 Edit role）； Linux 仍 `Menu.setApplicationMenu(null)`。
- **关闭窗口（托盘）**：首次点击窗口关闭（Windows 自定义关闭 / macOS 红绿灯关闭 / Linux 原生关闭）弹出「退出」或「最小化到托盘」（macOS 文案为「隐藏到菜单栏」）；可勾选「记住我的选择」。偏好写入 `settings.closeAction`：`ask`（默认）/ `tray` / `quit`。设置 → 通用 →「关闭窗口时」可随时改。托盘（macOS 为菜单栏图标，优先 `trayTemplate` 模板图；启动即显示）提供 **打开窗口**、**主题**子菜单（跟随系统 / 浅色 / 深色，勾选当前 `settings.theme`）、带 **置顶** 小标题的置顶成员、**最近会话**（最多 10 条）、**设置** / **退出**（成员行：emoji 头像用自身 emoji；立体头像 `bot-avatar` 统一 👤，因原生 Tray Menu 无法可靠渲染 3D）；主窗口激活时 **⌘/Win+1…9** 按侧栏从上到下（置顶 → 分组/未分组 → 已隐藏）切换会话，长按修饰键约 **0.5s** 显示快捷键提示（亮/暗主题，不挤动会话名）；隐藏到托盘时 macOS 会一并隐藏 Dock 图标，再次打开时恢复。**Cmd+Q** / 托盘「退出」会请求退出；若仍有任务或待审批在跑，`before-quit` 会先转入后台并在再次退出时确认。实现：`electron/appTray.ts`、`main.ts` 的 `close` 拦截。
- **BotFormModal / SquadWizardModal**：右侧抽屉（`.drawer-backdrop` + `.form-drawer` / `.modal.form-drawer`），与左侧边栏同为**通高**：贴齐视口上/下/右缘、无浮动短面板边距与圆角；打开时**快速滑入**、关闭时**滑出后卸载**（约 0.2s，`prefers-reduced-motion` 时跳过动画直接关）；标题栏粘性固定（**无**底部分割线），关闭钮为 **»** 形双 chevron（`ChevronsRightIcon`，指向右=收起抽屉），正文滚动。顶区为居中头像（`.avatar-preview-stack`）→ 可编辑名称 → **纯文本**描述（非 textarea，无「对话后自动演进…」提示）；小队顶区为 `SquadAvatar`。autoApply：名称在 IME `composition` 期间不 `onApply`，结束后/失焦再持久化，并 350ms 防抖；Windows 聚焦名称不 `select()`。backdrop / drawer / 表单控件显式 `-webkit-app-region: no-drag`。抽屉本体为毛玻璃半透明底（`backdrop-filter: blur(28px)` + `color-mix(--panel 10%, transparent)`），左侧 `box-shadow`（浅色 `-6px 0 18px rgba(0,0,0,0.14)`；深色加强为 `-8px 0 28px rgba(0,0,0,0.55)`）；**无**页面遮罩/变暗（`.drawer-backdrop` 全透明，已去掉 `::before` dim），以便毛玻璃直接取样底层 UI；深色主题左侧描边更浅。头像色板为圆形色点；选中为白缝 + 墨线圈（`.color-swatch.active` 的 border + box-shadow，非 outline 椭圆）。名称输入无底色（`background: none`）。
- **删除确认**：助手/小队/供应商/模型/定时任务删除使用应用内 `ConfirmHost` + `requestConfirm`（`components/ui/ConfirmModal`），不用系统 `window.confirm`；主进程 `dialog.showMessageBox` 仅用于自动更新/退出等 OS 流程。

### 3.1 侧栏（`features/sidebar`）

- **展开态**：搜索、会话列表（助手 + 小队）、底部 FAB（搜索 / 设置 / 创建菜单）。会话行副标题默认是最后回复摘要（`lastReplyPreview`）；**非当前会话**若 composer 仍有未发送草稿，副标题改为 `草稿：` + 折叠空白后的草稿原文（CSS ellipsis 截断；当前会话仍显示最后回复，草稿只留在输入框）。会话行名称右上角显示**上次更新时间**（`formatSessionUpdatedAt`，用 `SessionItem.updatedAt`）：当天 `HH:mm`；昨天 `昨天 HH:mm`（EN: `Yesterday HH:mm`）；一周内为星期（`星期x` / EN 本地化短星期）；一月内为 `MM/DD`；更早为 `YYYY/MM/DD`。次要 muted 文案，不挤占标题/未读。  
- **折叠态**：窄轨头像列表；会话行悬停仍有 `--accent-soft` 底色；悬停约 **500ms** 后显示 dock tip（指针离开头像即隐藏，不保留 tip 卡片悬停）；底部紧凑 FAB。Mac Dock 式头像放大动效默认**关闭**（`settings.sidebarDockMagnify`，设置 → 通用 →「缩放特效」）；仅开关打开时才缩放。macOS 顶栏仍保留红绿灯占位（`--traffic-pad`）；Windows / Linux 折叠时去掉该空顶距。左侧 `.sidebar` 为毛玻璃：macOS 上 `BrowserWindow` `transparent` + `vibrancy: 'sidebar'`（html/body/#root/.app 透明，`.main` 仍用不透明 `--chat-bg`），侧栏浅色 panel 洗；透明窗用 `.app::after` 实色 0.5px 描边（`--window-rim-color`，圆角 `--window-radius` 对齐系统窗角）；其它平台用半透明 panel + CSS `backdrop-filter`。布局为栅格 `sidebar | splitter | main`（不再 overlay；先前 overlay 只采样到平坦 `--chat-bg`）。深色主题 splitter 描边更淡。  
- **宽度**：可拖拽，上限约 **400px**；点击 splitter 可折叠/展开；宽度持久化（`sidebarPersistence`）。  
- **创建菜单**：创建助手 / 创建小队 / **市场** / **导入助手**（各有独立图标）。侧栏底部也可直接打开**市场**（展开时设置/市场为图标+文字；侧栏变窄但未折叠到轨前隐藏文字且无 tooltip；收起轨用溢出菜单，设置/市场无 tooltip）。  
- **会话项**：头像 + 名称 + 最近回复预览。助手右键分四组（组间分隔线；整组缺失时折叠分隔线，不出现相邻/首尾空分隔）：**置顶**（或 **取消置顶**）/ **移至** / **标为已读**（或 **标为未读**）｜**重命名** / **设为默认助手**（或 **取消默认助手**）｜（高级开启时）**请求地址** / **导出助手**｜**隐藏**（或 **显示**）/ **删除**。小队右键同样四组：**置顶** / **移至** / **标为已读未读**｜**重命名**｜（高级开启时）**请求地址**｜**隐藏** / **删除**（无默认助手、无导出）。修改助手/小队仅从对话顶栏左侧身份入口进入，不在右键菜单。**已隐藏**列表里的成员右键省略置顶、移至、设为默认助手，仅保留：**标为已读未读**｜**重命名**｜（高级开启时）**请求地址** /（仅助手）**导出助手**｜**显示** / **删除**。删除确认文案为「删除助手「…」」/「删除小队「…」」。分组标题右键：**重命名**｜**上移** / **下移**｜**删除**（「未分组」无重命名与删除，分隔线随之折叠）。菜单贴窗口边缘时会翻转到窗口内。默认可多选置顶（`settings.pinnedOwnerIds` 有序数组）；展开侧栏顶部为居中大头像+名称条（可并排换行），折叠轨仅显示与会话行同尺寸头像；置顶区与列表间有与会话行同宽的内缩分隔线。置顶项仍可选中，并从下方时间序列表中抽出。默认助手头像右下角有圆形描边星标（侧栏 / 顶栏 / 折叠 tip；与置顶独立，置顶时星标仍显示）。删除助手/小队时会从置顶列表移除。  
- **两边列表同步**：桌面窗口与局域网网关页面共用同一份 `~/.okbot`。新消息、改名、新建、删除会发 `sessions_changed`（桌面走 IPC，网关走 `GET /v1/events` 长连接，只转发花名册变更、不转发对话 delta）。收到后约 **120ms** 内重新拉助手与小队列表；当前会话若已被删掉则清空选中。  
- **未读回复**：非当前会话、且该会话 `hasUnreadReply` 且不在「工作中」时，头像外壳加 **unread 脉冲光晕**（`session-avatar-shell.unread`，文案 `unreadReply`）。切回会话会清未读（IPC `setChatUnread`）。窗口不在前台时，当前会话的回复完成或工具等待批准也会标未读；窗口重新获得焦点时清掉当前会话的未读。  
- **系统通知**（设置 → 通用 → 系统 →「系统通知」，`settings.notifications`，默认开）：窗口不在前台时，回复完成、工具等待批准各发一条系统通知（同一会话同类通知用 `tag` 合并）。点通知会把窗口拉到前台（IPC `windowFocus`）并打开对应助手或小队。实现：`src/utils/systemNotify.ts`（Web Notification API，网关页同样可用，需浏览器授权）。同一设备开了多个窗口时只弹一条：先在同源窗口间用 localStorage 按 `tag` 抢占，再向主进程申请（桌面 IPC `claimNotification`，网关页 `POST /v1/notify-claim`，`electron/notifyClaim.ts`）。主进程把桌面窗口、本机回环地址、以及本机网卡上的局域网地址都算作同一设备（网关页用局域网 IP 打开时不会和桌面窗口各弹一条）；其它网关客户端按来源地址区分。`tag` 含会话、种类和事件 id（消息 id / 批准 requestId），所以 5 秒内同一种类的两条不同事件都会弹。未读：回复完成和出错都适用；在前台正看着这个聊天的窗口会在约 400 ms 后再写一次「已读」，盖过别的窗口为同一事件写的「未读」。  
- **小队头像**：`SquadAvatar` 田字格拼接成员头像；成员为立体头像时用对应 `bot-avatar` 造型（静态），否则用 emoji/颜色。

### 3.2 对话区顶栏

- 当前会话名；主题循环按钮（`system` / `light` / `dark`）。 `system` 会解析成具体的 `data-theme="light|dark"`（`matchMedia` + 主进程 `nativeTheme.updated` IPC），避免仅依赖移除属性时部分样式无 `@media (prefers-color-scheme)` 双生而混色。  
- **关于**：主题按钮右侧打开 `AboutModal`（应用信息、构建日期、复制信息）。  
- **窗口控件（仅 Windows）**：关于按钮右侧为最小化 / 最大化(还原) / 关闭；macOS 仍用系统红绿灯，Linux 不加这组控件。关闭行为见上文「关闭窗口（托盘）」。  
- **下载更新**：有可用/下载中/已下载更新时，侧栏底部「市场」右侧出现蓝色更新图标（见 §10）；无更新时隐藏。
- **沉浸式对话**：控制不在顶栏，而在消息/转录区域（`.messages-shell`）**右下角**悬停浮层按钮（Maximize2 / Minimize2 图标）。鼠标进入消息/转录区域时淡入，离开时淡出（`opacity` 过渡；不可见时 `pointer-events: none` 不挡点击）。点击隐藏侧栏与 splitter（聊天区全宽），并隐藏对话顶栏右侧图标组（`.header-actions` 里的主题、关于）；Windows 最小化 / 最大化 / 关闭仍留在顶栏右侧。再点同一按钮还原侧栏与这些图标（保留进入前的宽度/折叠轨态）。偏好持久化 `localStorage` 键 `okbot.immersiveChat`。文案：`开启沉浸式对话` / `关闭沉浸式对话`（EN: Enable / Exit immersive chat）。
- **macOS 沉浸式顶栏 inset**：沉浸且侧栏隐藏时，对话顶栏在 darwin 上增加左侧安全区（`--traffic-lights-inset: 76px`），避免助手头像/名称与系统红绿灯重叠；Windows / Linux 不加该左 padding。

### 3.3 消息列表（`ChatTranscript`）

- 分页上滑加载更早消息（`MESSAGE_PAGE_SIZE = 50`；游标为 `beforeMessageId` / `nextBeforeMessageId`，避免 jsonl 整文件重写后字节 offset 失效）。  
- **消息时间（左滑 / 左滚动）**：用户与助手行均可露出 `createdAt` 的本地 `HH:MM`（尾部 gutter，`BubbleSwipeRow`）。**跟手**：进入距离 = 滑动距离 / 2（指移 2px → 时间进 1px），无二元阈值死区。触屏保持左滑；鼠标**不**按住拖（避免与划选冲突），悬停气泡后**水平向左滚动**（触控板侧滑 / 鼠标横向滚轮 `deltaX`；无横向轴时可用 Shift+滚轮）露出时间，停滚后弹回。  
- **用户气泡**（右对齐）：  
  - 可选引用条（`bubble-quote`）在上；  
  - `bubble-body-row`：左侧悬停操作 + 右侧气泡。  
  - 悬停操作（左→右）：**复制**、查看本轮 Prompt 上下文、引用。  
  - 操作按钮用 `margin-top: 6px` 与气泡 **第一行文字** 光学垂直居中；长消息时 `.bubble-actions` 与成员头像同款纯 CSS sticky（`position: sticky; top: 0`），滚动该条时贴住视口顶，不随气泡底滚走。  
  - **头像色洗涤**：1:1 助手会话若 `bot.color` 为 `#RRGGBB`，该会话用户发送气泡背景为该色相对 `--chat-bg` 的浅色洗涤（`.messages.has-user-bubble-tint` / `--user-bubble-accent`），文字用 `--text`；未设色则默认 `--bubble-user`。助手回复气泡不变。小队无小队级 `color` 字段，小队会话不染色。  
- **助手气泡**（左对齐）：布局是用户侧的 **镜像**——`bubble-body-row-assistant` 内先气泡、后操作（token 用量 / 引用 / **复制**），同一套 `margin-top: 6px`，**不要**再用 absolute 叠在气泡角上。  
- 小队助手气泡：成员用对应 bot 的 `FlatAvatar`（`.bubble-speaker-avatar` 在 `.messages` 内 `position: sticky; top: 0`，长消息滚动时头像贴住视口顶，直到该条 `bubble-row` 滚出）；**队长气泡不渲染头像**（无 `has-speaker` 间距，气泡左对齐）。侧栏/列表 `SquadAvatar` 不变。  
- Markdown 渲染、代码块复制；工具调用以 `ToolCardView` 插入在对应消息附近。  
- 助手回复气泡「链路追踪」：查看**本条消息**的瀑布时间轴（模型 / 工具 / 等待批准 / 压缩等步骤的耗时与摘要；数据写在消息 `trace` 字段，随会话持久化）。  
- 发送时可**自动换题压缩**（见 §8.4；设置可关）。  
- **助手回复显示**：主进程不再向 UI 推送 token `delta`；助手气泡在 `send_message`（`assistant_message`）、自动允许/HITL 工具边界前的可见旁白落盘、或 `done` 时整条出现，不做逐字流式。长任务应尽早 `send_message` 确认；即使用户只说「继续」、模型未调 `send_message`，工具一开始也会把缓冲旁白封成气泡。同轮开场「收到」只保留一条（短确认之后若最终/旁白再以「收到」开头，去重或去掉开头确认句）。UI 不展示空白或仅 `<think>`（含未闭合）的气泡。侧栏预览仍可在收齐后更新。`MarkdownContent` / `CodeBlock` / `ChatTranscript` / `SessionSidebar` 用 `memo`。  
- 忙碌时 transcript **末行** ThinkingOrb + 阶段文案（思考中 / 正在回复 / 工具与命令 / **正在进化**——`done` 后、`chatStart` IPC 返回前的 persist 与 SOUL/skills/memory 刷新），排在最新用户/助手气泡下方，不遮挡；可「跳到底部」。
- **贴底滚动**：用户未主动上滑时，新气泡 / 工具卡片 / 阶段切换 / Markdown 布局增高会通过 `ResizeObserver`（含子节点与 `.messages` 视口）+ `MutationObserver` + 双 `rAF` 继续钉在底部，并在约 220ms 后再钉一次以覆盖 bubble-enter / 晚到布局；程序化滚动用 `pinningScrollRef` 忽略，避免误判「已离开底部」。距底 ≤48px 视为贴底，距底 >80px 才显示「回到底部」（滞回，消化亚像素抖动）。发送（含并行加任务）会强制重新贴底；用户上滑后不抢滚动。
- **进行中的任务**（`OpenTasksPanel`）：composer 上方折叠卡，默认收起；展开时任务/步骤列表**向上**以 absolute 浮层叠在消息区上（不挤占消息高度），列表区毛玻璃同右侧抽屉（`--panel` ~10% + `blur(28px)`）；展开 chevron 逆时针旋至朝上（`rotate(-180deg)`），收起顺时针回位。

### 3.4 输入区（`ChatComposer`）

- 多行输入：随行数**自动增高**，最多 **5** 行后内部滚动。单行保持左右紧凑（左 `+`、中文本、右麦克风 / 发送）；超过 1 行时文本区改为**顶部全宽**，动作按钮落到**底下一行**（左 `+`，右麦克风 / 发送或停止）。空闲时描边强调。  
- **会话草稿**：composer 正文按 `chatOwnerId` 分桶（`draftsByOwnerRef`），切换助手/小队会话时恢复该会话未发送草稿，并把光标放到文末；发送或清空后移除。引用草稿切换会话时丢弃。侧栏副标题对**非当前**会话读取同一份草稿映射（`draftPreviewsByOwner`）：有非空草稿时显示 `草稿：xxx`（i18n `draftPrefix`），切回该会话或清空/发送后恢复最后回复摘要。
- **引用草稿**：上方 quote 条（可关闭）；发送时写入 `quoteMessageId` + `quotePreview`（**不**把 `>` 拼进正文）。
- **滚动条**：composer textarea 与聊天区 `.scroll-fade` 同为 5px 半透明 thumb（含 light 主题）。
- **输入性能**：已达 5 行上限且内容仍溢出时跳过 `height:0` 测量；`ChatComposer` 经 `memo`。  
- **麦克风**：点击开始录音，再点停止；`MediaRecorder` 采集音频 → 渲染进程 **本地 Whisper**（`@xenova/transformers` + 内置 `whisper-tiny`）转写写入 Composer；`VoiceBeam` 可视化。**不**走 Google Web Speech，也**不**走 provider `/audio/transcriptions`。需系统麦克风权限；识别可离线。失败时有模型加载 / 识别错误的中英提示。  
- **附件**：图片 / 文件 / 文件夹，**单次最多 10 个**（超出 toast 提示）。左侧 `+` 打开扇形菜单（图片 / 文件 / 文件夹项保留悬停 tip；**`+` / 关闭本身不显示**「添加附件」「关闭附件菜单」悬停 tip）。**粘贴**：在输入框粘贴剪贴板中的图片 / 文件（含截图）会写入网关主机 `~/.okbot/<ownerId>/uploads/`，不依赖客户端本地 `file://`。亦可把文件 / 图片 / 文件夹**拖进聊天区**（含输入区）；图片 / 文件同样上传到网关 `uploads/`；文件夹仍作为单个 `folder` 路径附件（不展开、不上传）。拖入时聊天区有放下提示。Composer 内附件行在文本上方：非图片为 pill（图标 + 文件名 + 大小），图片为圆角方缩略图（右上角 X 移除）。正文前可带 `[Attached]` 块（网关绝对路径给工具）；图片另走视觉通道（`input_image` data URL），且必须通过与 `read_file` 相同的路径防护、魔数校验，并有张数与总量上限。引用前缀下的 `[Attached]` 同样会去掉图片路径。聊天气泡：文件仅图标 + 名称；图片经网关 `GET /v1/media/<ownerId>/uploads/…`（`?token=` / cookie / Bearer）展示。上传上限单文件 25MB。
- **发送 / 停止（并行任务）**：忙碌时输入框仍可编辑；有草稿时可继续发送（composer 忙碌一律软改向当前在途回合），Enter 同样可发送（尊重 IME）。**停止**保持独立：忙碌且草稿为空只显示停止；忙碌且有草稿时 **停止 + 发送** 同时显示。发送不会仅因忙碌而灰掉。BorderBeam / busy 在该助手/小队**任一**回合仍在跑时保持点亮，全部结束后熄灭。本机 HTTP API 发起的回合同样会点亮忙碌 / 停止（收到 `user_message`）。
- **发送失败重试**：乐观用户气泡带渲染期 `sendStatus`（`pending` | `sent` | `failed`，不落盘）。`chatStart` / `chatStartSquad` 拒绝或抛错时，气泡保留并在**右下角**显示红色重试按钮（i18n `retrySend`）；点击以原文 + 引用（若有）重发。失败时不再用 `getMessagesPage` 整页替换把本地气泡冲掉。

---

## 4. 助手（Bot）

### 4.1 生命周期

- 花名册：`~/.okbot/bots.json`；详情：`~/.okbot/<botId>/bot.json`。  
- **默认助手**（`settings.defaultAssistantId`）：用户从已有助手中任选一名（可清空）；侧栏头像右下角星标 + 右键设/取消（通用设置页不再提供下拉）。删除该助手时自动清空。与 **置顶**（`settings.pinnedOwnerIds`）独立。1:1 系统提示会加一句「统一入口、优先求助花名册伙伴」的轻提示（无额外工具特权）。  
- **新建** → 两步 onboarding（场景 / 期望协作方式）写入 `SOUL.md`。场景 chips：编程调试、内容创作、数据分析、日常助理、学习答疑、翻译润色、办公文档、资料检索、产品需求、运维排障、其他（id 为自由字符串，`finishBotOnboarding` 照常）。**跳过**（或未填答案就结束）时：立刻 `finishBotOnboarding` + 花名册简介种子，并静默发起一轮 `origin: onboarding_skip` 对话（用户行对 UI 隐藏，与 auto-continue 同机制），由模型用专业开场主动询问职责边界与协作偏好；不阻塞输入框。用户答复后**立刻**演进花名册 `description`（绕过 SOUL 节流 `soulEveryTurns`）。填了答案则只写 SOUL / 简介，不开这轮。首次**成功完成**的对话也会软关闭 onboarding；用户中途停止（`done.aborted`）不会标记完成。  
- 编辑资料：名称、描述、头像、颜色、可选 **模型覆盖**（`providerId` + `modelId`，皆空则用全局默认；同模型 id 可跨供应商）。  
- 编辑抽屉分区（`OwnerFormTabs`）：**详情** / **任务** / **自动化** / **记忆** / **技能** / **资源**（小队无记忆/技能）。**任务**与**资源**列表新→旧，每次加载 10 条（「加载更多」）。记忆 / 技能为限高列表（仅本助手；全局记忆在设置 → 记忆）；全局技能总开关（默认关）+ 按 slug 选用 `~/.agents/skills`（`bot.json`：`useGlobalSkills` / `enabledGlobalSkills`）。详情 → Advanced 标签为「灵魂」（`SOUL.md` 正文，无下一行提示）。  
- 系统提示：`SOUL.md`（引导写入 + 高级可编 + 跑后静默维护）；Skills：**渐进披露**——目录（名称 / slug / 何时使用）进系统提示，完整正文经 `read_skill` 按需加载（本助手 `skills/<slug>/SKILL.md` + 可选全局）；记忆：全局 `memory.md`（设置 → 记忆）+ 每助手 `memory.md`（JSONL）。  
- **技能热更新**：主进程对每个助手的 `skills/` 以及（若启用）`~/.agents/skills` 做 `fs.watch`（约 120ms 去抖），变更发 `skills_changed`。不改当前转录；**下一轮**开跑和 `read_skill` 都从磁盘重读，改完文件不用重启应用。

### 4.2 双轨头像（`avatarKind`）

| 模式 | 含义 | UI |
|------|------|-----|
| `bot-avatar`（**默认**，切换条左侧） | libraries.dev **bot-avatars** 立体造型 | 18 种 shape（clover/flower/…/puddle），可选颜色覆盖（含纯白）；工作态可用 `state="working"` |
| `emoji`（可选，切换条右侧） | Emoji + 可选背景色 | `FlatAvatar`；「默认」= 无色块（透明） |

创建/编辑为**右侧抽屉**（粘性标题栏 + 可滚动正文）：立体头像默认；悬停头像预览显示 **»** 形双 chevron（收起态向下 / 展开态向上，无文字）；emoji 预设网格与立体造型同为 3×6（末格「更多」打开全量选择器）、颜色板（一行，**「默认」打头** + 预设色含 `#FFFFFF`；选色时 emoji 格与预览背景同步）；`avatarKind` 切换与 `botAvatarType` 选择。两边的「默认」均存空字符串 `color === ''`（立体头像→库默认色；emoji→无背景）。从立体头像「默认」切到 emoji **不**再 hash 出随机色。缺省 / 未知 `avatarKind` 读时归一为 `bot-avatar`（无双格式 shim）。新建助手时立体头像随机一种形状，颜色用库默认（不预选色板）。

立体头像：`.flat-avatar-bot` **不**裁剪库的 1.5× overscan（跳动/翻转要画到布局盒外）。侧栏 `session-list` 加大上下 padding，会话行 `overflow: visible` + 提高 z-index，避免被列表/`sidebar` 的 overflow 或邻行背景切掉（误看起来像头像框裁切）。展开置顶条加大顶 padding + `--pin-item-pad`，避免工作态跳动被 `.session-pane` 的 `overflow: hidden` 从上方裁切。忙碌时行外包的 `BorderBeam`（`size="sm"`）默认 `overflow: hidden`，侧栏用 `.session-beam { overflow: visible !important }` 放开，否则工作态跳动/翻转会被行高裁切。`bot-avatars`（npm **0.2.2**，与 libraries.dev 同线）经 pnpm patch：IntersectionObserver 观察布局宿主（canvas 的 parent）并带 `rootMargin: 64px`，避免侧栏 overflow 对 1.5× overscan canvas 误判「不可见」而停动画；**去掉**库的 canvas `opacity` 淡入（加载闪一下）；**不再**节流闲置帧（旧 patch 的 80ms 抽帧是顿挫主因）。搜索/气泡 speaker / 小队拼接头像保持静态。

侧栏会话列表立体头像动效（`resolveSessionAvatarMotion`）：**当前会话**播闲动画；该会话（或其它）正在执行任务时播忙动画；曾打开过且 1 分钟内有交互的其它会话播闲动画；超过 1 分钟无交互（或从未打开）为**静止**——正面朝前的 rest pose（`pose` 强制 `restPose`），不是把动画帧冻住。交互时间在打开会话 / 发送消息时刷新。

### 4.3 助手包（导出 / 导入）

把一个助手的对外形象带走，不带走密钥和聊天记录。

- **内容**：`manifest.json`（格式 `okbot-assistant`：名称、描述、头像）+ 可选 `SOUL.md` + `skills/<slug>/SKILL.md`。  
- **导出**：侧栏该助手右键 **导出助手**。默认文件名是助手名称（去掉不能做文件名的字符），扩展名 `.okbot`。`.okbot` 是**未加密** zip（系统 `zip`，无密码）。导出前剥掉密钥类字段（apiKey、token、password 等），**不含**会话、记忆、供应商配置。保存路径若没写 `.okbot` 会自动补上。  
- **导入**：侧栏 **+** → **导入助手**，可选 `.okbot` 或含 `manifest.json` 的文件夹。始终**新建**一名助手（头像 / 名称 / 人设 / 技能），并标成已完成引导；不改本机模型密钥。成功后刷新会话列表。

### 4.4 市场（助手 + 连接器）

- **入口**：侧栏底部 **市场**（展开时在设置右侧；收起时在溢出菜单第 3 项），或侧栏 **+** → **市场**，或首次使用引导第 2 步。点击后主区换成**整页市场**（占满聊天区，不是弹层），并**清空当前会话选中**（侧栏无高亮、聊天区不再绑定原会话）；Esc 或关闭返回（仍无选中，除非再点会话或从市场安装助手）。
- **顶栏 Tab**：**助手** / **连接器**（`galleryTabAssistants` / `galleryTabConnectors`）。
- **助手 · 内置画廊**：点卡片即新建一名可直接聊天的助手，随后选中它并聚焦输入框。没有模型时卡片不可点，并提示先去「模型接入」添加模型。已有同名助手的卡片显示「已添加」，不能再点。
- 内置默认（顺序）：**编程助手**、写作助手、学习伙伴、计划助手、翻译助手、电脑小帮手。每个含人设（`SOUL.md`）和 0–2 个技能（**slug、frontmatter `name`、目录名均以 `okbot-` 开头**；落盘 `skills/<slug>/SKILL.md`；`description` 为能力 + 何时使用，触发说明不进 body），中英两套文案按界面语言安装。人设与技能用 ASD-STE100 风格的短句。编程助手面向入门、可用中文提问。
- **远程 GitHub 来源**（助手 Tab）：在市场页粘贴公开仓库 URL、目录（`tree`）、`raw` 文件、release 资源或 `.okbot` 直链。解析后下载并走与本地导入同一套助手包管线（`manifest.json` + 可选 `SOUL.md` + `skills/`）。仓库根会尝试常见路径（`/`、`assistant`、`assistant-package` 等）或根目录 `.okbot`。仅公开源，不读环境变量令牌；失败时有明确错误与加载态。成功导入的 URL 写入 `settings.assistantMarketplace.savedSources`（最多 20，可一键再导入或移除）。
- **连接器 Tab**：推荐 MCP 服务器预设（Memory / Sequential Thinking / Fetch）；一点即写入 `settings.mcp.servers`（**默认未启用**，需到「设置 → MCP扩展」打开并测试）。可跳转 MCP 设置。预设见 `features/bots/marketplaceConnectors.ts`。
- 数据：内置包在 `packages/agent/gallery/<id>/{zh,en}/`（`manifest.json` + `SOUL.md` + `skills/`；顺序见 `order.json`）；加载在 `packages/agent/src/assistantGallery.ts`（离线读盘；打包进 desktop `Resources/assistant-gallery`）；URL 解析在 `packages/agent/src/githubAssistantSource.ts`；拉取在 `apps/desktop/electron/storage/fetchGithubAssistant.ts`。安装经 `FileStorage.installAssistantPackage`。IPC / 网关 RPC：`listAssistantGallery`、`installGalleryAssistant`、`importAssistantFromUrl`。UI：`features/bots/AssistantMarketplacePage.tsx`。

### 4.5 首次使用引导

没有任何助手和小队、且未选中会话时，主区显示「三步开始使用 OkBot」（`features/onboarding/QuickStartPanel`）：

1. **接入一个模型**：还没有带模型的供应商时，按钮打开设置 → 模型接入。完成后显示勾。
2. **选一个助手**：内嵌市场卡片，一点即用；或「自己创建」走原有新建助手流程。没有模型前这一步看起来不可操作。
3. **发出第一条消息**。

高级设置默认隐藏（见 §6「显示高级设置」），新手只看到常用项。

---

## 5. 小队（Squad）

- 星型拓扑：**内置虚拟队长**（非花名册 bot，`SQUAD_CAPTAIN_SPEAKER_ID = '__captain__'`）通过 Agents-as-Tools（`ask_*`）咨询成员；队长为唯一中枢，队员互不通话。无依赖时可在同一轮并行调用多名队员（SDK 对同轮多个 function tool 并发执行 `execute`）。  
- 队员工具名经 `allocateAskToolNames` 去重（`ask_base`、`ask_base_2`…）；队长 prompt 的 `toolHint` 与真实工具名一致（含后缀）。  
- 数据：`~/.okbot/squads.json` + `~/.okbot/<squadId>/session*.`。  
- **创建向导**（`SquadWizardModal` 右侧抽屉）：名称、成员（搜索拖拽）、每成员角色、可选小队模型；「显示高级设置」开启时另有只读描述与 **高级**（定时任务，同助手折叠块）。  
- **设置 → 系统指令**：子 Tab 助手 / 小队 / SOUL.md / 记忆 / 技能（角色句、小队人设、SOUL/skills/记忆静默刷新的 system 与窗口条数）。  
  - 默认队长人设强调编排与把关（目标约束、角色边界、中立务实、效率可控、结果负责）；空字符串会回落到 `DEFAULT_SQUAD_CAPTAIN_PERSONA`。已写入 `settings.json` 的自定义文案不会被新默认覆盖。  
  - 默认 Playbook 覆盖准备→澄清→拆解→路由→校验→冲突→汇总→异常→边界→跨队员传递；空字符串回落 `DEFAULT_SQUAD_PLAYBOOK`，已存自定义同样不覆盖。  
- 会话 UI：成员呼叫/回复气泡带 speaker 头像；队长终泡无头像。列表仍用 `SquadAvatar`。队长分段封印后若终泡为空，聚合 usage 挂到最后一段已封印队长气泡；用量统计只记在小队 owner（不向成员 byOwner 分摊）。  
- 全局搜索包括小队聊天消息，与私聊一致。  
- **编排器与忙碌发送**：`chatStart` 先进入主进程编排。**空闲**时开一轮主回合（用户可见回复由该回合发出）。**忙碌 + composer**（以及看似空闲但可能刚踢出 auto-continue 时）软改向：取消待续跑、中止该 owner **全部**在途回合（含 auto_continue），再带上新用户消息重开同一活跃上下文（模型自行判断补充 vs 额外事项；桌面不再做意图分类或并行 composer 分叉）。**忙碌 + schedule/api** 不软改向，可走并行门闩（每 owner 默认最多 **3** 路，超出 FIFO 排队；任务条在未完成回合 > 1 时显示）。**任务进度 auto-continue**：回合干净结束后若该 owner 的 `task-progress` 仍有 pending/in_progress，主机自动发起静默续跑（合成用户提示写入会话供模型看，**不**显示用户气泡）；不限次数，直到清单无未完成项、用户 **停止** / abort / 中途 composer 软改向、硬错误，或续跑后进度指纹连续两次未变（先加严提示再试一次，仍不变则停，防空转）。显式 **停止**（`chatAbort`）中止该 owner **全部**在途回合并取消排队与待续跑；被停止的回合以 `done.aborted` 结束（**不**把 AbortError 抛回 `ipcRenderer.invoke`）。会话 jsonl 按 owner 串行；并行回合用 `runId` 隔离模型上下文。**小队**暂仍为忙碌即并行。

### 定时任务

用户可以说「每天九点提醒我…」：模型通过内置工具 `manage_schedule`（create / list / pause / resume / delete）把任务写到当前助手或小队目录下的 `schedules.jsonl`（一行一个任务；新任务 id 为 ULID；从旧 `schedules.json` 加载时自动迁移并保留原 id）。

**审批**：默认**自动允许** list / pause / resume（`manage_schedule` 在 `DEFAULT_TOOL_PREFERENCES` 中为 `allow`）。**create / delete 无论工具审批设置或 AAR 如何都要用户确认一次**；`list` 只读、永不弹审批卡；pause / resume 在工具设为「询问」时可走 HITL/AAR。各助手/小队的定时任务在**编辑助手 / 编辑小队**中查看与管理（`SchedulesList`：暂停/恢复、删除走应用内 `requestConfirm`；设置 → 工具不列任务列表）。

**日程**：`daily HH:MM`、`hourly`（可带分钟）、`every N m`（N 须整除 60，如 1/2/3/4/5/6/10/12/15/20/30）、以及 5 段 cron；可选 IANA `timezone`（省略则用 `settings.timezone`，再否则用运行 OkBot / `okbot serve` 的机器本地时区）；`once` 为真时只触发一次后自动停用。每个助手/小队最多 **50** 个任务。

**触发**：到点后，拥有网关的进程内 `scheduleTicker`（约每 20s）发起一轮普通对话（用户气泡带「【定时】」前缀；走与手动发送相同的并行上限、停止与任务条；工具审批与预算与交互轮次相同）。**应用或 `okbot serve` 没在跑时不会触发**；再次启动后若某任务的下次时间已过，会补跑一次并推进下次。同一任务若上一轮还在跑，不会叠跑。不是工作流引擎，也不做任务看板。


实现：`packages/agent/src/squad.ts`（`runSquadChat` + 导出 `buildCaptainSquadInstructions` / `allocateAskToolNames` + `onSquadExchange`）；压缩共用 `apps/desktop/electron/storage/sessionCompression.ts`。

---


## 5.1 私聊助手互聊（Mesh）

与小队不同：仅在 **1:1 私聊** 中，当前助手可看到其他助手的名称+描述花名册，并通过工具 `ask_assistant` 向另一名助手求助。

- **小队不变**：队长仍用 `ask_*` 星型编排；小队 prompt / 工具集不注入 mesh 花名册或 `ask_assistant`。
- **花名册**：系统提示中列出其他助手的名称与描述（不含 SOUL / 技能 / 记忆正文）。无其他助手时提示「没有可求助的助手」。
- **工具 `ask_assistant`**：参数 `assistant`（精确名称或 id）+ `task`。按精确名称解析，重名则要求用 id；找不到则返回明确错误。
- **嵌套深度 / 每轮次数**：无上限；被求助方仍可继续向第三人求助。不再提供设置项。
- **防循环**：调用链上已出现的助手不可再被求助（A→B→A / A→B→B 均拒绝）。
- **嵌套回合**：被求助助手的子运行最大回合复用 `settings.squad.memberMaxTurns`。
- **会话 UI（终态）**：主聊天区不展示求助/回复气泡（含旧版「向 @助手 求助：…」气泡，渲染时隐藏）。每次求助只在**该跳求助方自己的会话**插入居中状态行「已发消息给」+ 可点击头像名称胶囊（`ChatMessage.meshExchange`，`direction: sent`）；对方回复落地后再插入「消息来自」行（`direction: received`）。嵌套互聊（A→B→C）时，B→C 的状态行只出现在 B 的会话，不会冒泡到 A（用户↔A）的会话；祖先会话只看到自己直接求助的那一跳。**被求助助手自己的会话**在收到求助时也写入「消息来自」（来源=求助方）。相邻多条来自同一助手的「消息来自」在界面合并为「x条消息来自」（与普通气泡时间分隔同一规则：间隔严格大于 5 分钟则不跨段合并，中间仍显示时间标签）。**仅胶囊**可点，打开只读往来面板（面板内气泡间距与主会话 `.messages-content` 同为 12px）。被求助助手返回后，当前助手用一条正常回答气泡把结果告诉用户。模型被要求对用户说话时不提及工具名或互聊机制。小队 `ask_*` 气泡编排不变。
- **落盘**：往来元数据写在各方 `~/.okbot/<botId>/session.jsonl` 状态行的 `meta.meshExchange`（含 `direction` / `ask` / `reply` 等）；**没有**单独的 peer 会话文件。
- 实现：`packages/agent/src/mesh.ts`；1:1 接线 `startBotTurn` / `coldRestoreBot` + `createMeshExchangeHandler`；UI `MeshExchangeModal` / `meshStatusDisplay`；`settings.mesh` 为空对象（兼容旧配置）。


## 6. 设置（`SettingsModal`）

左侧导航 Tab：

**显示高级设置**（`settings.showAdvancedSettings`，默认关）关闭时，侧栏不显示 **安全防护 / 网关服务 / 电脑连接 / MCP扩展**，模型页不显示上下文压缩；全局搜索也不列出这些项；助手资料抽屉的 **高级**、小队编辑的 **高级**（定时任务）、会话右键 **请求地址**、用户气泡 **查看上下文**、助手气泡 **消耗统计 / 链路追踪** 一并收起。功能本身不变，只是收起。从别处直接跳到高级页（例如「请求地址」提示去开网关）只在这次打开的设置窗口里显示高级页，不改保存的开关。已有的 `settings.json` 缺这个字段时（旧配置，那时所有页都显示），读盘时按「已打开」处理；新装没有 `settings.json`，按「关」处理。

| Tab（侧栏文案） | 内容 |
|-----|------|
| **通用设置** | 主题（系统/浅/深）、语言（系统/中/英）、**时区**（`settings.timezone`：可搜索 IANA 下拉；默认「自动检测」并显示当前主机时区与当地时间；显式选定后供定时任务等在 job 未写 timezone 时回退）、**半透明**（`settings.translucent`，默认开；关则去毛玻璃/vibrancy/透明窗）、缩放特效（默认关；? 说明仿 MacOS Dock 动效）、麦克风、硬件加速（改后需重启）、**系统通知**（默认开，见 §3.1）、**关闭窗口时**（`closeAction`：每次询问 / 最小化到托盘 / 退出，见 §3）。**高级**：**显示高级设置**（`showAdvancedSettings`，默认关）、`developerMode`（开发者模式，默认关；关闭时侧栏不显示「系统指令」，若当时正停在该页，回到通用设置）。**数据**：数据目录、备份时不含密钥（默认开）、导出备份、从备份恢复（见 §12.1）。**不含**更新控件、网关服务与电脑连接。**默认助手**仍可由侧栏右键设/取消（`settings.defaultAssistantId`），通用页不再展示该下拉 |
| **模型接入** | **自定义供应商**（可多条；行右端统一展开/收起箭头，展开后在行内级联嵌套「请求接口」与「模型列表」，样式同前略收窄：名称 / BaseURL / API Format / API Key / 每供应商模型目录）；模型行**连通测试**（按该供应商 baseURL/apiKey/apiFormat 对模型 id 发最小探针，IPC `testModelConnection`）；全局**默认模型**（下方下拉，供应商→模型；列表行不再用星标设默认）；模型列表按显示名 A–Z 稳定排序（无显示名则用 id；启停不打乱相对序；供应商顺序不变）；助手/小队覆盖同为 `providerId`+`modelId`；上下文压缩（自动换题、比例、保留上下限、摘要字数；新装默认更早压缩、多留原文） |
| **工具授权** | 内置工具启用 + 审批策略（自动允许 / 询问；含 `read_skill`、`manage_schedule`、`web_fetch`、`web_search`）；**网页**小节（`settings.web`：搜索服务商 Tavily/Brave/Serper/自定义、API Key；自定义时另填接口协议与 base URL；内置三家始终走官方端点；`web_fetch` 是否允许内网）；**自动审批规则（AAR）** 列表（允许/先询问、关键词、失焦自动保存草稿；空规则丢弃；重名校验；列表限高滚动） |
| **安全防护** | 总开关、拦截模式（reject / tripwire）、限制在家目录、允许/拒绝路径前缀、可编辑的危险 shell 正则列表（缺省用内置，可恢复默认）；与审批关系说明 |
| **网关服务** | 页内小节为「网关配置」。说明在「HTTP API」一行（小节标题不再带问号）。其下为端口、访问令牌、局域网网关、提供 Web UI（默认关；见 §6.1）。Web UI 开关打开时，开关左侧有「打开 Web UI」链接（`http://127.0.0.1:<端口>/?token=`，与登录页打开方式相同）；关掉则不显示 |
| **MCP扩展** | MCP 服务器（默认关，见 §7.1）。只在桌面端可改；网关页只读 |
| **电脑连接** | 列表表头「电脑名称 / 添加电脑」。本机在列表中但没有连通测试、编辑、删除、开关。远程行有这四项；关闭后不能当默认、也不参与路由。下拉只含本机和已启用的远程电脑。见 §6.2 |
| **系统指令** | 仅开发者模式打开时出现在侧栏。子 Tab 顺序：助手 / 小队 / SOUL.md / 记忆 / 技能。「助手」：1:1 角色句模板（`settings.instructions.assistantRoleTemplate`，`{name}` 占位，空则恢复默认）；「小队」：队长人设、Playbook、队长/队员 maxTurns（`settings.squad`，与 1:1 无关）；「SOUL.md」：静默维护完整 system 模版（`soulMdRefreshSystemPrompt`）+ 分析最近消息条数（`soulMdRecentMessageLimit`，默认 12，钳制 1–100）；「记忆」：范围判定说明（`settings.memory.scopeInstruction`）+ 分析最近消息条数（`recentMessageLimit`，默认 20）；「技能」：生成/更新 skill 判定指令（`skillsCreateUpdateInstruction`，仅替换 system 中那一行）+ 分析最近消息条数（`skillsRecentMessageLimit`，默认 20）。空字符串恢复默认；缺字段读盘时由 normalize 填回，下次保存写回。侧栏图标为文档形（与小队区分）。 |
| **全局记忆** | **全局记忆**列表（`~/.okbot/memory.md`，增删改，限高滚动）。scope 判定说明已迁至 **系统指令 → 记忆**。助手资料抽屉 **高级 → 记忆** 仍只管理本助手记忆 |
| **用量分析** | 见 §9；按助手/小队列表有内边距 |
| **自动更新** | `autoUpdate` 开关与手动检查/下载/安装（从通用迁出；route id 仍为 `updates`） |

默认工具策略（`DEFAULT_TOOL_PREFERENCES`）：内置工具默认全开；多数默认自动允许（含 `read_file` / `read_skill` / `write_file` / `edit_file` / `run_shell` / `generate_image` / `search_history` / `manage_schedule` / `web_fetch` / `web_search`）。**`manage_schedule` 的 create / delete 始终需要确认一次**（与工具审批设置、AAR 均无关；`resolveToolApproval` 对 create/delete 强制 ask）；`list` 永不审批；pause / resume 跟随该工具的审批策略并可走 AAR。写/执行仍可走 AAR，未命中再 HITL（当审批设为询问时）。`web_search` 未配置搜索（缺 API Key，或自定义缺接口地址）时仍暴露工具，调用会返回明确错误提示去设置配置。

设置内可深链 `focusSection` / `data-settings-id`（全局搜索跳转）。`SettingsHelpTip` 经 portal 挂到 `document.body`（高 z-index），避免被 settings shell / body / card 的 overflow 裁切。

**多供应商**：`settings.model` 为 `{ providers: ModelProvider[], defaultProviderId, defaultModelId }`。旧版扁平 `{ baseURL, apiKey, apiFormat, models, defaultModelId }`（及更早的 `{ model, contextWindow }`）在 `normalizeModelSettings` / 读盘时**就地改写**为一个名为「默认」的供应商，不再双读。同一供应商内模型 `id` 与 `name`（trim 后、区分大小写）均不可重复。`apiFormat` 仅 `chat_completions` | `responses`（OpenAIProvider `useResponses`）；UI 选项展示路径：`Chat Completions (/chat/completions)`、`Responses API (/responses)`。**不**支持 Anthropic `/v1/messages`。

**最大输出窗口**（模型编辑对话框「最大输出窗口」）：每模型 `maxTokens: number | null`。**不填 / `null` = 跟随服务商默认**（请求不带 `max_tokens` / `max_output_tokens`）；填了正整数才经 `resolveModelConfig` → `Agent({ modelSettings: { maxTokens } })` 发出（Chat Completions → `max_tokens`，Responses → `max_output_tokens`）。缺字段或非法值解析为 `null`，不补数字默认；已保存的数字（含旧默认 `128000`）原样保留。仍受网关/模型硬上限约束。与工具输出截断（`MAX_TOOL_OUTPUT`）无关。

**显示思考过程**（模型编辑对话框「显示思考过程」/ `showThinking`，缺省 **true**）：MiniMax 等模型回复中的 `<think>…</think>` 默认在助手气泡内以可折叠「思考过程」块展示（纯 CSS `<details>`，默认收起）；关闭后从展示路径剥离，并在落盘助手正文前剥离，历史更干净。1:1 与小队均按当前解析模型生效。

**1:1 运行最大回合**（无设置项）：硬编码 `DEFAULT_RUNNER_MAX_TURNS`（100），经 `buildRunOpts` → `runner.run({ maxTurns })` 作用于 1:1 `runAgentChat` / HITL 恢复；避免落入 SDK `DEFAULT_MAX_TURNS=10`。旧配置里的根级 `settings.maxTurns` 已忽略。小队仍用 `settings.squad.captainMaxTurns`（默认 50）与 `memberMaxTurns`（默认 50），互不影响。


**消息链路**（瀑布时间轴）：同一轮录音在内存里建成 `MessageTrace`（`turnId` / `spans[]`：`model` / `tool:*` / `wait_approval:*` / `system` 如 `compress`），回合结束时写入该助手气泡的 `trace`（session.jsonl `meta.trace`）。气泡「链路追踪」→ 瀑布图（可展开看输入/输出摘要；可选 JSON）。


### 6.1 本地 HTTP API（loopback）

> 路由表与鉴权边界以 [`DESIGN.md`「网关 HTTP」](./DESIGN.md#网关-http) 为唯一权威；本节只写产品行为与默认值。

供**本机其他程序**通过 HTTP 向助手或小队发送消息，走与 UI 相同的 `chatStart` / `startChatTurn` 路径（持久化 + `chatEvent`，界面实时更新）。

- **开关默认关**（`okbot serve` 与 Electron 在端口空闲时仍会听端口，见 §6.1.1）。设置 → **网关服务**（小节「网关配置」，总开关「HTTP API」）：端口、访问令牌。令牌字符集为 `[A-Za-z0-9_-]`（输入时即过滤）。**已有令牌就复用**，读设置、保存设置、附着到已有服务都不会另造一串。只有磁盘上还没有令牌时，由真正拉起服务的进程生成并写入（`ensureGatewayToken`）；设置里的「重新生成」是单独动作。规范化不会因为「已启用且为空」就生成。复制读的是服务正在核对的那串，不是输入框里尚未落盘的草稿。窗口附着到已有 `okbot serve` 时，bootstrap / settings 的 JSON 里令牌仍是空的；界面经鉴权后另请求 `GET /v1/gateway-token`，把设置页输入框和复制都填成服务正在核对的那串，不会因为空字段再造一串。`settings.json` 权限为 `0600`。一键复制 curl **不**把真令牌放进剪贴板，占位为 `$OKBOT_TOKEN`。
- **仅绑定 `127.0.0.1`**，不对外网开放。未开局域网时校验 `Host` 必须是 localhost / 127.0.0.1 / ::1（减轻 DNS rebinding）。开启局域网网关后绑定 `0.0.0.0`，仍靠令牌鉴权。
- 鉴权：`Authorization: Bearer <token>` 或请求头 `X-OkBot-Token: <token>`（`GET /v1/health` 无需令牌）。
- 端点（保持精简）：
  - 健康检查、bootstrap、花名册、消息收发、SSE、工具审批、RPC、设置补丁等路径见 [`DESIGN.md`「网关 HTTP」](./DESIGN.md#网关-http)，此处不重复罗列。
    - **默认（非 SSE）** → **202** `{ ok: true, sessionId }`（`sessionId` 即 bot/squad id）。与 UI 一样走 `startChatTurn`：若该会话已有回合在跑，新 POST **并行**（或排队）开新回合，**不**中止旧回合；HTTP 响应本身不等最终回复。
    - **SSE**：请求头带 `Accept: text/event-stream` → `Content-Type: text/event-stream`。先订阅再开回合。连接以本请求的 `user_message` 为起点，流到**本回合**结束（`startChatTurn` promise 结算）为止；并行兄弟回合的 `done` 不会单独拆掉这条 SSE。`tool_request` **不是**结束；审批等待期间连接保持。客户端断开只停止写入，不中止本轮；窗口关掉时用上面的审批 / 中止接口收口。`res.write` 背压不会当成断流。禁用 API 时会拆掉已有 SSE 连接。
- SSE 帧：`event: <RuntimeEvent.type>`，`data:` 为完整 `RuntimeEvent` JSON（与 UI IPC 同源）。常见 `type`：`user_message` / `assistant_message` / `delta` / `tool_request` / `tool_result` / `done` / `error`。
- 示例（SSE）：

```bash
curl -N -X POST "http://127.0.0.1:<port>/v1/bots/<botId>/messages" \
  -H "Authorization: Bearer <token>" \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"text":"你好"}'
```

- 实现：`apps/desktop/electron/localHttpApi.ts`；设置变更时重启监听。Electron 自己拉起的服务，在退出时停止；`okbot serve` 拉起的服务，退出 Electron 不会停（附着行为见 §6.1.1）。
- 开启 **局域网网关**（`bindLan`）时可绑定 `0.0.0.0`，供内网手机访问；开启 `serveUi` 时托管与桌面相同的渲染端静态资源。未登录时浏览器 `GET /`、`GET /gateway-login` 返回令牌输入页（HTML），不再是 JSON `unauthorized`。`/v1/*`（除 `GET /v1/health`）仍要 Bearer / `X-OkBot-Token`。登录后 `?token=` 或 cookie 继续打开同一套桌面 UI。

### 6.1.1 服务器命令 `okbot serve`

不打开 Electron，用 Node 跑与桌面同一套网关（`localHttpApi`）。适合只开服务、窗口按需再连。

**构建**

源码入口 `apps/desktop/electron/cli.ts`。`apps/desktop/electron.vite.config.ts` 主进程 `input` 含 `cli`；`electron-vite build` 打成 `apps/desktop/out/main/cli.js`，并加 `#!/usr/bin/env node` shebang。在仓库根目录：

```bash
pnpm --filter @okbot/desktop build
```

该命令先构建 `@okbot/agent`，再跑 `electron-vite build`。`pnpm dev` 同样会按 vite 配置产出 `out/main/cli.js`（与 build 同一套 main input）。没有单独下载成品的安装脚本，需在本仓库构建后使用。

**用法**

构建完成后任选其一：

```bash
node apps/desktop/out/main/cli.js serve
```

```bash
okbot serve
```

或 `node apps/desktop/bin/okbot.mjs serve`。包的 bin 是 `okbot`（`apps/desktop/bin/okbot.mjs`），它只负责加载已构建的 `out/main/cli.js`；找不到时提示先构建。

命令读 `~/.okbot` 里已保存的端口、绑定（`bindLan`）、令牌与是否提供 Web UI（`serveUi`），在前台监听。令牌已经存在就原样复用，不会在启动时换一串；只有还没有保存过时才生成并写入。**不**改动桌面里 HTTP API 开关的取值。启动成功后打印地址、绑定和正在使用的访问令牌（只在这一次启动输出里，请求处理过程不打印令牌）。端口上已有 OkBot 时直接退出，不打印令牌。`Ctrl+C`（或 `SIGTERM`）停止。浏览器打开打印出来的地址并用该令牌登录（需已打开「提供 Web UI」）。curl / 其它客户端用 `Authorization: Bearer <token>` 或 `X-OkBot-Token`（示例勿贴真实令牌，可用 `$OKBOT_TOKEN`）。

**单实例**

同一 `~/.okbot` 只允许一个服务听端口：先 `GET /v1/health`（`service` 为 `okbot-local-http-api`），再看数据目录锁 `~/.okbot/server.json`（含 `pid` / `port` / `owner`：`serve` 或 `electron`）。已是 OkBot 或锁里的进程还活着 → 提示已在运行并退出，不再起一份。端口被别的程序占用（`EADDRINUSE` 且健康检查不是 OkBot）→ 提示占用，也不冒充已在运行。

**与 Electron 窗口的关系**

Electron 启动时做同样检查：

- **已有服务在听**：窗口只作界面客户端（`ownsServer=false`）。加载与普通启动相同的本地渲染端（`file://` 或 dev server），**不**导航到网关源站；`attach` preload（`electron/attachPreload.ts` → `out/preload/attach.mjs`）把已保存的地址与令牌交给渲染进程，请求带 `Authorization`。附着**不**生成新令牌。关掉窗口**不**停那个进程，也**不**删其锁。设置页不读 bootstrap 里的空令牌，而请求 `GET /v1/gateway-token` 取服务正在核对的那串，输入框与复制一致。
- **端口空闲**：Electron 调同一个 `listen` 拉起服务，写入 `server.json`（`owner: electron`）。这次若是它拉起的，退出时停止监听并放开锁。

实现：`cli.ts`、`serverPresence.ts`、`gatewayRuntime.ts`（`ensureGatewayToken` / UI 根路径 / 技能热重载）、`main.ts` 附着分支、`src/bridge/httpOkbot.ts`（读 `__okbotAttach`）。

### 6.2 云电脑（sandbox-agent）

远程执行目标：独立进程/容器 `apps/sandbox-agent`（包名 `@okbot/sandbox-agent`）。即使在裸服务器上运行 sandbox-agent，也可在 OkBot 设置中登记为云电脑。

- 设置 → **电脑连接**：列表与模型列表同一套表头/行。表头是「电脑名称」和「添加电脑」。添加、编辑共用名称 / 主机 / 端口 / 令牌（`SANDBOX_TOKEN`）表单。**本机**始终出现在列表里（id=`local`），没有连通测试、编辑、删除、启用开关，也不写入 `computers`。远程行有这四项。`enabled: false` 的电脑不能选为默认，也不进入路由。同一页下拉选择**恰好一台**默认电脑（本机或已启用的远程电脑）。没选过时默认是本机（空的 `defaultComputerId` 即本机）。所选电脑已删除或被关闭时不会偷偷改回本机，需要重新选。默认值存在 `settings.defaultComputerId`。  
- **先探测再保存**：添加和编辑点保存时都先 `probeComputer`（约 5 秒超时）。`GET /v1/health` 必须返回 `ok: true` 且 `service` 为 `okbot-sandbox-agent`；再用该令牌 `POST /v1/shell` 空正文，期望 **400** `command_required`（只验令牌，不执行命令）。连不上、不是 sandbox-agent、令牌不对或响应异常时**不写入**，并在对话框里提示。列表上的连通测试只检查、不保存。
- 对话区没有电脑选择。用户没点名电脑时，shell 与文件工具在默认电脑上执行。点名恰好一台（名称或 id；本机可以说「本机」）时改到那台。点名多台时，每次 `run_shell` / `read_file` / `write_file` / `edit_file` 须带 `computer`（id 或名称），分别在对应电脑上执行。HTTP API 请求体里的 `computerId` 只作为这一轮的默认电脑，对话点名优先。选择规则集中在 `packages/agent` 的 `computerSelection`，并写入当轮系统提示。
- 协议：Bearer；`GET /v1/health`；`POST /v1/shell`（可选 SSE）；`POST /v1/fs/read|write|edit`。
- 技能（`read_skill`）与文生图仍在**桌面主机**执行，不随电脑切换。
- 实现：`packages/agent` 的 `ExecutionBackend`（local + remote）与 `computerSelection`；`buildTools` 按该策略解析 backend。Dockerfile：`apps/sandbox-agent/Dockerfile`。验收清单：`docs/acceptance-cloud-gateway.md`。

### 6.3 桌面网关与同一套前端

- `localHttpApi.bindLan` + `serveUi`：主进程在 LAN 上提供既有 HTTP API，并托管 renderer 构建产物。
- 浏览器无 Electron preload 时，`src/bridge/httpOkbot.ts` 安装同源 HTTP/SSE 适配器，复用同一 React UI（不另建移动端 SPA）。
- 桌面与网关的会话列表经 `sessions_changed` 互相同步（见 §3.1）；网关页用 `GET /v1/events` 收这一条，不靠当前会话的聊天 SSE。  
- 附着窗口和 Web UI 能像桌面端一样新建、编辑、删除助手和小队，走完新助手引导，发现模型、测连通、立即压缩（经 `POST /v1/rpc/:op`）。网关返回的 API Key 是空的：发现模型和连通测试只带供应商 id，服务端只在 BaseURL 和已保存的一致时才用已保存的密钥。经网关测试时 BaseURL 必须是已保存的某个地址（否则 400 `probe_url_not_saved`，界面提示先保存再测试），避免借网关去请求内网任意地址。
- **令牌等同于完全控制**：拿到令牌的人能聊天、批准工具（含运行命令和改文件）、改助手人设、记忆和技能、立即压缩会话。登录页和设置里的令牌说明都写明了这一点。
- 网关只能用工具卡上的「总是允许」加规则，规则内容必须正好是一个内置工具名；也可以做只会多问的改动（加「询问」规则、删「允许」规则、关自动审批）。宽泛的关键词「允许」规则和改已有规则只能在桌面端做，设置页的规则列表在网关页只读（见 DESIGN「网关可写的设置」）。网关还可以保存 `notifications`、`showAdvancedSettings`。模型密钥、工具启用与审批策略、安全防护、电脑连接、网关配置、MCP 仍只能在桌面端改；网关写这些键返回 409 `settings_not_allowed`。网关返回的 MCP 环境变量和请求头的值是空的。
- 网关可以用市场新建助手。网关不能按文件路径导入、导出助手包，也不能做数据备份与恢复（这一节在网关页显示为不可操作）。语音转写在网关页不可用。

---

## 7. 本机工具与安全

工具（`packages/agent/src/tools.ts`；shell/fs 经 `ExecutionBackend`，网页工具在桌面主机直接 HTTP）：

- `read_file` / `read_skill` / `write_file` / `edit_file` / `run_shell` / `generate_image` / `search_history` / `manage_schedule` / `web_fetch` / `web_search`  
- `search_history(query, limit?)`：仅检索**当前**助手或小队会话（时间索引路径），结果截断；默认自动允许；不跨会话  
- `read_skill(slug)`：加载本助手已启用技能（本地优先，其次启用的全局）的完整 SKILL.md；系统提示只含目录，属渐进披露  
- `generate_image(prompt, aspect_ratio?, model?)`：用**当前对话**供应商的 `baseURL`/`apiKey` 自动推断文生图能力——MiniMax 主机 / 名称含 minimax / 目录含 `image-01*` → `POST {baseURL}/image_generation`；OpenAI / Azure 主机或目录含 `dall-e*`·`gpt-image*` → `POST {baseURL}/images/generations`（`b64_json`/`url`）。不跨供应商回退、不自动切换私有/其它模型供应商。**prefs 开启即暴露工具**（本机工具列表 / `buildTools` / 电脑路由文案同一门槛，与 `web_search` 未配置仍暴露一致）；推断失败时工具仍注册，调用返回明确错误（并禁止模型用 SVG / `data:image` / `write_file` 手绘冒充）。图片落盘 `~/.okbot/<botId|squadId>/resources/`，工具结果含绝对网关路径 markdown `/v1/media/<ownerId>/resources/…`（须原样写入回复；**禁止** `data:` / `file://` / 外链 https）；落盘时把遗留 `okbot-asset:` / `file://…/.okbot/…/resources/` 归一成 `/v1/media/…`。`react-markdown` 识别 `/v1/media/…`、遗留 `okbot-asset:` / `file://…/.okbot/…/resources/`，以及旧回复里的安全 `data:image/*`；渲染时经网关 `GET /v1/media/…`（`?token=` / cookie / Bearer；CSP 允许 loopback `img-src` 与 `data:`，不含任意 https）。网关不可用时 Electron 仍可经 IPC 读成 data URL 回退  
- `manage_schedule`：见 §5「定时任务」。默认 allow；create/delete 始终各确认一次；list 不审批；每 owner 上限 50  
- `web_fetch(url)`：HTTP(S) 拉取公开网页并转成可读纯文本；超时约 20s、体积与正文截断；默认阻止 localhost / 私网 / 链路本地 / IPv4-mapped IPv6（含 `::ffff:a00:1` 等十六进制形式）；DNS `all:true` 校验后经 undici Agent **钉死连接**（防 DNS 重绑定 / 多 A），每跳重定向重新校验与钉死。可在设置 → 工具 → 网页打开「允许拉取内网地址」。工具结果正文包在不可信围栏内。无需 API Key；默认自动允许  
- `web_search(query, limit?)`：经用户配置的第三方搜索（Tavily / Brave / Serper / 自定义，`settings.web.search`：provider、apiKey；自定义另需 baseURL + compat 协议）。内置三家始终用官方端点；仅自定义使用 baseURL。未配置时工具仍可用，但返回中文错误提示去设置配置。密钥只在桌面端可改；网关响应与不含密钥备份会清空；结果正文同样包在不可信围栏内；默认自动允许  
- 输出截断、文件大小与二进制检测、shell 超时约 30s、cwd 默认家目录  
- `run_shell` 跨平台：Windows 优先 PATH 中的 PowerShell Core `pwsh`（`-NoProfile -NonInteractive -Command`），找不到时用 `ComSpec`（默认 `cmd.exe`）`/d /s /c`；其余平台用 `SHELL`，否则 darwin `/bin/zsh`、其它 `/bin/bash`，参数 `-lc`（见 `resolveShellExec`）

安全（`guardrails.ts` + `settings.security`）：

- **不是** OS 沙箱：`run_shell` 走本机 shell + 用户环境；防护 = 路径前缀 + 危险命令 denylist（`settings.security.shellPatterns`，缺省用内置正则，可在设置里增删改/恢复默认；无效正则跳过）+ HITL/AAR。  
- 适合可信个人本机；勿当多租户沙箱。

### 7.1 MCP 扩展（可选，默认关）

- 设置 → **MCP扩展**（需打开「显示高级设置」）。总开关 `settings.mcp.enabled` 默认关。服务器列表与添加/编辑对话框和电脑连接同一套样式。
- 两种连接：**本地命令（stdio）**（命令、每行一个参数、`KEY=VALUE` 环境变量）与 **HTTP（Streamable HTTP）**（地址、`Name: Value` 请求头）。每台可单独启停，可「测试连接」看到工具数。
- 运行时（`packages/agent/src/mcp/mcpHub.ts` + `apps/desktop/electron/mcpRuntime.ts`）：每次开跑前按设置同步连接，把每个 MCP 工具包成函数工具，名字为 `mcp_<服务器名前 20 字符>_<标签>_<工具名>`（标签是服务器 id 的 sha256 前 4 位十六进制；最长 64 字符，重名加后缀；按服务器 id 排序后命名，所以改名或增删别的服务器不会让已有工具改名），经 `extraTools` 交给 1:1 助手、HITL 恢复和小队队长。
- **每次调用都要审批**（`needsApproval: true`），走与 `run_shell` 相同的工具卡。自动审批规则对 MCP 工具无效（`resolveToolApproval`），工具卡不显示「总是允许」。
- 每次调用最长 120 秒，参数 JSON 最长 100,000 字符，超出时返回错误给模型。
- 本地命令的子进程只继承少量环境变量（如 `PATH`、`HOME`、`LANG`、临时目录；Windows 另有 `SystemRoot` 等），再加上配置里的环境变量，不继承 API Key 等其它变量。
- HTTP 地址：远程服务器必须用 `https`；`http` 只允许主机名正好是 `localhost`、`::1`、127.0.0.0/8 内的 IPv4，或 IPv4 映射形式（`[::ffff:127.0.0.1]` / `[::ffff:7f00:1]`；`isLoopbackHostname`，`127.evil.com` 不算本机）。地址里的用户名密码和像令牌的查询参数（名字含 token、key、secret、auth 等）在网关响应和不含密钥的备份里会被清空。不含密钥的备份和网关设置投影共用 `redactSecretArgs`（词表与 URL 查询共用；URL 查询另支持复数/子串如 `tokens`、`passphrase`，参数名仍按整词，避免误伤 `--pass-through`）：清空 `--token=…`、`--pass=…`、`--session=…`、`--sig=…`、`--api-key …`、`--bearer=…`、`-p`/`-p=`/`-phunter2`（非端口）、`API_KEY=…`、`sk-…`，以及 `--header` / `-H` 里凭证头或令牌形值；URL 形参数会走 `redactSecretUrl`。不误伤 `--monkey`、`--pass-through`、`--sort-key`、`--credentials-file` 这类名字。裸 `--key=` 仍会清空（`key` 本身是密钥词）。恢复时只在命令、地址和清空后的参数都一致时才把原参数放回。最好还是把令牌放在环境变量或请求头里。
- 工具返回 `isError: true` 时，按工具出错交给模型（`MCP 工具返回错误：…`），不当作成功结果。
- 设置 → MCP扩展的服务器列表在打开时读取连接状态（`mcpStatus`），每台已启用的服务器显示「已连接 · N 个工具」或「连接失败」（悬停看原因），不用手动测试就能看到连不上。
- 从备份恢复后 MCP 总开关一律关掉；重启后弹一条提示，让用户检查服务器后自己再打开。
- 只支持 MCP 工具；不接 resources / prompts。应用退出时关闭全部连接。

HITL UI：工具卡上「允许 / 永久允许 / 拒绝」。
- **停止 × 审批等待**：HITL 循环会清空工具前念叨后返回空 content；此时 **跳过** `upsertAssistantMessage`，且 storage 拒绝「无 id 匹配的空助手 upsert」，避免把上一轮助手回复 rebind 成空消息。
- **并行 × 审批等待**：用户在待审批时发送新消息 → **不**取消旧审批；新旧回合各有各的审批卡。明确 **停止** 才会中止该会话全部进行中的审批等待。

---

## 8. 对话增强

### 8.1 引用（quote-by-id）

- 悬停气泡 → 引用 → 输入区出现预览条。  
- 发出的用户消息带 `quoteMessageId` + `quotePreview`；气泡上方可点引用条 **跳转到原消息**（高亮）。`quotePreview` 与送给模型的引用正文会先去掉 `[Attached]` 里的图片路径。  
- Agent 侧：按消息 id 取原文，再交给本轮 `sessionInputCallback`（引用不是把 `>` 写进气泡正文）。

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
5. 本轮结束后按节流策略静默刷新 SOUL.md / skills / 记忆（**不是每轮都跑**；**下一轮**才进 prompt）。默认：记忆约每 2 轮或累计用户字数达阈值；SOUL/技能约每 5 轮或更大字数阈值。用户文案含「记住」/ remember /「别忘了」时立刻抽记忆。一次拉取 `Math.max` 三个配置窗口条数的消息页，再分别 `slice(-limit)`。节流参数见 `settings.maintenance`。

关键代码：`apps/desktop/electron/ipc/registerChat.ts`、`packages/agent/src/instructions.ts`、`promptContext.ts`、`quoteContext.ts`、`compression.ts`、`refresh.ts`。

#### 8.2.2 instructions 各块：来源与更新时机

由 `buildAgentInstructions` **每轮开跑时现拼**（有 Session 时 `history` 传空，不注入「最近对话」块）：

回复写法也在这一层现拼：一个概念一个词、一句一事、主动语态并写清对象、条件写在动作前；闲聊不必写成手册。

| 块 | 来源 | 更新时机 |
|---|---|---|
| 角色句（你是「某助手」…） | `settings.instructions.assistantRoleTemplate` + 当前 bot 名（`{name}`） | 设置 → 指令 → 助手；每轮现拼 |
| **助手资料（花名册）** | `bots.json` 的 name / description（简介最多 200 字，只写职责/工作边界，不含通用工具能力或安全套话）；与 SOUL 冲突时以花名册为准 | 用户改名称/头像等立刻写盘；**引导结束**立刻 `seedBotDescriptionAfterOnboarding`（名称+引导+SOUL，不节流）；之后由跑后静默维护按 SOUL 节流演进（`refreshOwnerDescription`）；创建/编辑弹层仅在「显示高级设置」时只读可见；下一轮读到新值 |
| **SOUL.md** | `~/.okbot/<botId>/SOUL.md` | 新建/引导写入；资料弹层「高级」可编；改名/描述时 `syncSoulMdProfile`；用户高级写入在同次保存中优先生效；**节流后的成功回合** `refreshSoulMd`（system=`settings.instructions.soulMdRefreshSystemPrompt`，窗口=`soulMdRecentMessageLimit`）可能只修补有变化的章节（不整篇覆盖，下一轮生效） |
| **记忆** | 全局 `memory.md` + 本助手 `memory.md`（JSONL）；过期过滤后 `formatMemoriesForPrompt`（**全局/钉住优先**，本机按新→旧；超限先折叠再丢）；自动写入前经 `isAcceptableMemoryFact` 质量门（拒空/过短碎屑与裸 UI·工具名，如「删除」「定时任务」；保留去重；**不做**定期压缩/合并）；设置 → 指令 → 记忆可编 scope 判定句与分析条数；`memory.promptMaxEntries` / `promptMaxChars` 控制注入上限；设置 → 记忆可编全局列表；高级列表可编辑本助手记忆 | **开跑前**读盘；节流后的回合 `refreshMemories`；**压缩推进 coverage 时**也会对掉出窗口的增量抽记忆；下一轮生效 |
| **更早对话摘要** | `session-summary.json` 的 `summary` | **开跑前**估 token ≥ `contextWindow × ratio` 且历史够长时增量压缩并写回，推进 `coveredThroughId`；摘要可含工具短摘要；**不删** `session.jsonl`；需要原文细节时可调用 `search_history`（仅本会话，需批准） |
| **Skills（渐进披露）** | 本助手 `skills/<slug>/SKILL.md` +（可选）`~/.agents/skills` 已启用全局 → `formatSkillsForPrompt` **仅目录**（名称 / slug / 何时使用，有条数/字数上限）；完整正文不进静态系统提示，匹配后由模型调用 `read_skill(slug)`（`resolveEnabledSkill`，本地优先）加载。**SKILL.md**：frontmatter `description` 必填、最多 1024 字，写能力 + 何时使用（含触发词与「勿用于」/ Do NOT use for；第三人称）；「何时使用」/ Use when 等触发说明**只在 description**；`body` 只写 Steps/做法，不重复触发说明。slug / name 均以 `okbot-` 开头 | **开跑前**读盘目录（含热更新后的磁盘内容，见 §4.1）；`useGlobalSkills` / `enabledGlobalSkills` 在 `bot.json`；高级列表可改本地 skill / 开关全局；节流后的回合 `refreshBotSkills` 可能 upsert（system 含 description 格式约束；写入时 `normalizeSkillDescription` 软钳制）；下一轮生效；「查看完整上下文」同样只见目录（正文仅出现在本轮 tool 结果中） |
| 工具说明 / 编码偏好句 | 设置里的工具开关与审批模式（含 `search_history`） | 改设置后下一轮生效 |

instructions **拼装顺序**：稳定块在前（角色 / 花名册 / SOUL / 回复写法 / 工具说明），易变块在后（记忆 / 会话摘要 / 技能目录），以利于服务商前缀缓存。

估 token 用的静态文本大致含：SOUL + skills + memories + 花名册 + 本轮用户正文，再加上摘要，以及未压缩尾部里的正文、工具参数和工具结果。阈值始终用**当前**解析出的模型 `contextWindow`（换小窗口模型也会立刻按新窗口压）。

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
- **引导结束立刻种子花名册简介**（`seedBotDescriptionAfterOnboarding`，不节流）→ 之后轮次可见。  
- **跑后静默维护 SOUL / skills / 记忆 / 花名册简介**（节流，见 `settings.maintenance`；简介与 SOUL 同节流，小队仅演进简介）→ 只影响之后轮次。

#### 8.2.5 小队

队长会话与 1:1 **同一套** Summary+Buffer：`ensureSessionCompressed` 在开跑前按小队 `contextWindow` 估 token，推进该小队的 `session-summary.json` / `coveredThroughId`，Session 视图同样只暴露未压缩尾部。静态估量含小队名/简介、队长人设与 Playbook、成员花名册（名+角色）、本轮用户正文。

成员被 `ask_*` 咨询时，带上**该成员自己的** SOUL（及对应 skills **目录** / 记忆等）跑嵌套回合，并挂载同一套本机工具（含该成员绑定的 `read_skill`）；队长侧只有花名册与编排工具、无成员 skill 正文；队长侧 Session 留下呼叫/回复相关项，UI 画成小队气泡。

### 8.3 Prompt 上下文弹窗（实时投影）

- 用户气泡悬停「查看上下文」：按 **8.2** 用当前 SDK Session + **此刻**系统材料重建（`formatSessionPromptContext`），结构为 `## instructions` + `## session items`。  
- IPC `getPromptContext` 的 `botId` 实为 **ownerId**（助手或小队，preload 兼容旧字段名）。  
  - **1:1**：`buildAgentInstructions`（SOUL / skills / 记忆 / 角色模板 + session summary）。  
  - **小队**：`buildCaptainSquadInstructions`（与 `runSquadChat` 一致：settings.squad 人设/playbook、成员花名册 name/role/description、`allocateAskToolNames`、summary；`history: []`；成员 SOUL/skills/memories 不进队长 instructions）。  
- **不是**发送时冻结的历史快照；之后若静默改过 SOUL / skills / 记忆（或小队设置），再点同一条消息可能与当时模型所见略有差异（弹窗文案已说明）。  
- 截断到该条用户消息 id；若有 `coveredThroughId`，session items **只投影未压缩尾部**（与模型本轮窗口一致），更早内容见 instructions 中的会话摘要——**不会**再把已摘要的旧气泡原文当 session items 铺开。  
- `hasPromptContext` 字段已废弃，仅兼容旧载荷。不再落盘 `contexts/`。

### 8.4 上下文压缩（Summary + Buffer）

- **比例触发**：估 token ≥ `contextWindow × ratio`（新装默认 ratio `0.6`；已有 `settings.json` 里写过的值保持不变），且 live buffer 长于 `keepRecentMin`。  
- **默认保留最近原文**：新装 `keepRecentMin=8`、`keepRecentMax=12`（仍超出窗口时保留条数会降到 0）；更早内容相对上一版摘要做**增量**压缩，工具调用/结果以短摘要进入摘要器；结构化字段含目标 / 约定 / 路径 / 未完成 / 其他，字数受 `summaryMaxChars`（新装默认约 2000）约束。可在设置 → 模型 → 上下文压缩调整。  
- 写入 `session-summary.json`：`summary`、`coveredThroughId`、`updatedAt`。推进标记 **不** trim `session.jsonl`（界面气泡不删）。  
- **助手与小队共用** `ensureSessionCompressed`（`sessionCompression.ts`）；小队同样会推进自己的 `coveredThroughId`。  
- 设置：`contextCompression.*`（设置 → 模型相关区），含 **自动换题压缩** 开关（`autoTopicCompress`，默认开）。  
- **自动换题压缩**（发送路径，1:1 与小队相同）：  
  - 发送前用会话配置的模型做一次轻量 yes/no 判定（`detectTopicChange`）：新用户句是否相对近期对话 / 会话摘要开启**新话题**。  
  - 若是 → `force: 'newTopic'`（keep=0，模型只看摘要和新消息）。同一话题仍保留最近消息。  
  - 若否 / 判定失败 / live buffer 不足以压缩（≤ `keepRecentMin`）→ 不强制压缩；比例触发仍按原逻辑。  
  - 静默进行，不弹 toast。  
- 估 token / 自动压缩一律按「摘要 + `coveredThroughId` 之后的尾部」计算；`coveredThroughId` 只前进到摘要器真正读过的最后一条，不回退。「查看完整上下文」与发送路径共用同一套投影。
- 发送前若仍超出窗口，会丢掉较早的工具结果，还放不下就中止本轮；压缩得到的约定写入该助手记忆，并对掉出窗口的对话增量再跑一轮记忆抽取。

### 8.5 会话存储

- 见 **8.2.3**；文件路径见 §12。  
- 小队另有 `~/.okbot/<squadId>/session.jsonl` 与 `session-summary.json`。  
- **Finalize / rebind**（`upsertAssistantMessage`）：用 `mergeUiMessageOntoRecord` 只改 id / 纯文本 / meta，**保留** SDK 原始 `item`（Responses 的 array `content` 不得压成 Chat Completions 字符串）。无先验行时才 `legacyMessageToRecord` 追加。

### 8.6 全局搜索

- 入口：侧栏搜索。分区：会话、设置项、消息命中。  
- 可选中跳转会话 / 打开设置对应区块 / 跳到消息。  
- 消息命中包括助手私聊和小队聊天（`MessageSearchHit.ownerKind` 区分）；点小队命中会打开该小队并定位到消息。
- 实现：`electron/storage/messageSearch.ts`。用异步读取从每个聊天文件末尾往前读（`ReverseLineReader`），每次先读「读到的位置最新」的那个聊天，命中按时间从新到旧放进最多 `limit` 条的列表。已有 `limit` 条、且每个聊天读到的位置都不比最旧的那条新时就停，不再读更早的记录；所以不会读完所有文件，也不会长时间卡住主进程。一个聊天的命中多不会挤掉别的聊天的新命中。
- 聊天文件里的 `createdAt` 可能偶发回退（先写了较新的行，再补写较早的行）。每个文件有一份时间索引（约每 64 KiB 一个检查点，记下「此偏移之前的最大时间」），早期停止用检查点上界，不会因为回退行漏掉更早位置上的更新命中。索引按 inode / 头尾签名复用，文件只往后长时增量扩展。搜索过程中尚未打开的文件若被追加或重写，会按 size/mtime 刷新索引后再决定是否早停。只增长时增量扩展索引，缩小或头尾签名变了才整份重建。
- 小队里的成员回复显示成员名（`MessageSearchHit.speakerName`）；没有发言人的运行中间记录不算消息。
- 经网关调用时，搜索同时最多 2 个、每 10 秒最多 20 次，超出返回 429 `rate_limited`（`gatewayRpc.createRateLimiter`）。桌面端输入有 280 ms 去抖。

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
- UI：检查更新、下载、安装并重启；有可用更新时侧栏底部「市场」右侧蓝色更新图标（点击行为与原先顶栏一致）。
- **macOS 自装**（`electron/macUpdateInstall.ts`）：按下载的 zip 文件名在更新清单里找 sha512（文件名不含 `?` 和 `#` 之后的部分）；安装前要求 app 所在目录可写、可用空间至少为 zip 大小的 5 倍（实测解压加暂存峰值约 4.4 倍）。退出时没能开始安装，或安装助手在退出后因 sha 不符、解压失败、替换失败、重新打开失败等停下，都会写入 `update-install-failed.json`（并记 `update-install.log`），下次启动弹提示。下次启动的自愈只把 `CFBundleIdentifier` 为 OkBot 的隐藏 `.*.app.previous` 改回原名。  
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

> 模块边界与存储职责见 [`DESIGN.md`「磁盘」](./DESIGN.md#磁盘)；本节是产品侧路径一览。


- **`settings.json` 损坏**：`readJsonResult` 区分 missing / ok / invalid。解析失败时备份为 `settings.json.corrupt-*`，**不**把默认配置写回原文件（避免静默抹掉 API Key）；启动 bootstrap 会 toast 提示。合法文件的 legacy 迁移写回前先 `pre-migrate` 备份。


```text
~/.okbot/
  settings.json
  settings.json.corrupt-*      # 解析失败备份（读失败不写回默认）
  settings.json.pre-migrate-* # legacy 迁移写回前备份
  server.json                  # 网关单实例锁（pid / port / owner；okbot serve 与 Electron 共用）
  usage.json
  bots.json
  squads.json
  memory.md
  logs/
    errors-YYYY-MM-DD.jsonl    # SDK/run 失败结构化日志（保留今天+前 2 个日历日）
  <botId>/
    bot.json
    SOUL.md
    memory.md
    skills/<slug>/SKILL.md
    session.jsonl
    session-summary.json
    resources/                  # generate_image 等中间媒体
  <squadId>/
    session.jsonl
    session-summary.json
    resources/                  # generate_image 等中间媒体（与 bot 同布局）
```

### 12.1 备份与恢复

- 设置 → 通用 → **数据**。**导出备份**把整个数据目录打成一个 `.zip`（默认存到下载文件夹，文件名带日期），根目录有标记文件 `okbot-backup.json`。不打包 `server.json`、`window.json`。
- **备份时不含密钥**（默认开）：`settings.json` 里的模型 API Key、网关令牌、电脑令牌、MCP 环境变量与请求头的值被清空，`settings.json.*` 备份副本不打包。
- **从备份恢复**：先确认（危险操作），再选 `.zip`。校验标记文件和压缩包内路径（拒绝绝对路径、`..` 和链接）。有助手正在工作时拒绝。当前数据目录先整体移到旁边的 `<目录名>-before-restore-<时间>`，再解压；若备份不含密钥，沿用当前设置里的密钥，但只在端点相同时（模型供应商 BaseURL、电脑地址和端口、MCP 命令或地址都相同），避免把密钥交给备份里换过的地址。恢复后 MCP 总开关关闭，重启后提示用户（`restore-notice.json`，读一次即删）。不含密钥的备份里，像密钥的 MCP 参数也被清空。解压后总大小超过 16 GiB 的备份会被拒绝；读不出总大小时也拒绝。大小检查用 `unzip -Z -t`，并固定 `LC_ALL=C` 再解析；上限看的是 zip 声明的未压缩大小，不是解压时实测。选文件前后都会检查有没有助手在工作或等待批准。完成后应用自动重启。
- 实现：`apps/desktop/electron/backup.ts`，IPC `backupExport` / `backupRestore`（`ipc/registerExtensions.ts`）。网关不提供。

**错误日志**（`apps/desktop/electron/storage/errorLog.ts`）：1:1 `chatStart`、HITL `resumeHitl`、小队 `squadChat` 在 catch 并发 `type: 'error'` 时追加一行 JSON（`ts` / `ownerId` / `messageId?` / `phase` / `error` / `stack?`）。不写 API Key、不写用户正文；仍 `console.error`。每次写入时按日历日剪枝，删除早于「今天−2 天」的 `errors-*.jsonl`。按日汇总失败，不含用户正文与 API Key。

---

## 13. IPC 与进程边界（速查）

常量：`packages/shared` → `IpcChannels`。  
注册：`apps/desktop/electron/ipc/`（chat / entity / system）。

常见通道：bootstrap、bots/squads CRUD、settings、discoverModels、messages 分页与搜索、chatStart/Abort/Event、toolRespond、setChatUnread、getPromptContext、转写、appInfo、updater*、getUsageStats、copyText、traffic light 位置等。本地 HTTP API（`localHttpApi.ts`）在主进程内直接调用 `startChatTurn`，不另开 IPC 通道。

Preload 暴露 `window.okbot.*`；渲染进程不直连 Node fs。

---

## 14. UI / CSS 约定（聊天气泡）

- 用户：`bubble-row.user` → `bubble-row-cluster` →（quote）→ `bubble-body-row`（**actions | bubble**）。助手有 accent 色时 `.messages.has-user-bubble-tint` 覆盖 `--bubble-user` / `--bubble-user-text`（浅色洗涤）；小队无小队级色。  
- 助手：`bubble-row.assistant` → `bubble-body-row bubble-body-row-assistant`（**bubble | actions**）。  
- 共用：`.bubble-actions` 默认透明，行 hover/focus-within 显示；`.bubble-body-row .bubble-actions { margin-top: 6px }`；长气泡 `.bubble-actions` 纯 CSS sticky（同 `.bubble-speaker-avatar`，勿在 `.messages` 祖先加会打断 sticky 的 `overflow: hidden`）。  
- **短中文气泡宽度**：CJK 在 UAX#14 下 min-content ≈ 1 字；勿让助手行 `align-self: flex-start` 做 shrink-to-fit，也勿对气泡用相对「不定宽父级」的 `% max-width` / `min-width: 0` 链条。正确做法：助手行 `align-self: stretch; width: 100%`（父级定宽），气泡 `width: fit-content; max-width: min(720px, 100%)`，`overflow-wrap: break-word` + `word-break: normal`（禁止 legacy `word-break: break-word` / `break-all`）。会话存盘无零宽字符问题；根因在布局而非 markdown/流式 delta。  
- 小队：仅成员发言行加 `has-speaker`（头像列间距）；队长行不加，避免空头像占位。成员头像纯 CSS sticky（勿在 `.messages` 祖先加会打断 sticky 的 `overflow: hidden`）。  
- 早期产品：**就地改干净结构**，避免绝对定位「贴在气泡角上」的第二套交互；不引入 Motion 等重动画库。

相关文件：

- `apps/desktop/src/features/chat/ChatTranscript.tsx`  
- `apps/desktop/src/features/chat/BubbleSwipeRow.tsx`（左滑 / 水平滚轮露 HH:MM）  
- `apps/desktop/src/styles/app.css`（`.bubble*` / `.msg*` / sidebar / settings）

---

## 15. 明确未做 / 边界

- MCP 只接工具，不接 resources / prompts；默认关闭。  
- `run_shell` 非容器/seatbelt 沙箱。  
- 模型目录 **仅手动 + discover**，无复杂厂商 OAuth。  
- 虚拟队长非真实 bot；小队消息搜索按 `ownerKind: 'squad'` 跳转——改相关逻辑时勿回归。  
- 本地 HTTP API **默认仅 loopback**。只有打开局域网网关才绑定 `0.0.0.0`，仍靠访问令牌；没有面向公网的入口。不打开窗口时用 `okbot serve`（见 §6.1.1）。

---

## 16. 文档维护

1. 合并功能或重要 UI 变更时：**同一 PR/提交或紧随提交** 更新本文件对应章节。  
2. 根目录用户文档：`README.md`（英文）与 `README_zh.md`（中文）保持短述 + 指向本指南；文首保留 `English | 中文` 相对链接，两边结构同步；勿在用户 README 写技术栈 / 当前范围 / `run_shell` 诚实边界等开发向内容（边界说明留在本指南对应章节）。  
3. 本指南不要写死产品号（以 Releases / `package.json` 为准）。  
4. 以代码与近期 commit 为准，避免凭记忆写「计划中」能力。

## 已知限制

应用重启后，单助手和**小队**挂起的工具审批都能从磁盘恢复。小队成员的审批恢复后，队长会拿到成员结果，接着完成这一轮；队长不会再派一次同样的子任务。每条待审批单独落盘，并行的成员审批互不覆盖。

监听端口失败目前只打主进程日志，设置页没有单独的失败状态。

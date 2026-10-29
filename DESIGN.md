# OkBot 架构

架构与进程/模块边界。产品行为见 `GUIDE.md`；改码流程见 `AGENTS.md`。HTTP 路由表以本文「网关 HTTP」为准。

只写现在代码里的模块和连线。产品 UI 细节见 `GUIDE.md`。界面走共享组件与 token；约定见 `AGENTS.md`。

**UI chrome（终态）**：浮层 / 抽屉 / 对话框 / 菜单 / 按钮等优先边框与填充分层，不用软 `box-shadow` elevation（焦点环除外）。详见 `AGENTS.md`「UI 约束」。

## 模块

```text
渲染进程 (apps/desktop/src)
    |  window.okbot.*
    |  本机窗口: preload IPC
    |  附着窗口 / 浏览器: httpOkbot → HTTP
    v
Electron main  或  `okbot serve`（二选一，同一数据目录）
    |  都在本进程里调用 startChatTurn / FileStorage（gateway/src/storage）
    v
gatewayHttpApi          网关 HTTP。不是独立服务
    |
    +-- packages/agent     模型、工具、小队、压缩
            |  computerSelection
            +-- 本机 ExecutionBackend（shell / fs）
            +-- 远程 ExecutionBackend → sandbox-agent
            +-- 模型供应商 HTTP（设置里的 baseURL / apiKey）
            +-- read_skill、generate_image、web_fetch / web_search 留在桌面这台机器
```

六个角色：

1. **Electron main**（`apps/desktop/electron/main.ts`）。单实例锁、窗口、主题、自己拉起或附着网关。拥有服务时注册全部 IPC（`apps/desktop/electron/ipc/index.ts` → `registerAllIpc`；聊天/实体 handler 实现在 `apps/gateway/src/ipc/`）。
2. **附着客户端**。端口上已有 OkBot 时，窗口用 `apps/desktop/electron/attachPreload.ts`（构建产物 `apps/desktop/out/preload/attach.mjs`），不注册聊天 IPC。渲染进程经 `apps/desktop/src/bridge/httpOkbot.ts` 把 `window.okbot` 指到已有网关。
3. **渲染进程**。React UI。不直接碰 Node fs。本机完整 preload 是 `apps/desktop/electron/preload.ts`。
4. **gatewayHttpApi**（`apps/gateway/src/gatewayHttpApi.ts`）。Electron 拥有服务时跑在 main 里；`okbot serve`（`apps/gateway/src/cli.ts`）跑在 Node 里。两边是同一份实现，不是两个进程各写一套。`runtime.json` 的 `owner` 为 `electron` 或 `serve`。
5. **本机执行**。`packages/agent` 的 `createLocalExecutionBackend`：`run_shell` / `read_file` / `write_file` / `edit_file` 跑在网关所在机器上。不是 OS 沙箱。
6. **sandbox-agent**（`apps/sandbox-agent`）。另一台电脑或容器上的 HTTP。桌面只把它登记在 `settings.computers`。模型供应商是第三条出站：`@openai/agents` 按 `apiFormat`（`chat_completions` 或 `responses`）打到供应商 `baseURL`。没有 Anthropic `/v1/messages`。

技能热更新：`gatewayRuntime.startSkillWatch` 在拥有服务的进程里 `fs.watch`，下一轮从磁盘重读。

扩展面（工具 / MCP / skills / 模型供应商 / 电脑）的现状与推荐贡献路径见 [`docs/extension-surfaces.md`](./docs/extension-surfaces.md)。


## Gateway vs Electron 边界

同一数据根（默认 `~/.okbot`）上，**网关宿主只有一个进程**：要么是 Electron main（`runtime.json` `owner=electron`），要么是 `okbot serve`（`owner=serve`）。两边共用 `apps/gateway` 里的 `gatewayHttpApi`、`FileStorage`、`entityOps`、聊天编排与 schedule ticker，**不是**两套服务各写一份。

| 职责 | 归属 | 说明 |
| --- | --- | --- |
| HTTP API / Web UI / SSE | `apps/gateway` | `gatewayHttpApi.ts`；Electron 拥有服务时也在 main 进程内 listen |
| 磁盘与设置（`server.json`） | `apps/gateway/src/storage` | `FileStorage` 门面；不在 `apps/desktop` |
| 实体 / 模型探测 / 回合编排 | `apps/gateway/src` | `entityOps`、`modelProbe`、`ipc/chat/*` |
| 窗口、托盘、updater、主题壳 | `apps/desktop/electron` | 只在有桌面窗口时存在 |
| 渲染 UI | `apps/desktop/src` | 经 preload IPC（拥有后端的窗口）或 `httpOkbot`（附着 / 浏览器） |
| 远程 shell/fs | `apps/sandbox-agent` | 登记在 `settings.computers`；不是网关进程 |

**IPC 注册：** `apps/desktop/electron/ipc/index.ts` 的 `registerAllIpc` 调用 `@okbot/gateway` 导出的 `registerEntityIpc` / `registerChatIpc`。这些 handler 源码在 `apps/gateway/src/ipc/`，内部用惰性 `require('electron')`（`loadElectronUi`）以便 `okbot serve` 在无 Electron 时仍能加载 gateway 包；真正执行 IPC 注册只发生在桌面拥有后端时。把整段 handler 挪回 desktop adapter 会牵动导出与测试面，**当前保持惰性 require，不强制搬迁**。

**附着窗口：** 端口上已有 OkBot 时，Electron 不注册聊天 IPC，只用 attach preload + HTTP；关掉附着窗口不停网关。`okbot serve` 与「Electron 自己 listen」是互斥所有者，见 AGENTS「进程」。

## IPC

常量在 `packages/shared`（`ipc.ts` → barrel）的 `IpcChannels`。只有拥有后端的 Electron 窗口注册这些 handler。附着窗口只留窗口控制和一次性令牌 IPC。

| 注册 | 通道 |
| --- | --- |
| `registerEntity.ts` | bootstrap、bots/squads CRUD、SOUL.md、记忆、技能、助手包导入导出、助手市场（含 `importAssistantFromUrl`）、settings、`getGatewayAccessToken`、用量、模型探测与连通测试、消息分页与搜索、prompt context、错误日志、清模型绑定、`probeComputer`、`setChatUnread` |
| `registerChat.ts` | `chatStart`、`chatAbort`、`toolRespond`、`compressSessionNow`。运行中的 `chatEvent` 由 main 推给渲染进程 |
| `registerSystem.ts` | 窗口最小化/最大化/关闭、红绿灯位置、麦克风、剪贴板、选路径、生成图 data URL、`getAppInfo`、updater 四个调用 |
| `main.ts`（仅附着） | `attachGatewayToken`：`ipcMain.on` + `sendSync`，把已保存令牌交给 attach preload。不放进命令行 |

网关 HTTP 在进程内直接调 `startChatTurn`，不再绕一圈 IPC。

1:1 忙碌发送经 `orchestrateBotTurn`（`apps/gateway/src/ipc/chat/orchestrateBotTurn.ts`）：composer（含看似空闲）经 `softSteerGate` 取消 auto-continue 并 abort 该 owner 全部在途回合后重启（把新用户消息并入同一活跃上下文；不按意图分叉并行 composer 回合）。schedule/api 忙碌时不软改向，走既有并行门闩。干净 `done` 后若 `task-progress` 仍有 pending/in_progress，主机静默 auto-continue（无可见用户气泡、不限次数；Stop/abort/composer 软改向/硬错误则停；进度指纹连续两次未变则停，中间一次加严提示）。助手气泡非流式：主机不推送 token `delta`；`send_message` / 自动允许与 HITL 工具边界可见旁白（`onBeforeToolExecute`→`clearLiveAssistantForTools`）/ `done` 时整条显示；同轮开场「收到」去重（含短确认后的长 bullet 开场）；禁止插入空白或仅 `<think>` 行。小队仍直接 `startSquadTurn`。

助手、小队、记忆、技能、助手市场（含 GitHub URL 导入）、模型探测这些操作写在 `apps/gateway/src/entityOps.ts`（`createEntityOps(ctx)`），不带传输层。`apps/gateway/src/ipc/registerEntity.ts` 的 IPC 和网关 `POST /v1/rpc/:op` 都调它，两边行为一致。模型探测的实现在 `apps/gateway/src/modelProbe.ts`。

## 网关 HTTP

实现：`gatewayHttpApi.ts`。默认绑 `127.0.0.1`；`bindLan` 才绑 `0.0.0.0`。除注明外都要 `Authorization: Bearer`、`X-OkBot-Token`，或浏览器登录留下的 HttpOnly cookie。`GET /v1/media/…` 额外接受查询参数 `?token=`（供聊天 `<img src>`；不要把令牌写进普通 API 文档示例）。

| 方法与路径 | 作用 |
| --- | --- |
| `GET /v1/health` | 无令牌。`{ ok, service: "okbot-local-http-api" }` |
| `GET /v1/auth-challenge?nonce=` | 无令牌。返回 HMAC-SHA256(token, nonce)，供本机探测 |
| `GET /v1/gateway-token` | 鉴权后返回本次请求所用令牌（含 `role` / `tokenId`） |
| `GET /v1/api-tokens/:id/usage` | 鉴权后返回该令牌用量（lifetime / daily / 按助手与小队分桶的消息数与 token）；仅本人令牌或超管可读 |
| `GET /v1/app-info` | 鉴权后返回版本与平台（附着/Web UI 设置页） |
| `POST /v1/notify-claim` | `{ tag }` → `{ ok, granted }`：同一设备同一事件只放行一条系统通知（`notifyClaim.ts`；本机局域网地址算 local；tag 含事件 id） |
| `POST /gateway-login` | 校验令牌后设 HttpOnly cookie，302 到 `/`（不进 URL） |
| `GET /v1/bootstrap` | 花名册 + 设置。`gatewayHttpApi.token` 留空 |
| `GET /v1/bots`、`GET /v1/squads` | 侧栏花名册 |
| `GET /v1/bots/:id/messages`、`GET /v1/squads/:id/messages` | 分页。`limit` 缺省 50，最大 200。可用 `beforeMessageId` |
| `GET /v1/computers` | 本机 `local` 加已登记远程电脑（不含令牌） |
| `GET /v1/usage` | 与 IPC `getUsageStats` 同一形状 |
| `GET /v1/media/:ownerId/resources/:file` | 聊天气泡内嵌图：读 `~/.okbot/data/<ownerId>/resources/<file>`。鉴权除 Bearer / cookie 外，**允许 `?token=`**（`<img>` 无法带 Authorization）。路径必须恰好三段且落在该 owner 的 `resources/` 下；单文件上限 25MB |
| `GET /v1/media/:ownerId/uploads/:file` | Composer 粘贴 / 上传附件：读 `~/.okbot/data/<ownerId>/uploads/<file>`。鉴权同 resources（含 `?token=`）；路径规则相同；单文件上限 25MB |
| `POST /v1/bots/:id/uploads`、`POST /v1/squads/:id/uploads` | `{ name, dataBase64, mime? }` → 写入网关主机 `~/.okbot/data/<ownerId>/uploads/`，返回 `{ attachment: { kind, path, name, size, mediaPath, assetRel } }`。解码后上限 25MB；JSON 体上限约 40MB |
| `GET /v1/approvals` | 进行中的回合和待审批 |
| `GET /v1/events` | SSE，推 `sessions_changed` / `settings_changed`，并转发回合 RuntimeEvent（与 owner IPC 同形，供附着 / WebUI 同步） |
| `POST /v1/bots/:id/messages`、`POST /v1/squads/:id/messages` | `{ text, computerId? }`。默认 202；`Accept: text/event-stream` 则 SSE 到本轮结束 |
| `POST /v1/tool-respond` | `{ requestId, approved, message? }`。成功 200，失败 409 |
| `POST /v1/bots/:id/abort`、`POST /v1/squads/:id/abort` | 与桌面停止同一条 `abortChatOwner` |
| `POST /v1/settings` | **超管令牌**。可写完整网关主机设置（含 MCP、模型密钥、tools、security、web、computers、gatewayHttpApi 等）；空白密钥按备份同款 `carryOverSecrets` 保留。客户端壳层键忽略。用户令牌 403 `admin_required` |
| `GET /v1/mcp/status` | **超管令牌**。本机 MCP hub 状态 |
| `POST /v1/mcp/test` | **超管令牌**。探测一条 MCP 配置（不落盘） |
| `POST /v1/backup/export` | **超管令牌**。导出网关主机 `.zip`（`application/zip`）。忙时 409 `busy` |
| `POST /v1/backup/restore` | **超管令牌**。上传 zip（`application/zip` 或 JSON `dataBase64`）恢复后重启宿主。忙时 409 `busy` |
| `POST /v1/rpc/:op` | 助手/小队增删改、引导、SOUL.md、记忆、技能、助手市场、全局搜索、prompt context、错误日志、模型发现与连通测试、立即压缩。`op` 只认 `gatewayRpc.ts` 的 `GATEWAY_RPC_OPS`，其它 404 `unknown_op`；存储报错 400。成功 `{ ok: true, result }` |
| `GET /`、静态资源 | 仅 `serveUi`。未登录是令牌页，不是 JSON |

`okbot serve` 启动横幅会打印当前访问令牌一次。请求处理路径不打印令牌。

## 工具路由

`packages/agent/src/computerSelection.ts` 决定 shell/文件工具去哪。`LOCAL_COMPUTER_ID` 是 `local`。

- 设置里的默认电脑是 `settings.defaultComputerId`。**空等于本机**（`local`）。已设置但未知或已禁用的 id 不会偷偷改回本机执行。
- 用户选定的默认助手是 `settings.defaultAssistantId`（空=无）。仅身份/UI；删除对应 bot 时清空。读写走 `SettingsStore`，与花名册校验在侧栏右键 / 保存与 `deleteOwner`（通用设置页不再展示该下拉）。
- 用户时区偏好是 `settings.timezone`（空=自动检测主机本地 IANA）。定时任务在 job 未指定 timezone 时，经 `resolveScheduleTimezone` 回退到该值再回退主机本地。
- 侧栏置顶顺序是 `settings.pinnedOwnerIds`（bot/squad owner id 有序数组；可多选）。删除对应 owner 时从数组移除。与 `defaultAssistantId` 独立。
- 本轮 HTTP 的 `computerId` 低于对话里点名的电脑。
- 用户文本点名恰好一台（远程电脑用 id 或名称；本机用「本机」，不用路径里的 `local`）就改到那台。
- 点名多台时，每次工具调用必须带 `computer`。
- 显式工具参数（id 或名称）优先。
- `read_skill` 和 `generate_image` 不走这套路由，留在桌面主机。

远程目标：`executionBackend.ts` 的 `createRemoteExecutionBackend` 去打 sandbox-agent。协议是 Bearer，`GET /v1/health`（`service` 为 `okbot-sandbox-agent`），`POST /v1/shell`（可 SSE），`POST /v1/fs/read|write|edit`。保存电脑前 `probeComputer` 用空 shell 正文期望 400 `command_required`，不执行命令。

本机 shell：Windows 优先 `pwsh`，否则 `cmd.exe`；其它平台用 `SHELL`，darwin 默认 `/bin/zsh`。

## 磁盘

产品侧目录一览与备份行为见 [`GUIDE.md` §12](./GUIDE.md#12-数据目录一览)。本节只写架构边界与关键路径角色。


`FileStorage`（`apps/gateway/src/storage/FileStorage.ts`；**不在** `apps/desktop`）是薄门面：共享根路径、组装域 Store（`SettingsStore` / `SessionStore` / `RosterStore` / `SkillsStore` / `MemoryStore` / `ScheduleStore` / `PendingHitlStore` / `AssistantPackageStore`），并保持原有调用面。墓碑与 session 写锁集中在 `ownerLifecycle.ts`（`OwnerLifecycle`）；各 Store 的写路径自行调用，不在门面复制。根目录默认 `~/.okbot`（`path.join(homedir, '.okbot')`）。构造时 `chmod` 目录 `0700`。`server.json`（网关设置）经 `writeJson(..., { mode: 0o600 })` 写出，并在创建/读到已有文件后再 `chmod` `0600`。`chmod` 失败会 `console.error`，不抛。进程锁为同目录下的 `runtime.json`（旧名曾为 `server.json`）。

### 设置所有权（客户端 vs 网关）

- **客户端设置**（主题、语言、半透明、关窗行为、通知、硬件加速、自动更新、侧栏放大、麦克风、高级/开发者模式、窗口位置、网关列表等）：Electron 写在 `~/.okbot/client.json`（`window` / `gateways` 字段分别嵌套原 `window.json` / `gateways.json`）。浏览器 Web UI 用 `localStorage`（`okbot.clientSettings`）。切换网关时客户端半边不变。
- **网关设置**（时区、模型、工具、安全、压缩、指令、记忆、维护、小队、mesh、gatewayHttpApi、computers、审批、置顶/隐藏/分组、MCP、web、助手市场等）：每台网关主机自己的 `~/.okbot/server.json`。附着远程时从该主机 bootstrap/HTTP 加载；不要把客户端壳层写进远程 `server.json`。
- UI `getSettings()` 返回**合并视图**（客户端覆盖 + 当前网关）；`saveSettings` 按键拆开写入。升级时若旧的合并设置仍含客户端键，会剥到 `client.json` 并重写网关文件。
- 网关写入（`resolveGatewaySettingsWrite`）忽略客户端壳层键（不应用、不报错）；权限仅超管 vs 用户，无键级白名单。

```text
~/.okbot/
  client.json            本机客户端（主题/语言/关窗 + nested window + nested gateways）；0600；通常不进网关备份
  server.json            0600。网关 AppSettings（模型 API Key、网关令牌、电脑令牌等）
  runtime.json           进程锁：pid、port、owner（旧锁文件名曾为 server.json）
  data/                  网关持久数据
    usage.json
    bots.json
    squads.json
    memory.md            全局记忆
    logs/errors-YYYY-MM-DD.jsonl
    <botId>/  bot.json、SOUL.md、memory.md、skills/、session.jsonl、
              session-summary.json、pending-hitl/、resources/、
              schedules.jsonl
    <squadId>/  session.jsonl、session-summary.json、
                pending-hitl/、pending-hitl-replies/、resources/、schedules.jsonl
```

定时任务：`~/.okbot/data/<botId|squadId>/schedules.jsonl`（一行一个任务；新 id 为 ULID；旧 `schedules.json` 在加载时迁移并保留原 id）（`manage_schedule`；默认审批 allow；create/delete 始终 HITL（含 AAR 不可旁路）；list 不审批；编辑助手/小队可 pause/resume/delete）。每 owner 上限 50；`every N m` 要求 N 整除 60；`once` 触发后停用。拥有网关的进程（Electron 或 `okbot serve`）内 `scheduleTicker` 约每 20s 扫描到期任务，调用与 UI 相同的 `startChatTurn`（走并行上限 / Stop / 任务条；审批/预算与交互轮次相同）。进程未运行时不会触发；再次起来后若 `nextRunAt` 已过期则补跑一次并推进下次。同一 job 在途中不会叠跑。

聊天附件：Composer 支持选择或**拖放**文件 / 图片 / 文件夹；与选择器同一管线。网页工具（`web_fetch` / `web_search`）在桌面主机直接 HTTP（`settings.web`），不经 sandbox-agent。

每条待审批一份 `pending-hitl/<requestId>.json`，并行的小队成员审批不会互相覆盖。旧版单文件 `pending-hitl.json` 仍会读取。审批等待默认 10 分钟（`TOOL_APPROVAL_TIMEOUT_MS`），超时按拒绝处理。所有运行类型共用 `ipc/approvalWaiter.ts` 里的审批等待（自动审批规则、落盘、超时、中止）。

小队冷恢复（`ipc/squadResume.ts`）：
- 队长的审批：用队长的 RunState 恢复，跑到最终回复。
- 成员的审批（记录带 `squadMember` 和 `turnId`）：用该成员的 RunState 恢复，跑到它的回复。调用 `ask_*` 的队长运行没有活过重启。同一轮还有别的成员审批在等时，回复先存进 `pending-hitl-replies/<turnId>.json`。最后一条处理完后，队长用 `formatSquadResumeNote` 汇总的结果续跑这一轮，并用 `dropUnansweredToolCalls` 去掉没有结果的工具调用。
- 一轮只收尾一次（`planSquadResumeAfter`）：同一轮还有队长的审批在等时，成员恢复后不续跑队长，由队长那条审批收尾；队长恢复跑完后，同一轮还在等的成员审批作废（发 `tool_result` 拒绝并删记录），收集的回复清空。
- 每次运行（实时的小队回合和冷恢复）结束时只放掉自己挂起的审批（`releaseRunApprovals`），不清别的回合留在磁盘上的审批。新消息并行时不清掉其他回合的待审批；停止 / 删除会话才清。

助手消息可带 `trace`（`MessageTrace`：本轮 spans 瀑布，随 session.jsonl 持久化）。

删除助手或小队后，进程内留下墓碑（`storage/fs.ts` 的 `markDirDeleted`）。`ensureDir`、`writeJson`、`writeText`、`appendText` 都先查墓碑，所以还在收尾的运行（会话、记忆、技能、待审批）写不回已删的目录。`recordUsage` 仍计入总量，但不再给已删的 owner 写分项。删助手时因成员不足而一起删掉的小队也留墓碑。本进程删过的 id 不再分配给新助手或小队。

## 网关可写的设置

`POST /v1/settings` 仅超管令牌。`resolveGatewaySettingsWrite` 应用全部非客户端壳层键，并用 `carryOverSecrets` 补回空白密钥。客户端壳层（主题、语言、麦克风、硬件加速、自动更新、侧栏缩放、`notifications`、`developerMode`、`closeAction`、半透明等）在 `client.json` / Web localStorage，网关写入忽略。

权限粒度粗分：用户/访问令牌无网关端设置写权限（鉴权层 403 `admin_required`）；超管令牌可写全部网关主机设置（含任意自动审批规则，与桌面端相同）。无访问令牌键级白名单或 `settings_not_allowed` 写入路径。用户令牌客户端上设置页的网关端面板保持隐藏/只读。

MCP 工具（名字以 `mcp_` 开头）不经过自动审批：`resolveToolApproval` 对它们总是返回「询问」，工具卡也不显示「总是允许」。

**超管令牌**经 `POST /v1/settings` 可改完整网关主机配置：模型密钥、`tools`、`security`、`computers`、`gatewayHttpApi`、`mcp`、`web` 等（与拥有网关的桌面端等价）。空白密钥字段按 `carryOverSecrets` 从当前配置补回。**用户令牌**不能 POST settings。网关响应里 MCP 的 `env`/`headers` 值与网页搜索 API Key 仍留空。`notifications` 和 `developerMode` 只影响界面（客户端壳层键）。没有令牌的请求在鉴权处就是 401。

模型发现与连通测试经网关调用时，客户端看到的 API Key 是空的。可以只传 `providerId`；服务端只在 `baseURL` 与已保存的一致时才用已保存的密钥（`modelProbe.resolveProbeApiKey`），不会把密钥发到调用方指定的别的地址。网关调用（`gatewayRpc` 的 `PROBE_OPS`）还要求 `baseURL` 是已保存的某个供应商地址，否则 400 `probe_url_not_saved`；这样令牌持有者不能让网关去请求内网任意地址。桌面端 IPC 不受这个限制。

令牌等同于本机的完全控制：持有者能聊天、批准工具（含运行命令）、改人设、记忆和技能、立即压缩会话。登录页和网关设置里的令牌说明写明了这一点。

## 备份

`apps/gateway/src/backup.ts`：`exportDataBackup(root, out, { excludeSecrets })` 用系统 `zip` 打包**网关主机**数据目录，加标记文件 `okbot-backup.json`，跳过 `runtime.json`、`client.json`、遗留 `gateways.json` / `window.json`（备份以 `data/` + `server.json` 为主；**不含**客户端壳层偏好）。`excludeSecrets` 时 `stripSettingsSecrets` 清空模型 API Key、网关令牌、电脑令牌、MCP `env`/`headers` 的值、URL 凭证，以及 `redactSecretArgs` 清空的参数（词表共用；URL 查询另有复数/子串回退；`pass-through`/`sort-key` 不清），并跳过 `server.json.*` / `settings.json.*` 副本。`restoreDataBackup(root, archive)` 先列出压缩包内容，拒绝绝对路径、`..` 和链接，解到临时目录，再把现有目录改名为 `<root>-before-restore-<时间>`，换入新目录；备份不含密钥时 `carryOverSecrets` 沿用旧设置里的密钥，但只在端点相同时：模型供应商要求 id 和 `baseURL` 都相同，电脑要求 id、`host`、`port` 相同，MCP 服务器要求 id、连接方式、命令、参数和去掉密钥后的地址相同。恢复后 `mcp.enabled` 一律关掉，要用户自己再打开。解压前用 `unzip -Z -t`（`LC_ALL=C`）检查 zip 声明的未压缩总大小（上限 16 GiB）。导出和恢复在选文件对话框前后（HTTP 路径在打包前后）都检查有没有助手在工作或等待批准（`busy`）。拥有网关的桌面走 IPC；远程超管走 `POST /v1/backup/export|restore`（恢复成功后重启宿主进程）。用户令牌不能调用。网关设置投影（`blankMcpSecrets`）与备份共用同一套 URL / args 清空。

## 令牌

- 网关可创建任意多个 API 令牌，存在 `gatewayHttpApi.apiTokens[]`（每项：`id` / `name` / `role`=`access`|`admin` / `token` / `limits` / 时间戳）。遗留字段 `token` / `adminToken` 仍镜像各自角色的**第一条**，供 attach / CLI / 探测兼容；鉴权匹配列表中每一项。
- 限额（`limits`）：`dailyMessages` / `totalMessages` / `dailyTokens` / `totalTokens`；**0 = 不限制**。HTTP 聊天回合前按用量门禁；用量落在 `~/.okbot/data/api-token-usage.json`，按令牌 × 助手/小队累计消息数与 token（input+output+cache）。
- 只有拥有服务的进程在磁盘上还没有用户/超管令牌时才 `ensureGatewayToken` 生成并写入。附着到已有服务不会另造一串。规范化不会因为「已启用且为空」就生成。
- `GET /v1/bootstrap` 和 `POST /v1/settings` 的响应把 `gatewayHttpApi.token` / `adminToken` / 各 `apiTokens[].token` 留空。
- 要读正在核对的令牌：鉴权后 `GET /v1/gateway-token`（回显本次凭据）。本机 Electron 另经 IPC `getGatewayAccessToken` / `getGatewayAdminToken` / `getGatewayApiTokens` 读完整列表；附着窗口和 Web UI 用 HTTP。用量：`GET /v1/api-tokens/:id/usage` 或 IPC `getApiTokenUsage`。
- 附着窗口的命令行只有 `--okbot-api-base=`。令牌经 `attachGatewayToken` 一次性 IPC 交给 preload，再放进 `window.__okbotAttach.token`。不放在渲染进程命令行。
- 浏览器 Web UI 登录是 `POST /gateway-login`，服务端设 HttpOnly cookie `okbot_gateway_token`，不把令牌放进 URL 或 `sessionStorage`。API 请求带 `credentials: include`（附着窗口仍用 preload 里的 Bearer）。
- 健康探测：没有已存令牌时只看 `GET /v1/health`。有令牌时走 `GET /v1/auth-challenge?nonce=`（不发送令牌），对**每一个**已存令牌算 HMAC-SHA256(token, nonce) 并返回 `macs[]`（兼旧字段 `mac`）；冒名端口无法收割令牌。

## 现在仍成立的缺口

- 附着窗口和浏览器网关不能按文件路径导入、导出助手包（文件在网关那台机器上）。备份/恢复与改 MCP 需要**超管令牌**（HTTP）；用户令牌不行。更新器在网关模式只读展示 `currentVersion`（来自 `GET /v1/app-info`），不能在附着窗口里下载安装。
- `okbot serve` 启动横幅仍会明文打印访问令牌一次（有意保留，便于本机复制）。

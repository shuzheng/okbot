# OkBot 架构

只写现在代码里的模块和连线。产品 UI 细节见 `GUIDE.md`。

## 模块

```text
渲染进程 (apps/desktop/src)
    |  window.okbot.*
    |  本机窗口: preload IPC
    |  附着窗口 / 浏览器: httpOkbot → HTTP
    v
Electron main  或  `okbot serve`（二选一，同一数据目录）
    |  都在本进程里调用 startChatTurn / FileStorage
    v
localHttpApi          网关 HTTP。不是独立服务
    |
    +-- packages/agent     模型、工具、小队、压缩
            |  computerSelection
            +-- 本机 ExecutionBackend（shell / fs）
            +-- 远程 ExecutionBackend → sandbox-agent
            +-- 模型供应商 HTTP（设置里的 baseURL / apiKey）
            +-- read_skill、generate_image 留在桌面这台机器
```

六个角色：

1. **Electron main**（`electron/main.ts`）。单实例锁、窗口、主题、自己拉起或附着网关。拥有服务时注册全部 IPC（`electron/ipc/index.ts` → `registerAllIpc`）。
2. **附着客户端**。端口上已有 OkBot 时，窗口用 `electron/attachPreload.ts`（构建产物 `out/preload/attach.mjs`），不注册聊天 IPC。渲染进程经 `src/bridge/httpOkbot.ts` 把 `window.okbot` 指到已有网关。
3. **渲染进程**。React UI。不直接碰 Node fs。本机完整 preload 是 `electron/preload.ts`。
4. **localHttpApi**（`electron/localHttpApi.ts`）。Electron 拥有服务时跑在 main 里；`okbot serve`（`electron/cli.ts`）跑在 Node 里。两边是同一份实现，不是两个进程各写一套。`server.json` 的 `owner` 为 `electron` 或 `serve`。
5. **本机执行**。`packages/agent` 的 `createLocalExecutionBackend`：`run_shell` / `read_file` / `write_file` / `edit_file` 跑在网关所在机器上。不是 OS 沙箱。
6. **sandbox-agent**（`apps/sandbox-agent`）。另一台电脑或容器上的 HTTP。桌面只把它登记在 `settings.computers`。模型供应商是第三条出站：`@openai/agents` 按 `apiFormat`（`chat_completions` 或 `responses`）打到供应商 `baseURL`。没有 Anthropic `/v1/messages`。

技能热更新：`gatewayRuntime.startSkillWatch` 在拥有服务的进程里 `fs.watch`，下一轮从磁盘重读。

## IPC

常量在 `packages/shared` 的 `IpcChannels`。只有拥有后端的 Electron 窗口注册这些 handler。附着窗口只留窗口控制和一次性令牌 IPC。

| 注册 | 通道 |
| --- | --- |
| `registerEntity.ts` | bootstrap、bots/squads CRUD、AGENTS.md、记忆、技能、助手包导入导出、settings、`getGatewayAccessToken`、用量、模型探测与连通测试、消息分页与搜索、prompt context、run trace、错误日志、清模型绑定、`probeComputer`、`setChatUnread` |
| `registerChat.ts` | `chatStart`、`chatAbort`、`toolRespond`、`compressSessionNow`。运行中的 `chatEvent` 由 main 推给渲染进程 |
| `registerSystem.ts` | 窗口最小化/最大化/关闭、红绿灯位置、麦克风、剪贴板、选路径、生成图 data URL、`getAppInfo`、updater 四个调用 |
| `main.ts`（仅附着） | `attachGatewayToken`：`ipcMain.on` + `sendSync`，把已保存令牌交给 attach preload。不放进命令行 |

网关 HTTP 在进程内直接调 `startChatTurn`，不再绕一圈 IPC。

助手、小队、记忆、技能、模型探测这些操作写在 `electron/entityOps.ts`（`createEntityOps(ctx)`），不带传输层。`registerEntity.ts` 的 IPC 和网关 `POST /v1/rpc/:op` 都调它，两边行为一致。模型探测的实现在 `electron/modelProbe.ts`。

## 网关 HTTP

实现：`localHttpApi.ts`。默认绑 `127.0.0.1`；`bindLan` 才绑 `0.0.0.0`。除注明外都要 `Authorization: Bearer`、`X-OkBot-Token`，或浏览器登录留下的 HttpOnly cookie。

| 方法与路径 | 作用 |
| --- | --- |
| `GET /v1/health` | 无令牌。`{ ok, service: "okbot-local-http-api" }` |
| `GET /v1/auth-challenge?nonce=` | 无令牌。返回 HMAC-SHA256(token, nonce)，供本机探测 |
| `GET /v1/gateway-token` | 鉴权后返回本进程正在核对的令牌 |
| `GET /v1/app-info` | 鉴权后返回版本与平台（附着/Web UI 设置页） |
| `POST /v1/notify-claim` | `{ tag }` → `{ ok, granted }`：同一设备同一事件只放行一条系统通知（`notifyClaim.ts`；本机局域网地址算 local；tag 含事件 id） |
| `POST /gateway-login` | 校验令牌后设 HttpOnly cookie，302 到 `/`（不进 URL） |
| `GET /v1/bootstrap` | 花名册 + 设置。`localHttpApi.token` 留空 |
| `GET /v1/bots`、`GET /v1/squads` | 侧栏花名册 |
| `GET /v1/bots/:id/messages`、`GET /v1/squads/:id/messages` | 分页。`limit` 缺省 50，最大 200。可用 `beforeMessageId` |
| `GET /v1/computers` | 本机 `local` 加已登记远程电脑（不含令牌） |
| `GET /v1/usage` | 与 IPC `getUsageStats` 同一形状 |
| `GET /v1/approvals` | 进行中的回合和待审批 |
| `GET /v1/events` | SSE，只推 `sessions_changed` |
| `POST /v1/bots/:id/messages`、`POST /v1/squads/:id/messages` | `{ text, computerId? }`。默认 202；`Accept: text/event-stream` 则 SSE 到本轮结束 |
| `POST /v1/tool-respond` | `{ requestId, approved, message? }`。成功 200，失败 409 |
| `POST /v1/bots/:id/abort`、`POST /v1/squads/:id/abort` | 与桌面停止同一条 `abortChatOwner` |
| `POST /v1/settings` | 只接受 `GATEWAY_SETTINGS_PATCH_KEYS` 里的键。其它键有真实改动则整次 409 `settings_not_allowed` |
| `POST /v1/rpc/:op` | 助手/小队增删改、引导、AGENTS.md、记忆、技能、全局搜索、prompt context、run trace、错误日志、模型发现与连通测试、立即压缩。`op` 只认 `gatewayRpc.ts` 的 `GATEWAY_RPC_OPS`，其它 404 `unknown_op`；存储报错 400。成功 `{ ok: true, result }` |
| `GET /`、静态资源 | 仅 `serveUi`。未登录是令牌页，不是 JSON |

`okbot serve` 启动横幅会打印当前访问令牌一次。请求处理路径不打印令牌。

## 工具路由

`packages/agent/src/computerSelection.ts` 决定 shell/文件工具去哪。`LOCAL_COMPUTER_ID` 是 `local`。

- 设置里的默认电脑是 `settings.defaultComputerId`。**空等于本机**（`local`）。已设置但未知或已禁用的 id 不会偷偷改回本机执行。
- 本轮 HTTP 的 `computerId` 低于对话里点名的电脑。
- 用户文本点名恰好一台（远程电脑用 id 或名称；本机用「本机」，不用路径里的 `local`）就改到那台。
- 点名多台时，每次工具调用必须带 `computer`。
- 显式工具参数（id 或名称）优先。
- `read_skill` 和 `generate_image` 不走这套路由，留在桌面主机。

远程目标：`executionBackend.ts` 的 `createRemoteExecutionBackend` 去打 sandbox-agent。协议是 Bearer，`GET /v1/health`（`service` 为 `okbot-sandbox-agent`），`POST /v1/shell`（可 SSE），`POST /v1/fs/read|write|edit`。保存电脑前 `probeComputer` 用空 shell 正文期望 400 `command_required`，不执行命令。

本机 shell：Windows 优先 `pwsh`，否则 `cmd.exe`；其它平台用 `SHELL`，darwin 默认 `/bin/zsh`。

## 磁盘

`FileStorage` 根目录默认 `~/.okbot`（`path.join(homedir, '.okbot')`）。构造时 `chmod` 目录 `0700`。`settings.json` 经 `writeJson(..., { mode: 0o600 })` 写出，并在创建/读到已有文件后再 `chmod` `0600`。`chmod` 失败会 `console.error`，不抛。

```text
~/.okbot/
  settings.json          0600。模型 API Key、网关令牌、电脑令牌
  server.json            单实例锁：pid、port、owner
  window.json
  usage.json
  bots.json
  squads.json
  memory.md              全局记忆
  logs/errors-YYYY-MM-DD.jsonl
  <botId>/  bot.json、AGENTS.md、memory.md、skills/、session.jsonl、
            session-summary.json、last-run-trace.json、pending-hitl/、resources/
  <squadId>/  session.jsonl、session-summary.json、last-run-trace.json、
              pending-hitl/、pending-hitl-replies/、resources/
```

每条待审批一份 `pending-hitl/<requestId>.json`，并行的小队成员审批不会互相覆盖。旧版单文件 `pending-hitl.json` 仍会读取。审批等待默认 10 分钟（`TOOL_APPROVAL_TIMEOUT_MS`），超时按拒绝处理。所有运行类型共用 `ipc/approvalWaiter.ts` 里的审批等待（自动审批规则、落盘、超时、中止）。

小队冷恢复（`ipc/squadResume.ts`）：
- 队长的审批：用队长的 RunState 恢复，跑到最终回复。
- 成员的审批（记录带 `squadMember` 和 `turnId`）：用该成员的 RunState 恢复，跑到它的回复。调用 `ask_*` 的队长运行没有活过重启。同一轮还有别的成员审批在等时，回复先存进 `pending-hitl-replies/<turnId>.json`。最后一条处理完后，队长用 `formatSquadResumeNote` 汇总的结果续跑这一轮，并用 `dropUnansweredToolCalls` 去掉没有结果的工具调用。
- 一轮只收尾一次（`planSquadResumeAfter`）：同一轮还有队长的审批在等时，成员恢复后不续跑队长，由队长那条审批收尾；队长恢复跑完后，同一轮还在等的成员审批作废（发 `tool_result` 拒绝并删记录），收集的回复清空。
- 每次运行（实时的小队回合和冷恢复）结束时只放掉自己挂起的审批（`releaseRunApprovals`），不清别的回合留在磁盘上的审批。新消息改向时仍按设计清掉该小队全部待审批。

删除助手或小队后，进程内留下墓碑（`storage/fs.ts` 的 `markDirDeleted`）。`ensureDir`、`writeJson`、`writeText`、`appendText` 都先查墓碑，所以还在收尾的运行（会话、轨迹、记忆、技能、待审批）写不回已删的目录，`RunTraceRecorder` 直接停写。`recordUsage` 仍计入总量，但不再给已删的 owner 写分项。删助手时因成员不足而一起删掉的小队也留墓碑。本进程删过的 id 不再分配给新助手或小队。

## 网关可写的设置

`gatewaySettingsWrite.ts` 的 `GATEWAY_SETTINGS_PATCH_KEYS`：主题、语言、麦克风、硬件加速、自动更新、侧栏缩放、开发者模式、压缩、`maxTurns`、instructions、memory、squad、`toolRun`、`notifications`、`showAdvancedSettings`。`autoApprovalEnabled` 和 `autoApprovalRules` 另走 `checkGatewayApprovalWrite`。

网关对自动审批只能做两类改动。一是只会多问的改动：加「询问」规则、删「允许」规则、关掉自动审批。二是工具卡上的「总是允许」：新增或改成「允许」的规则，内容必须正好是一个内置工具名（如 `read_file`）。内置工具名规则只和工具名比较，不和参数比较。宽泛的关键词「允许」规则（比如只写 `a`）、改桌面端规则的说明或内容，都只能在桌面端做；不合规则的写入整体返回 409 `settings_not_allowed`。设置页的规则列表在网关页只读。

MCP 工具（名字以 `mcp_` 开头）不经过自动审批：`resolveToolApproval` 对它们总是返回「询问」，工具卡也不显示「总是允许」。

仍只在桌面端改：模型密钥、`tools`（启用与每个工具的审批）、`security`、`computers`、`localHttpApi`、`mcp`。`mcp` 能起本机子进程，所以不开放给网关。网关响应里 MCP 的 `env` 和 `headers` 的值留空；客户端原样回传这些空值不算改动。`notifications` 和 `showAdvancedSettings` 只影响界面，不给权限。没有令牌的请求在鉴权处就是 401，到不了这里。

模型发现与连通测试经网关调用时，客户端看到的 API Key 是空的。可以只传 `providerId`；服务端只在 `baseURL` 与已保存的一致时才用已保存的密钥（`modelProbe.resolveProbeApiKey`），不会把密钥发到调用方指定的别的地址。网关调用（`gatewayRpc` 的 `PROBE_OPS`）还要求 `baseURL` 是已保存的某个供应商地址，否则 400 `probe_url_not_saved`；这样令牌持有者不能让网关去请求内网任意地址。桌面端 IPC 不受这个限制。

令牌等同于本机的完全控制：持有者能聊天、批准工具（含运行命令）、改人设、记忆和技能、立即压缩会话。登录页和网关设置里的令牌说明写明了这一点。

## 备份

`electron/backup.ts`：`exportDataBackup(root, out, { excludeSecrets })` 用系统 `zip` 打包数据目录，加标记文件 `okbot-backup.json`，跳过 `server.json`、`window.json`。`excludeSecrets` 时 `stripSettingsSecrets` 清空模型 API Key、网关令牌、电脑令牌、MCP `env`/`headers` 的值、URL 凭证，以及 `redactSecretArgs` 清空的参数（词表共用；URL 查询另有复数/子串回退；`pass-through`/`sort-key` 不清），并跳过 `settings.json.*` 副本。`restoreDataBackup(root, archive)` 先列出压缩包内容，拒绝绝对路径、`..` 和链接，解到临时目录，再把现有目录改名为 `<root>-before-restore-<时间>`，换入新目录；备份不含密钥时 `carryOverSecrets` 沿用旧设置里的密钥，但只在端点相同时：模型供应商要求 id 和 `baseURL` 都相同，电脑要求 id、`host`、`port` 相同，MCP 服务器要求 id、连接方式、命令、参数和去掉密钥后的地址相同。恢复后 `mcp.enabled` 一律关掉，要用户自己再打开。解压前用 `unzip -Z -t`（`LC_ALL=C`）检查 zip 声明的未压缩总大小（上限 16 GiB）。导出和恢复在选文件对话框前后都检查有没有助手在工作或等待批准（`busy`）。只有 IPC，网关没有这条路由。网关设置投影（`blankMcpSecrets`）与备份共用同一套 URL / args 清空。

## 令牌

- 只有拥有服务的进程在磁盘上还没有令牌时才 `ensureGatewayToken` 生成并写入。附着到已有服务不会另造一串。规范化不会因为「已启用且为空」就生成。
- `GET /v1/bootstrap` 和 `POST /v1/settings` 的响应把 `localHttpApi.token` 留空。
- 要读正在核对的令牌：鉴权后 `GET /v1/gateway-token`。Electron 设置页走 IPC `getGatewayAccessToken`，附着窗口和 Web UI 走这条 HTTP。
- 附着窗口的命令行只有 `--okbot-api-base=`。令牌经 `attachGatewayToken` 一次性 IPC 交给 preload，再放进 `window.__okbotAttach.token`。不放在渲染进程命令行。
- 浏览器 Web UI 登录是 `POST /gateway-login`，服务端设 HttpOnly cookie `okbot_gateway_token`，不把令牌放进 URL 或 `sessionStorage`。API 请求带 `credentials: include`（附着窗口仍用 preload 里的 Bearer）。
- 健康探测：没有已存令牌时只看 `GET /v1/health`。有令牌时走 `GET /v1/auth-challenge?nonce=`（不发送令牌），用 HMAC-SHA256(token, nonce) 校验；冒名端口无法收割令牌。

## 现在仍成立的缺口

- 附着窗口和浏览器网关不能按文件路径导入、导出助手包（文件在网关那台机器上），也不能备份恢复或改 MCP。更新器在网关模式只读展示 `currentVersion`（来自 `GET /v1/app-info`），不能在附着窗口里下载安装。
- `okbot serve` 启动横幅仍会明文打印访问令牌一次（有意保留，便于本机复制）。

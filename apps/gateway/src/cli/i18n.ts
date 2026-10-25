/** Tiny CLI-local i18n (zh + en). Not wired to the desktop React i18n. */

export type Locale = 'zh' | 'en';

export type CliMessages = {
  usageTitle: string;
  usageCommands: string;
  cmdHelp: string;
  cmdVersion: string;
  cmdServe: string;
  cmdStatus: string;
  cmdStop: string;
  cmdRestart: string;
  cmdConfig: string;
  cmdToken: string;
  cmdData: string;
  helpHint: string;
  unknownCommand: (cmd: string) => string;
  invalidLang: string;
  versionLabel: (v: string) => string;
  versionMissing: string;

  serveAlreadyRunning: (pid: string, where: string) => string;
  serveLockHeldNotOkbot: (pid: number, port: number) => string;
  serveStarted: string;
  serveAddress: (base: string) => string;
  serveBind: (bind: string, ui: string) => string;
  serveUiOn: string;
  serveUiOff: string;
  serveToken: (token: string) => string;
  serveAdminToken: (token: string) => string;
  serveCtrlC: string;
  servePortInUse: (port: number) => string;
  serveFailed: string;
  serveDataRoot: (root: string) => string;
  serveHelp: string;

  instanceBothRequired: string;
  instanceInvalidPort: string;
  instanceInvalidDataDir: string;
  instanceUnknownArgs: (args: string) => string;

  statusRunning: string;
  statusNotRunning: string;
  statusUnhealthy: string;
  statusPid: (pid: number) => string;
  statusOwner: (owner: string) => string;
  statusPort: (port: number) => string;
  statusBaseUrl: (url: string) => string;
  statusBindLan: (v: boolean) => string;
  statusServeUi: (v: boolean) => string;
  statusDataRoot: (root: string) => string;
  statusHelp: string;

  stopAlreadyStopped: string;
  stopStopping: (pid: number, owner: string) => string;
  stopStopped: string;
  stopKilled: string;
  stopFailed: (detail: string) => string;
  stopStaleLockReleased: string;
  stopOwnerElectron: string;
  stopNotOkbot: string;
  stopHelp: string;

  restartStopping: string;
  restartStarting: string;
  restartStopFailed: string;
  restartHelp: string;

  configShowTitle: string;
  configDataRoot: (root: string) => string;
  configPort: (port: number) => string;
  configBindLan: (v: boolean) => string;
  configServeUi: (v: boolean) => string;
  configTokenMasked: (masked: string) => string;
  configAdminTokenMasked: (masked: string) => string;
  configUpdated: string;
  configRestartNote: string;
  configInvalidPort: string;
  configInvalidBool: (flag: string) => string;
  configNothingToSet: string;
  configUnknownSub: (sub: string) => string;
  configHelp: string;

  tokenShowWarn: string;
  tokenValue: (token: string) => string;
  tokenEmpty: string;
  tokenAdminEmpty: string;
  tokenAccessLabel: string;
  tokenAdminLabel: string;
  tokenResetDone: string;
  tokenResetAccessDone: string;
  tokenResetAdminDone: string;
  tokenResetAccessDefault: string;
  tokenResetClients: string;
  tokenResetRestart: string;
  tokenUnknownSub: (sub: string) => string;
  tokenUnknownRole: (role: string) => string;
  tokenHelp: string;

  dataPath: (p: string) => string;
  dataOpened: (p: string) => string;
  dataOpenFailed: (detail: string) => string;
  dataUnknownSub: (sub: string) => string;
  dataHelp: string;
};

const zh: CliMessages = {
  usageTitle: '用法: okbot <命令> [选项]',
  usageCommands: '命令:',
  cmdHelp: '显示帮助',
  cmdVersion: '显示版本',
  cmdServe: '启动网关（前台）',
  cmdStatus: '查看网关是否在运行',
  cmdStop: '停止正在运行的网关',
  cmdRestart: '停止后重新启动网关',
  cmdConfig: '查看或修改 gatewayHttpApi 配置',
  cmdToken: '查看或重置访问/超管令牌',
  cmdData: '打印或打开数据目录',
  helpHint: '用 okbot <命令> --help 查看子命令帮助。全局选项: --lang zh|en',
  unknownCommand: (cmd) => `未知命令: ${cmd}`,
  invalidLang: '无效的 --lang，请使用 zh 或 en',
  versionLabel: (v) => `okbot ${v}`,
  versionMissing: '无法读取版本号',

  serveAlreadyRunning: (pid, where) => `OkBot 已在运行${pid}：${where}。未再启动一份。`,
  serveLockHeldNotOkbot: (pid, port) =>
    `数据目录锁被占用（pid ${pid}），但端口 ${port} 不是已验证的 OkBot。未启动。`,
  serveStarted: 'OkBot 服务已启动',
  serveAddress: (base) => `地址 ${base}`,
  serveBind: (bind, ui) => `绑定 ${bind}，${ui}`,
  serveUiOn: '已提供 Web UI',
  serveUiOff: '未提供 Web UI',
  serveToken: (token) => `用户令牌 ${token}`,
  serveAdminToken: (token) => `超管令牌 ${token}`,
  serveCtrlC: '按 Ctrl+C 停止',
  servePortInUse: (port) => `端口 ${port} 已被占用，且不是 OkBot 服务。`,
  serveFailed: '[okbot] serve failed',
  serveDataRoot: (root) => `数据目录 ${root}`,
  serveHelp: `用法:
  okbot serve
  okbot serve --port <端口> --data-dir <目录>

在前台启动 OkBot 网关（锁、监听、技能监视、定时任务、检查点、SIGINT/SIGTERM 关闭）。

默认（两个参数都不写）: 端口 18765，数据目录 ~/.okbot（若该目录已有 server.json 则沿用其中的端口）。
自定义实例: --port 与 --data-dir 必须同时指定，且不能与已有实例冲突（端口已被占用或数据目录锁已被占用）。

选项:
  --port <N>           监听端口（1024–65535）；须与 --data-dir 成对出现
  --data-dir <路径>    实例数据根目录；须与 --port 成对出现
  --help, -h           显示本帮助
  --lang zh|en         界面语言

示例:
  okbot serve
  okbot serve --port 19001 --data-dir ~/okbot-alt`,

  instanceBothRequired:
    '自定义实例时必须同时指定 --port 与 --data-dir（或两个都不指定以使用默认 ~/.okbot + 18765）。',
  instanceInvalidPort: '无效的 --port：请使用 1024–65535 的整数。',
  instanceInvalidDataDir: '无效的 --data-dir：请提供有效的目录路径。',
  instanceUnknownArgs: (args) => `未知参数: ${args}`,

  statusRunning: '状态: 运行中（健康）',
  statusNotRunning: '状态: 未运行',
  statusUnhealthy: '状态: 有进程/锁但不健康',
  statusPid: (pid) => `pid: ${pid}`,
  statusOwner: (owner) => `owner: ${owner}`,
  statusPort: (port) => `port: ${port}`,
  statusBaseUrl: (url) => `baseUrl: ${url}`,
  statusBindLan: (v) => `bindLan: ${v}`,
  statusServeUi: (v) => `serveUi: ${v}`,
  statusDataRoot: (root) => `dataRoot: ${root}`,
  statusHelp: `用法:
  okbot status
  okbot status --port <端口> --data-dir <目录>

打印网关是否在运行（锁 + 健康探测）、pid、owner、port、base URL、bindLan、serveUi、数据目录。
自定义实例时 --port 与 --data-dir 必须同时指定。
退出码: 0 = 运行且健康；1 = 未运行或不健康。`,

  stopAlreadyStopped: 'OkBot 未在运行（已停止）。',
  stopStopping: (pid, owner) => `正在停止 OkBot（pid ${pid}，owner ${owner}）…`,
  stopStopped: '已停止。',
  stopKilled: '进程未响应 SIGTERM，已发送 SIGKILL。',
  stopFailed: (detail) => `停止失败: ${detail}`,
  stopStaleLockReleased: '已清理过期锁（进程已不存在）。',
  stopOwnerElectron: '注意: 锁所有者为 electron，将停止该 Electron 后端进程。',
  stopNotOkbot: '锁/进程无法确认为 OkBot 网关，未发送信号。',
  stopHelp: `用法:
  okbot stop
  okbot stop --port <端口> --data-dir <目录>

向该数据目录锁中记录的 OkBot 网关进程发送 SIGTERM，短暂等待后必要时 SIGKILL。
自定义实例时 --port 与 --data-dir 必须同时指定。
仅停止 owner 为 serve|electron 的进程；过期锁会被清理。`,

  restartStopping: '正在重启：先停止…',
  restartStarting: '正在启动 serve…',
  restartStopFailed: '停止失败，已中止重启。',
  restartHelp: `用法:
  okbot restart
  okbot restart --port <端口> --data-dir <目录>

先 stop，再在当前进程中启动 serve。若本来未运行，则直接启动。
自定义实例时 --port 与 --data-dir 必须同时指定，并会传给 stop 与 serve。`,

  configShowTitle: 'gatewayHttpApi 配置:',
  configDataRoot: (root) => `dataRoot: ${root}`,
  configPort: (port) => `port: ${port}`,
  configBindLan: (v) => `bindLan: ${v}`,
  configServeUi: (v) => `serveUi: ${v}`,
  configTokenMasked: (masked) => `token: ${masked}`,
  configAdminTokenMasked: (masked) => `adminToken: ${masked}`,
  configUpdated: '配置已保存。',
  configRestartNote: '网关正在运行：port / bindLan / serveUi / token 的变更建议执行 okbot restart 后生效。',
  configInvalidPort: '无效端口：请使用 1024–65535 的整数。',
  configInvalidBool: (flag) => `无效布尔值（${flag}）：请使用 true 或 false。`,
  configNothingToSet: '未指定要修改的项。示例: okbot config set --port 18765',
  configUnknownSub: (sub) => `未知 config 子命令: ${sub}`,
  configHelp: `用法:
  okbot config
  okbot config show
  okbot config set --port N [--bind-lan true|false] [--serve-ui true|false]

查看或修改 gatewayHttpApi 设置。HTTP API 常开，无 enabled 开关。token 默认脱敏显示（用 okbot token show 查看完整令牌）。`,

  tokenShowWarn: '警告: 用户令牌与超管令牌都是密钥，请勿泄露。',
  tokenValue: (token) => token,
  tokenEmpty: '（尚未生成用户令牌；启动 serve 时会自动创建）',
  tokenAdminEmpty: '（尚未生成超管令牌；启动 serve 时会自动创建）',
  tokenAccessLabel: '用户令牌:',
  tokenAdminLabel: '超管令牌:',
  tokenResetDone: '已生成新令牌:',
  tokenResetAccessDone: '已生成新用户令牌:',
  tokenResetAdminDone: '已生成新超管令牌:',
  tokenResetAccessDefault: '未指定角色，默认重置用户令牌。可用: okbot token reset access|user|admin',
  tokenResetClients: '客户端需更新为新令牌。',
  tokenResetRestart: '若网关正在运行，建议执行 okbot restart；运行中的进程可能仍使用旧令牌直至重启。',
  tokenUnknownSub: (sub) => `未知 token 子命令: ${sub}`,
  tokenUnknownRole: (role) => `未知令牌角色: ${role}（请用 access、user 或 admin）`,
  tokenHelp: `用法:
  okbot token
  okbot token show [access|user|admin]
  okbot token reset [access|user|admin]

show: 打印用户令牌与/或超管令牌（密钥）。
reset: 生成并保存新令牌（默认 access；可指定 admin）。`,

  dataPath: (p) => p,
  dataOpened: (p) => `已打开: ${p}`,
  dataOpenFailed: (detail) => `无法打开数据目录: ${detail}`,
  dataUnknownSub: (sub) => `未知 data 子命令: ${sub}`,
  dataHelp: `用法:
  okbot data
  okbot data path
  okbot data open

path: 打印数据目录绝对路径（默认 ~/.okbot）。
open: 在文件管理器中打开（macOS: open；Linux: xdg-open）。`,
};

const en: CliMessages = {
  usageTitle: 'Usage: okbot <command> [options]',
  usageCommands: 'Commands:',
  cmdHelp: 'Show help',
  cmdVersion: 'Show version',
  cmdServe: 'Start the gateway (foreground)',
  cmdStatus: 'Show whether the gateway is running',
  cmdStop: 'Stop a running gateway',
  cmdRestart: 'Stop then start the gateway',
  cmdConfig: 'Show or change gatewayHttpApi settings',
  cmdToken: 'Show or reset access/admin tokens',
  cmdData: 'Print or open the data directory',
  helpHint: 'Use okbot <command> --help for details. Global: --lang zh|en',
  unknownCommand: (cmd) => `Unknown command: ${cmd}`,
  invalidLang: 'Invalid --lang; use zh or en',
  versionLabel: (v) => `okbot ${v}`,
  versionMissing: 'Could not read version',

  serveAlreadyRunning: (pid, where) => `OkBot is already running${pid}: ${where}. Not starting another copy.`,
  serveLockHeldNotOkbot: (pid, port) =>
    `Data-dir lock is held (pid ${pid}), but port ${port} is not a verified OkBot. Not starting.`,
  serveStarted: 'OkBot gateway started',
  serveAddress: (base) => `Address ${base}`,
  serveBind: (bind, ui) => `Bind ${bind}, ${ui}`,
  serveUiOn: 'Web UI enabled',
  serveUiOff: 'Web UI disabled',
  serveToken: (token) => `User token ${token}`,
  serveAdminToken: (token) => `Admin token ${token}`,
  serveCtrlC: 'Press Ctrl+C to stop',
  servePortInUse: (port) => `Port ${port} is in use and is not an OkBot server.`,
  serveFailed: '[okbot] serve failed',
  serveDataRoot: (root) => `Data directory ${root}`,
  serveHelp: `Usage:
  okbot serve
  okbot serve --port <port> --data-dir <dir>

Start the OkBot gateway in the foreground (lock, listen, skill watch, schedule ticker, checkpoints, SIGINT/SIGTERM shutdown).

Defaults (neither flag): port 18765, data directory ~/.okbot (if that dir already has server.json, its port is used).
Custom instance: --port and --data-dir must both be set, and must not conflict with an existing instance (port in use or data-dir lock held).

Options:
  --port <N>           Listen port (1024–65535); must be paired with --data-dir
  --data-dir <path>    Instance data root; must be paired with --port
  --help, -h           Show this help
  --lang zh|en         UI language

Examples:
  okbot serve
  okbot serve --port 19001 --data-dir ~/okbot-alt`,

  instanceBothRequired:
    'For a custom instance you must pass both --port and --data-dir (or omit both to use the default ~/.okbot + 18765).',
  instanceInvalidPort: 'Invalid --port: use an integer from 1024–65535.',
  instanceInvalidDataDir: 'Invalid --data-dir: provide a valid directory path.',
  instanceUnknownArgs: (args) => `Unknown arguments: ${args}`,

  statusRunning: 'status: running (healthy)',
  statusNotRunning: 'status: not running',
  statusUnhealthy: 'status: process/lock present but unhealthy',
  statusPid: (pid) => `pid: ${pid}`,
  statusOwner: (owner) => `owner: ${owner}`,
  statusPort: (port) => `port: ${port}`,
  statusBaseUrl: (url) => `baseUrl: ${url}`,
  statusBindLan: (v) => `bindLan: ${v}`,
  statusServeUi: (v) => `serveUi: ${v}`,
  statusDataRoot: (root) => `dataRoot: ${root}`,
  statusHelp: `Usage:
  okbot status
  okbot status --port <port> --data-dir <dir>

Print whether the gateway is running (lock + health probe), pid, owner, port, base URL, bindLan, serveUi, data root.
For a custom instance, --port and --data-dir must both be set.
Exit codes: 0 = running and healthy; 1 = not running or unhealthy.`,

  stopAlreadyStopped: 'OkBot is not running (already stopped).',
  stopStopping: (pid, owner) => `Stopping OkBot (pid ${pid}, owner ${owner})…`,
  stopStopped: 'Stopped.',
  stopKilled: 'Process did not exit after SIGTERM; sent SIGKILL.',
  stopFailed: (detail) => `Stop failed: ${detail}`,
  stopStaleLockReleased: 'Released stale lock (process is gone).',
  stopOwnerElectron: 'Note: lock owner is electron; this will stop that Electron backend process.',
  stopNotOkbot: 'Lock/process could not be verified as an OkBot gateway; no signal sent.',
  stopHelp: `Usage:
  okbot stop
  okbot stop --port <port> --data-dir <dir>

Send SIGTERM to the OkBot gateway pid in that data-dir's lock; wait briefly, then SIGKILL if needed.
For a custom instance, --port and --data-dir must both be set.
Only stops owner serve|electron; stale locks are cleaned up.`,

  restartStopping: 'Restarting: stopping first…',
  restartStarting: 'Starting serve…',
  restartStopFailed: 'Stop failed; aborting restart.',
  restartHelp: `Usage:
  okbot restart
  okbot restart --port <port> --data-dir <dir>

Stop, then start serve in this process. If nothing was running, just start.
For a custom instance, --port and --data-dir must both be set and are forwarded to stop and serve.`,

  configShowTitle: 'gatewayHttpApi config:',
  configDataRoot: (root) => `dataRoot: ${root}`,
  configPort: (port) => `port: ${port}`,
  configBindLan: (v) => `bindLan: ${v}`,
  configServeUi: (v) => `serveUi: ${v}`,
  configTokenMasked: (masked) => `token: ${masked}`,
  configAdminTokenMasked: (masked) => `adminToken: ${masked}`,
  configUpdated: 'Settings saved.',
  configRestartNote:
    'Gateway is running: changes to port / bindLan / serveUi / token usually need okbot restart to take effect.',
  configInvalidPort: 'Invalid port: use an integer from 1024–65535.',
  configInvalidBool: (flag) => `Invalid boolean for ${flag}: use true or false.`,
  configNothingToSet: 'Nothing to set. Example: okbot config set --port 18765',
  configUnknownSub: (sub) => `Unknown config subcommand: ${sub}`,
  configHelp: `Usage:
  okbot config
  okbot config show
  okbot config set --port N [--bind-lan true|false] [--serve-ui true|false]

Show or change gatewayHttpApi settings. HTTP API is always on (no enabled switch). Token is masked by default (use okbot token show for the full value).`,

  tokenShowWarn: 'Warning: user and admin tokens are secrets — do not share them.',
  tokenValue: (token) => token,
  tokenEmpty: '(no user token yet; one is created when serve starts)',
  tokenAdminEmpty: '(no admin token yet; one is created when serve starts)',
  tokenAccessLabel: 'User token:',
  tokenAdminLabel: 'Admin token:',
  tokenResetDone: 'New token generated:',
  tokenResetAccessDone: 'New user token generated:',
  tokenResetAdminDone: 'New admin token generated:',
  tokenResetAccessDefault: 'No role given; resetting user token. Use: okbot token reset access|user|admin',
  tokenResetClients: 'Clients must be updated to the new token.',
  tokenResetRestart:
    'If the gateway is running, run okbot restart; the live process may keep using the old token until restart.',
  tokenUnknownSub: (sub) => `Unknown token subcommand: ${sub}`,
  tokenUnknownRole: (role) => `Unknown token role: ${role} (use access, user, or admin)`,
  tokenHelp: `Usage:
  okbot token
  okbot token show [access|user|admin]
  okbot token reset [access|user|admin]

show: print user and/or admin tokens (secrets).
reset: generate and save a new token (defaults to access/user; pass admin for super-admin). New tokens use user_/admin_ prefixes.`,

  dataPath: (p) => p,
  dataOpened: (p) => `Opened: ${p}`,
  dataOpenFailed: (detail) => `Could not open data directory: ${detail}`,
  dataUnknownSub: (sub) => `Unknown data subcommand: ${sub}`,
  dataHelp: `Usage:
  okbot data
  okbot data path
  okbot data open

path: print the absolute data directory (default ~/.okbot).
open: open in the file manager (macOS: open; Linux: xdg-open).`,
};

export function detectLocale(env: NodeJS.ProcessEnv = process.env, argvLang?: string | null): Locale {
  const fromArg = typeof argvLang === 'string' ? argvLang.trim().toLowerCase() : '';
  if (fromArg === 'zh' || fromArg === 'en') return fromArg;
  const okbot = (env.OKBOT_LANG || '').trim().toLowerCase();
  if (okbot === 'zh' || okbot === 'en') return okbot;
  const lang = (env.LC_ALL || env.LANG || '').trim().toLowerCase();
  if (lang.startsWith('zh')) return 'zh';
  return 'en';
}

export function messagesFor(locale: Locale): CliMessages {
  return locale === 'zh' ? zh : en;
}

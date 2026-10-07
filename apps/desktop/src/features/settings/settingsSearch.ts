import type { I18nKey } from '../../i18n';
import type { SettingsTab } from './types';

export type SettingsSearchItem = {
  id: string;
  tab: SettingsTab;
  labelKey: I18nKey;
  /** Extra searchable terms (zh/en literals, aliases). */
  keywords?: string[];
};

/** Jumpable settings rows / sections for global search. */
export const SETTINGS_SEARCH_ITEMS: SettingsSearchItem[] = [
  { id: 'theme', tab: 'general', labelKey: 'theme', keywords: ['外观', 'appearance', 'dark', 'light'] },
  { id: 'language', tab: 'general', labelKey: 'language', keywords: ['语言', '中文', '英文'] },
  {
    id: 'sidebarDockMagnify',
    tab: 'general',
    labelKey: 'sidebarDockMagnify',
    keywords: ['dock', 'magnify', 'zoom', '缩放', '缩放特效', '放大', '侧边栏', 'sidebar', 'collapsed'],
  },
  { id: 'microphone', tab: 'general', labelKey: 'microphone', keywords: ['mic', '语音', 'voice', 'whisper', '麦克风'] },
  {
    id: 'hardwareAcceleration',
    tab: 'general',
    labelKey: 'hardwareAcceleration',
    keywords: ['GPU', '硬件加速'],
  },
  {
    id: 'currentVersion',
    tab: 'updates',
    labelKey: 'currentVersion',
    keywords: ['版本', 'version', '当前版本'],
  },
  {
    id: 'autoUpdate',
    tab: 'updates',
    labelKey: 'autoUpdate',
    keywords: ['更新', 'update', 'upgrade', '自动更新'],
  },
  {
    id: 'checkUpdate',
    tab: 'updates',
    labelKey: 'checkUpdate',
    keywords: ['检查更新', 'check update'],
  },
  {
    id: 'updateSection',
    tab: 'updates',
    labelKey: 'updatesTab',
    keywords: ['自动更新', 'updates', 'release'],
  },
  { id: 'data', tab: 'general', labelKey: 'data', keywords: ['dataDir', '目录', 'folder'] },
  {
    id: 'backupExport',
    tab: 'general',
    labelKey: 'backupExport',
    keywords: ['备份', 'backup', 'export', '导出', '迁移', 'migrate', 'zip'],
  },
  {
    id: 'backupRestore',
    tab: 'general',
    labelKey: 'backupRestore',
    keywords: ['恢复', 'restore', 'import', '导入', '迁移', 'migrate'],
  },
  {
    id: 'notifications',
    tab: 'general',
    labelKey: 'notificationsSetting',
    keywords: ['通知', 'notification', '提醒', 'alert', '未读', 'unread'],
  },
  {
    id: 'closeAction',
    tab: 'general',
    labelKey: 'closeActionSetting',
    keywords: [
      '关闭',
      'close',
      '退出',
      'quit',
      '托盘',
      'tray',
      '菜单栏',
      'menu bar',
      'minimize',
      '最小化',
    ],
  },
  {
    id: 'showAdvancedSettings',
    tab: 'general',
    labelKey: 'showAdvancedSettings',
    keywords: ['高级', 'advanced', '更多设置', 'more settings'],
  },
  {
    id: 'mcpSection',
    tab: 'extensions',
    labelKey: 'mcpSection',
    keywords: ['MCP', '扩展', 'MCP扩展', 'extension', 'MCP extensions', 'server', '服务器', 'plugin', '插件'],
  },
  {
    id: 'developerMode',
    tab: 'general',
    labelKey: 'developerMode',
    keywords: ['高级', 'advanced', 'developer', '开发者', '系统指令'],
  },
  {
    id: 'localHttpApi',
    tab: 'gateway',
    labelKey: 'localHttpApi',
    keywords: ['HTTP', 'API', 'localhost', '127.0.0.1', 'loopback', '本地', '令牌', 'token', 'port', '端口', '网关服务', '网关配置', '网关'],
  },
  {
    id: 'localHttpApiEnable',
    tab: 'gateway',
    labelKey: 'localHttpApiEnable',
    keywords: ['启用', 'enable', 'HTTP API'],
  },
  {
    id: 'localHttpApiPort',
    tab: 'gateway',
    labelKey: 'localHttpApiPort',
    keywords: ['端口', 'port'],
  },
  {
    id: 'localHttpApiToken',
    tab: 'gateway',
    labelKey: 'localHttpApiToken',
    keywords: ['令牌', 'token', 'bearer', 'secret'],
  },
  {
    id: 'localHttpApiBindLan',
    tab: 'gateway',
    labelKey: 'localHttpApiBindLan',
    keywords: ['lan', 'gateway', 'intranet', '局域网', '网关'],
  },
  {
    id: 'localHttpApiServeUi',
    tab: 'gateway',
    labelKey: 'localHttpApiServeUi',
    keywords: ['ui', 'mobile', 'phone', 'web', '手机'],
  },
  {
    id: 'computers',
    tab: 'computers',
    labelKey: 'computers',
    keywords: ['cloud', 'sandbox', 'sandbox-agent', 'docker', '电脑', '云', '电脑连接'],
  },
  {
    id: 'defaultComputer',
    tab: 'computers',
    labelKey: 'defaultComputer',
    keywords: ['default', 'local', '本机', '默认电脑'],
  },
  { id: 'usageTotal', tab: 'usage', labelKey: 'usageTotal', keywords: ['token', '用量', 'usage'] },
  { id: 'usageDailyChart', tab: 'usage', labelKey: 'usageDailyChart', keywords: ['chart', 'daily', '图表'] },
  { id: 'usageByMember', tab: 'usage', labelKey: 'usageByMember', keywords: ['member', '助手'] },
  { id: 'toolManagement', tab: 'tools', labelKey: 'toolManagement', keywords: ['工具'] },
  { id: 'toolRunShell', tab: 'tools', labelKey: 'toolRunShell', keywords: ['shell', '命令'] },
  { id: 'toolReadFile', tab: 'tools', labelKey: 'toolReadFile', keywords: ['read'] },
  { id: 'toolReadSkill', tab: 'tools', labelKey: 'toolReadSkill', keywords: ['skill', '技能', 'read_skill'] },
  { id: 'toolWriteFile', tab: 'tools', labelKey: 'toolWriteFile', keywords: ['write'] },
  { id: 'toolEditFile', tab: 'tools', labelKey: 'toolEditFile', keywords: ['edit'] },
  { id: 'toolGenerateImage', tab: 'tools', labelKey: 'toolGenerateImage', keywords: ['image', 'generate', 'openai', 'dall-e', 'gpt-image', '画图', '生图', '文生图'] },
  { id: 'toolSearchHistory', tab: 'tools', labelKey: 'toolSearchHistory', keywords: ['history', 'search_history', '会话', '历史'] },
  { id: 'toolManageSchedule', tab: 'tools', labelKey: 'toolManageSchedule', keywords: ['schedule', 'cron', '定时'] },
  { id: 'scheduledJobsList', tab: 'tools', labelKey: 'scheduledJobsList', keywords: ['schedule', 'cron', '定时', 'jobs', '任务列表'] },
  { id: 'toolWebFetch', tab: 'tools', labelKey: 'toolWebFetch', keywords: ['fetch', 'url', 'html', '网页', '拉取'] },
  { id: 'toolWebSearch', tab: 'tools', labelKey: 'toolWebSearch', keywords: ['search', 'tavily', 'brave', 'serper', '搜索'] },
  { id: 'webTools', tab: 'tools', labelKey: 'webTools', keywords: ['web', 'tavily', 'brave', 'serper', 'api key', '网页搜索'] },
  { id: 'webSearchProvider', tab: 'tools', labelKey: 'webSearchProvider', keywords: ['provider', 'tavily', 'brave', 'serper'] },
  { id: 'webSearchApiKey', tab: 'tools', labelKey: 'webSearchApiKey', keywords: ['api key', '密钥', 'tavily', 'brave', 'serper'] },
  { id: 'webSearchBaseURL', tab: 'tools', labelKey: 'webSearchBaseURL', keywords: ['baseURL', 'proxy', '自建'] },
  { id: 'webFetchAllowPrivate', tab: 'tools', labelKey: 'webFetchAllowPrivate', keywords: ['SSRF', 'localhost', 'private', '内网'] },
  {
    id: 'autoApproval',
    tab: 'tools',
    labelKey: 'autoApproval',
    keywords: ['审批', '规则', 'HITL', 'approval'],
  },
  {
    id: 'toolRunLimits',
    tab: 'tools',
    labelKey: 'toolRunLimits',
    keywords: ['熔断', 'circuit', 'maxToolCalls', '时长', 'duration', '运行限制'],
  },
  {
    id: 'toolRunMaxToolCalls',
    tab: 'tools',
    labelKey: 'toolRunMaxToolCalls',
    keywords: ['工具次数', 'max tool', '上限'],
  },
  {
    id: 'toolRunMaxDurationSec',
    tab: 'tools',
    labelKey: 'toolRunMaxDurationSec',
    keywords: ['超时', 'timeout', 'duration', '秒'],
  },
  {
    id: 'toolRunRecordTrajectory',
    tab: 'tools',
    labelKey: 'toolRunRecordTrajectory',
    keywords: ['轨迹', 'trace', 'trajectory', '日志'],
  },
  {
    id: 'securityMaster',
    tab: 'security',
    labelKey: 'securityMaster',
    keywords: ['安全', '防护', 'guardrail', 'security'],
  },
  {
    id: 'securityRestrictToHome',
    tab: 'security',
    labelKey: 'securityRestrictToHome',
    keywords: ['路径', '主目录', 'path', 'home'],
  },
  {
    id: 'securityAllowedPaths',
    tab: 'security',
    labelKey: 'securityAllowedPaths',
    keywords: ['允许路径', 'allowlist'],
  },
  {
    id: 'securityDeniedPaths',
    tab: 'security',
    labelKey: 'securityDeniedPaths',
    keywords: ['禁止路径', 'denylist', 'ssh'],
  },
  {
    id: 'securityShellPatterns',
    tab: 'security',
    labelKey: 'securityShellPatterns',
    keywords: ['shell', 'sudo', '危险命令', 'regex', '正则', 'denylist'],
  },
  {
    id: 'securityShellPatternsList',
    tab: 'security',
    labelKey: 'securityShellPatterns',
    keywords: ['shell pattern', '危险模式', '恢复默认'],
  },
  {
    id: 'securityBlockMode',
    tab: 'security',
    labelKey: 'securityBlockMode',
    keywords: ['拦截', 'tripwire', 'reject'],
  },
  { id: 'model', tab: 'model', labelKey: 'model', keywords: ['LLM', 'API'] },
  {
    id: 'customProviders',
    tab: 'model',
    labelKey: 'customProviders',
    keywords: ['供应商', 'provider', 'providers', '自定义供应商', '多供应商'],
  },
  { id: 'baseURL', tab: 'model', labelKey: 'api', keywords: ['BaseURL', 'base url', 'endpoint'] },
  { id: 'apiKey', tab: 'model', labelKey: 'api', keywords: ['API Key', '密钥', 'sk-'] },
  { id: 'apiFormat', tab: 'model', labelKey: 'apiFormat', keywords: ['api format', 'responses', 'completions'] },
  { id: 'modelList', tab: 'model', labelKey: 'modelList', keywords: ['model list', 'models', '模型列表', '最大输出窗口', 'maxTokens', 'max tokens', 'max_output_tokens', '跟随服务商', 'provider default', '默认'] },
  {
    id: 'defaultModel',
    tab: 'model',
    labelKey: 'defaultModelLabel',
    keywords: ['默认模型', 'default model', 'global default'],
  },
  {
    id: 'contextCompression',
    tab: 'model',
    labelKey: 'contextCompression',
    keywords: ['压缩', 'summary', 'buffer'],
  },
  { id: 'compressRatio', tab: 'model', labelKey: 'compressRatio', keywords: ['触发比例'] },
  {
    id: 'autoTopicCompress',
    tab: 'model',
    labelKey: 'autoTopicCompress',
    keywords: ['换题', '新话题', 'topic', 'auto compress'],
  },
  {
    id: 'compressKeepRecentMax',
    tab: 'model',
    labelKey: 'compressKeepRecentMax',
  },
  {
    id: 'compressKeepRecentMin',
    tab: 'model',
    labelKey: 'compressKeepRecentMin',
  },
  {
    id: 'compressSummaryMaxChars',
    tab: 'model',
    labelKey: 'compressSummaryMaxChars',
  },
  {
    id: 'maxTurns',
    tab: 'model',
    labelKey: 'chatMaxTurns',
    keywords: ['maxTurns', '回合', '单次运行', 'turns'],
  },
  {
    id: 'assistantRoleTemplate',
    tab: 'instructions',
    labelKey: 'assistantRoleTemplate',
    keywords: ['助手', '角色', '角色句', '指令', 'assistant', 'role', 'template', 'instructions'],
  },
  {
    id: 'squadCaptainPersona',
    tab: 'instructions',
    labelKey: 'squadCaptainPersona',
    keywords: ['队长', '指令', '人设', 'captain', 'persona', 'instructions', '小队'],
  },
  {
    id: 'squadPlaybook',
    tab: 'instructions',
    labelKey: 'squadPlaybook',
    keywords: ['协作', 'playbook', '指引', 'guidance'],
  },
  {
    id: 'squadCaptainMaxTurns',
    tab: 'instructions',
    labelKey: 'squadCaptainMaxTurns',
    keywords: ['maxTurns', '回合', '队长'],
  },
  {
    id: 'squadMemberMaxTurns',
    tab: 'instructions',
    labelKey: 'squadMemberMaxTurns',
    keywords: ['maxTurns', '队员', 'member'],
  },
  {
    id: 'agentsMdRefreshSystemPrompt',
    tab: 'instructions',
    labelKey: 'agentsMdRefreshSystemPrompt',
    keywords: ['AGENTS', 'AGENTS.md', 'system', '模版', '维护', 'refresh', 'agents'],
  },
  {
    id: 'agentsMdRecentMessageLimit',
    tab: 'instructions',
    labelKey: 'agentsMdRecentMessageLimit',
    keywords: ['AGENTS', '最近消息', '条数', 'limit', 'refresh', 'agents'],
  },
  {
    id: 'scopeInstruction',
    tab: 'instructions',
    labelKey: 'memoryScopeInstruction',
    keywords: ['记忆', 'memory', 'scope', 'global', '全局', '记忆判定', '范围判定', 'scope instruction'],
  },
  {
    id: 'memoryRecentMessageLimit',
    tab: 'instructions',
    labelKey: 'memoryRecentMessageLimit',
    keywords: ['记忆', 'memory', '最近消息', '条数', 'limit', 'refresh'],
  },
  {
    id: 'skillsCreateUpdateInstruction',
    tab: 'instructions',
    labelKey: 'skillsCreateUpdateInstruction',
    keywords: ['技能', 'skill', '判定', '更新', '生成', 'skills', 'refresh'],
  },
  {
    id: 'skillsRecentMessageLimit',
    tab: 'instructions',
    labelKey: 'skillsRecentMessageLimit',
    keywords: ['技能', 'skill', '最近消息', '条数', 'limit', 'skills'],
  },
  {
    id: 'globalMemories',
    tab: 'memory',
    labelKey: 'globalMemories',
    keywords: ['记忆', 'memory', 'global memory', '全局记忆', '全局记忆管理', '列表'],
  },
];

/** Nav label for each settings tab. */
export const SETTINGS_TAB_LABEL_KEYS: Record<SettingsTab, I18nKey> = {
  general: 'general',
  gateway: 'gateway',
  computers: 'computers',
  extensions: 'extensionsTab',
  tools: 'tools',
  security: 'security',
  model: 'model',
  instructions: 'instructions',
  memory: 'memoryTab',
  usage: 'usageTab',
  updates: 'updatesTab',
};

/** Tabs shown only when 「显示高级设置」 is on. */
const ADVANCED_TABS: ReadonlySet<SettingsTab> = new Set<SettingsTab>([
  'security',
  'gateway',
  'computers',
  'extensions',
]);

/** Rows inside common tabs that are hidden until 「显示高级设置」 is on. */
const ADVANCED_ITEM_IDS: ReadonlySet<string> = new Set([
  'toolRunLimits',
  'contextCompression',
  'autoTopicCompress',
  'maxTurns',
]);

export function isAdvancedSettingsTab(tab: SettingsTab): boolean {
  return ADVANCED_TABS.has(tab);
}

export function isAdvancedSettingsItem(item: SettingsSearchItem): boolean {
  return (
    ADVANCED_TABS.has(item.tab) ||
    ADVANCED_ITEM_IDS.has(item.id) ||
    item.id.startsWith('toolRun') ||
    item.id.startsWith('compress')
  );
}

export type SettingsTab =
  | 'general'
  | 'gateways'
  | 'gateway'
  | 'extensions'
  | 'tools'
  | 'security'
  | 'model'
  | 'instructions'
  | 'memory'
  | 'usage'
  | 'updates';

/** Sub-section inside the 指令 settings page. */
export type InstructionsSubTab = 'assistant' | 'squad' | 'soul' | 'memory' | 'skills' | 'builtin';

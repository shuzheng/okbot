export type SettingsTab =
  | 'general'
  | 'gateway'
  | 'computers'
  | 'extensions'
  | 'tools'
  | 'security'
  | 'model'
  | 'instructions'
  | 'memory'
  | 'usage'
  | 'updates';

/** Sub-section inside the 指令 settings page. */
export type InstructionsSubTab = 'assistant' | 'squad' | 'agents' | 'memory' | 'skills';

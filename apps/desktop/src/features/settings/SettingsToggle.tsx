type SettingsToggleProps = {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  'aria-label'?: string;
};

/** Shared settings switch (knob) used across settings rows and model list. */
export function SettingsToggle({ checked, onChange, disabled, 'aria-label': ariaLabel }: SettingsToggleProps) {
  return (
    <button
      type="button"
      className={`settings-toggle${checked ? ' on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={onChange}
    >
      <span className="settings-toggle-knob" />
    </button>
  );
}

import { useState } from 'react';
import {
  DEFAULT_SANDBOX_PORT,
  generateComputerId,
  type ComputerEntry,
} from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import { SettingsHelpTip } from './SettingsHelpTip';

function updateAt(
  computers: ComputerEntry[],
  index: number,
  patch: Partial<ComputerEntry>,
): ComputerEntry[] {
  return computers.map((entry, i) => (i === index ? { ...entry, ...patch } : entry));
}

/**
 * Registered remote computers. Same row/card/help-tip pattern as model and
 * security settings — not a one-off multi-input strip.
 */
export function ComputersSettingsPanel({
  lang,
  computers,
  onChange,
}: {
  lang: UiLang;
  computers: ComputerEntry[];
  onChange: (next: ComputerEntry[]) => void;
}) {
  const [draftName, setDraftName] = useState('Cloud');
  const [draftHost, setDraftHost] = useState('127.0.0.1');
  const [draftPort, setDraftPort] = useState(String(DEFAULT_SANDBOX_PORT));
  const [draftToken, setDraftToken] = useState('');
  const [probe, setProbe] = useState<{ kind: 'idle' | 'loading' | 'error'; message: string }>({
    kind: 'idle',
    message: '',
  });

  async function addComputer() {
    const host = draftHost.trim();
    const token = draftToken.trim();
    const port = Number(draftPort);
    if (!host || !token || !Number.isInteger(port) || port < 1 || port > 65535) {
      setProbe({ kind: 'error', message: t(lang, 'computerProbeNeedFields') });
      return;
    }
    setProbe({ kind: 'loading', message: t(lang, 'computerProbing') });
    try {
      const res = await window.okbot.probeComputer({
        name: draftName.trim() || 'Cloud',
        host,
        port,
        token,
      });
      if (!res.ok) {
        const key =
          res.error === 'unauthorized'
            ? 'computerProbeUnauthorized'
            : res.error === 'not_sandbox'
              ? 'computerProbeNotSandbox'
              : res.error === 'need_fields'
                ? 'computerProbeNeedFields'
                : 'computerProbeUnreachable';
        setProbe({ kind: 'error', message: t(lang, key) });
        return;
      }
      onChange([
        ...computers,
        {
          id: generateComputerId(),
          name: draftName.trim() || 'Cloud',
          host,
          port,
          token,
        },
      ]);
      setDraftToken('');
      setProbe({ kind: 'idle', message: '' });
    } catch {
      setProbe({ kind: 'error', message: t(lang, 'computerProbeUnreachable') });
    }
  }

  return (
    <div>
      <div
        className="settings-section-label settings-section-label-with-help"
        data-settings-id="computers"
      >
        <span>{t(lang, 'computers')}</span>
        <SettingsHelpTip text={t(lang, 'computersHint')} />
      </div>
      <div className="settings-card settings-card-model">
        <div className="settings-row">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'computerLocal')}</span>
          </span>
          <span className="settings-muted">local</span>
        </div>
      </div>

      {computers.map((computer, index) => (
        <div
          key={computer.id}
          className="settings-card settings-card-model"
          style={{ marginTop: 12 }}
        >
          <div className="settings-row">
            <span className="settings-row-label">
              <span className="settings-row-label-text">{t(lang, 'computerName')}</span>
            </span>
            <input
              className="wide"
              spellCheck={false}
              value={computer.name}
              placeholder={t(lang, 'computerName')}
              onChange={(e) => onChange(updateAt(computers, index, { name: e.target.value }))}
            />
          </div>
          <div className="settings-row">
            <span className="settings-row-label">
              <span className="settings-row-label-text">{t(lang, 'computerHost')}</span>
              <SettingsHelpTip text={t(lang, 'computerHostHint')} />
            </span>
            <input
              className="wide"
              spellCheck={false}
              value={computer.host}
              placeholder={t(lang, 'computerHost')}
              onChange={(e) => onChange(updateAt(computers, index, { host: e.target.value }))}
            />
          </div>
          <div className="settings-row">
            <span className="settings-row-label">
              <span className="settings-row-label-text">{t(lang, 'computerPort')}</span>
              <SettingsHelpTip text={t(lang, 'computerPortHint')} />
            </span>
            <input
              className="wide"
              spellCheck={false}
              inputMode="numeric"
              value={String(computer.port)}
              placeholder={t(lang, 'computerPort')}
              onChange={(e) =>
                onChange(
                  updateAt(computers, index, {
                    port: Number(e.target.value) || DEFAULT_SANDBOX_PORT,
                  }),
                )
              }
            />
          </div>
          <div className="settings-row">
            <span className="settings-row-label">
              <span className="settings-row-label-text">{t(lang, 'computerToken')}</span>
              <SettingsHelpTip text={t(lang, 'computerTokenHint')} />
            </span>
            <input
              className="wide"
              type="password"
              spellCheck={false}
              autoComplete="off"
              value={computer.token}
              placeholder={t(lang, 'computerToken')}
              onChange={(e) => onChange(updateAt(computers, index, { token: e.target.value }))}
            />
          </div>
          <div className="settings-row">
            <span className="settings-row-label">{t(lang, 'computerRemove')}</span>
            <button
              type="button"
              className="settings-aar-add-btn"
              onClick={() => onChange(computers.filter((_, i) => i !== index))}
            >
              {t(lang, 'computerRemove')}
            </button>
          </div>
        </div>
      ))}

      <div className="settings-card settings-card-model" style={{ marginTop: 12 }}>
        <div className="settings-row">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'computerName')}</span>
          </span>
          <input
            className="wide"
            spellCheck={false}
            value={draftName}
            placeholder={t(lang, 'computerName')}
            onChange={(e) => setDraftName(e.target.value)}
          />
        </div>
        <div className="settings-row">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'computerHost')}</span>
            <SettingsHelpTip text={t(lang, 'computerHostHint')} />
          </span>
          <input
            className="wide"
            spellCheck={false}
            value={draftHost}
            placeholder={t(lang, 'computerHost')}
            onChange={(e) => setDraftHost(e.target.value)}
          />
        </div>
        <div className="settings-row">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'computerPort')}</span>
            <SettingsHelpTip text={t(lang, 'computerPortHint')} />
          </span>
          <input
            className="wide"
            spellCheck={false}
            inputMode="numeric"
            value={draftPort}
            placeholder={t(lang, 'computerPort')}
            onChange={(e) => setDraftPort(e.target.value)}
          />
        </div>
        <div className="settings-row">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'computerToken')}</span>
            <SettingsHelpTip text={t(lang, 'computerTokenHint')} />
          </span>
          <input
            className="wide"
            type="password"
            spellCheck={false}
            autoComplete="off"
            value={draftToken}
            placeholder={t(lang, 'computerToken')}
            onChange={(e) => setDraftToken(e.target.value)}
          />
        </div>
        {probe.kind !== 'idle' ? (
          <div className={`model-list-status${probe.kind === 'error' ? ' error' : ''}`}>{probe.message}</div>
        ) : null}
        <div className="settings-row">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'computerAdd')}</span>
            <SettingsHelpTip text={t(lang, 'computersHint')} />
          </span>
          <button
            type="button"
            className="settings-aar-add-btn"
            disabled={probe.kind === 'loading'}
            onClick={() => {
              void addComputer();
            }}
          >
            {t(lang, 'computerAdd')}
          </button>
        </div>
      </div>
    </div>
  );
}

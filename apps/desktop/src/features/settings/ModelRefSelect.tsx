import {
  formatContextWindowBadge,
  type ModelProvider,
} from '@okbot/shared';
import { t, type UiLang } from '../../i18n';

const SEP = '\u001f';

export function encodeModelRefValue(providerId: string, modelId: string): string {
  if (!providerId || !modelId) return '';
  return `${providerId}${SEP}${modelId}`;
}

export function decodeModelRefValue(raw: string): { providerId: string; modelId: string } {
  const s = (raw || '').trim();
  if (!s) return { providerId: '', modelId: '' };
  const i = s.indexOf(SEP);
  if (i <= 0) return { providerId: '', modelId: '' };
  return { providerId: s.slice(0, i), modelId: s.slice(i + SEP.length) };
}

export function ModelRefSelect({
  lang,
  providers,
  providerId,
  modelId,
  defaultProviderId,
  defaultModelId,
  emptyLabel,
  id,
  onChange,
}: {
  lang: UiLang;
  providers: ModelProvider[];
  providerId: string;
  modelId: string;
  defaultProviderId?: string;
  defaultModelId?: string;
  /** Label for the empty / follow-default option. Omit to hide (required pickers). */
  emptyLabel?: string;
  id?: string;
  onChange: (next: { providerId: string; modelId: string }) => void;
}) {
  const value = encodeModelRefValue(providerId, modelId);

  return (
    <select
      id={id}
      className="model-ref-select"
      value={value}
      onChange={(e) => onChange(decodeModelRefValue(e.target.value))}
    >
      {emptyLabel != null ? <option value="">{emptyLabel}</option> : null}
      {providers.map((p) => {
        const models = p.models.filter(
          (m) => m.enabled || (p.id === providerId && m.id === modelId),
        );
        if (!models.length) return null;
        const groupLabel = p.name.trim() || p.id;
        return (
          <optgroup key={p.id} label={groupLabel}>
            {models.map((m) => {
              const isDefault =
                p.id === defaultProviderId && m.id === defaultModelId;
              const label = `${groupLabel} / ${m.name || m.id}${
                isDefault ? ` · ${t(lang, 'modelDefaultBadge')}` : ''
              } (${formatContextWindowBadge(m.contextWindow)})`;
              return (
                <option key={`${p.id}:${m.id}`} value={encodeModelRefValue(p.id, m.id)}>
                  {label}
                </option>
              );
            })}
          </optgroup>
        );
      })}
    </select>
  );
}

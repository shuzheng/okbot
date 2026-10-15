import type { MemoryEntry } from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import { MemoryEntriesList } from './MemoryEntriesList';
import { SettingsHelpTip } from './SettingsHelpTip';
import { toast } from '../../components/ui';
import { formatSystemError } from '../../utils/formatSystemError';

export function MemorySettingsPanel({
  lang,
  globalMemories,
  setGlobalMemories,
  globalMemAddRequest,
  setGlobalMemAddRequest,
}: {
  setGlobalMemAddRequest: React.Dispatch<React.SetStateAction<number>>;
  globalMemAddRequest: number;
  lang: UiLang;
  globalMemories: MemoryEntry[];
  setGlobalMemories: React.Dispatch<React.SetStateAction<MemoryEntry[]>>;
}) {
  return (

    <div>
      <div
        className="settings-section-label settings-section-label-with-help"
        data-settings-id="globalMemories"
      >
        <span>{t(lang, 'globalMemoriesManage')}</span>
        <SettingsHelpTip text={t(lang, 'globalMemoriesManageHint')} />
      </div>
      <div className="settings-card">
        <div className="settings-row">
          <span className="settings-row-label">{t(lang, 'memoryList')}</span>
          <div className="settings-row-trailing">
            <button
              type="button"
              className="settings-aar-add-btn"
              onClick={() => setGlobalMemAddRequest((n: any) => n + 1)}
            >
              {t(lang, 'globalMemoriesAdd')}
            </button>
          </div>
        </div>
        <MemoryEntriesList
          lang={lang}
          entries={globalMemories}
          requestAdd={globalMemAddRequest}
          emptyLabel={t(lang, 'globalMemoriesEmpty')}
          placeholder={t(lang, 'globalMemoryPlaceholder')}
          newBotId="global"
          onCommit={async (entry) => {
            try {
              await window.okbot.upsertGlobalMemory(entry);
              setGlobalMemories((list) => {
                const idx = list.findIndex((m) => m.id === entry.id);
                if (idx >= 0) {
                  const next = list.slice();
                  next[idx] = entry;
                  return next;
                }
                return [...list, entry];
              });
            } catch (err) {
              toast.error(formatSystemError(err));
              throw err;
            }
          }}
          onDelete={async (id) => {
            try {
              await window.okbot.deleteGlobalMemory(id);
              setGlobalMemories((list) => list.filter((m) => m.id !== id));
            } catch (err) {
              toast.error(formatSystemError(err));
            }
          }}
        />
      </div>
    </div>
  );
}

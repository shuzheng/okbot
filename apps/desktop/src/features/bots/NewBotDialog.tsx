import { useEffect, useId, useRef, useState } from 'react';
import type { BotAvatarShape } from '@okbot/shared';
import { t } from '../../i18n';
import { FlatAvatar } from '../../components/ui/avatars';
import { CloseIcon, toast } from '../../components/ui';
import { AvatarPicker, type AvatarValue } from './AvatarPicker';

export type NewBotDraft = AvatarValue & { name: string };

/**
 * 新建助手: name + avatar first; nothing is created until 「确认」.
 * Cancel / Esc / backdrop click closes without creating anything.
 */
export function NewBotDialog({
  lang,
  initialEmoji,
  initialBotAvatarType,
  onCancel,
  onConfirm,
}: {
  lang: 'zh' | 'en';
  initialEmoji: string;
  initialBotAvatarType: BotAvatarShape;
  onCancel: () => void;
  /** Resolve when created (dialog closes); reject keeps the dialog open. */
  onConfirm: (draft: NewBotDraft) => Promise<void>;
}) {
  const titleId = useId();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<AvatarValue>({
    avatarKind: 'bot-avatar',
    emoji: initialEmoji,
    // Empty color → bot-avatars library default accent.
    color: '',
    botAvatarType: initialBotAvatarType,
  });
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);

  useEffect(() => {
    // Phone / touch: do not pop the keyboard over the avatar grid on open.
    if (window.matchMedia?.('(pointer: coarse)').matches) return;
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  async function submit() {
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t(lang, 'newBotNeedName'));
      nameRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await onConfirm({ ...avatar, name: trimmed });
    } catch {
      // Caller already toasted; keep the dialog so the user can retry.
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop new-bot-backdrop" onClick={onCancel} role="presentation">
      <div
        className="modal modal-compact new-bot-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id={titleId}>{t(lang, 'createTitle')}</h2>
          <button type="button" className="modal-close" onClick={onCancel} aria-label={t(lang, 'close')}>
            <CloseIcon />
          </button>
        </div>
        <div className="new-bot-dialog-body">
          <div className="new-bot-identity">
            <FlatAvatar
              className="session-pin-avatar"
              emoji={avatar.emoji}
              color={avatar.color}
              avatarKind={avatar.avatarKind}
              botAvatarType={avatar.botAvatarType}
            />
            <div className="field field-name">
              <input
                ref={nameRef}
                spellCheck={false}
                value={name}
                maxLength={40}
                aria-label={t(lang, 'nameLabel')}
                placeholder={t(lang, 'newBotNamePlaceholder')}
                onChange={(e) => setName(e.target.value)}
                onCompositionStart={() => {
                  composingRef.current = true;
                }}
                onCompositionEnd={() => {
                  composingRef.current = false;
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || composingRef.current || e.keyCode === 229) return;
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  void submit();
                }}
              />
            </div>
          </div>
          <AvatarPicker
            lang={lang}
            value={avatar}
            onChange={(patch) => setAvatar((prev) => ({ ...prev, ...patch }))}
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onCancel} disabled={busy}>
            {t(lang, 'cancel')}
          </button>
          <button type="button" className="primary" onClick={() => void submit()} disabled={busy}>
            {t(lang, 'newBotConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

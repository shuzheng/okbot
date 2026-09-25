import { useEffect, useState } from 'react';
import { t, type UiLang } from '../../i18n';

function MinimizeIcon() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
      <path d="M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
      <rect
        x="2.25"
        y="2.25"
        width="7.5"
        height="7.5"
        rx="0.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
      <path
        d="M4 4.2h5.3v5.3H4V4.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.15"
      />
      <path
        d="M2.7 7.8V2.7H7.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.15"
      />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
      <path
        d="M3 3l6 6M9 3L3 9"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function WindowControls({ lang }: { lang: UiLang }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.okbot.windowIsMaximized().then((v) => {
      if (!cancelled) setMaximized(v);
    });
    const off = window.okbot.onWindowMaximizedChanged((v) => setMaximized(v));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return (
    <div className="window-controls" role="group" aria-label="Window">
      <button
        type="button"
        className="window-control-btn minimize"
        title={t(lang, 'windowMinimize')}
        aria-label={t(lang, 'windowMinimize')}
        onClick={() => {
          void window.okbot.windowMinimize();
        }}
      >
        <MinimizeIcon />
      </button>
      <button
        type="button"
        className="window-control-btn maximize"
        title={t(lang, maximized ? 'windowRestore' : 'windowMaximize')}
        aria-label={t(lang, maximized ? 'windowRestore' : 'windowMaximize')}
        onClick={() => {
          void window.okbot.windowMaximizeToggle().then(setMaximized);
        }}
      >
        {maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>
      <button
        type="button"
        className="window-control-btn close"
        title={t(lang, 'windowClose')}
        aria-label={t(lang, 'windowClose')}
        onClick={() => {
          void window.okbot.windowClose();
        }}
      >
        <CloseGlyph />
      </button>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckIcon, GatewayIcon } from '../../components/ui/icons';
import { requestConfirm, toast } from '../../components/ui';
import { t, type UiLang } from '../../i18n';
import { isPureWebUi } from '../../utils/gatewayClient';

const CLOSE_DELAY_MS = 160;

type ClientGatewayEntry = {
  id: string;
  label: string;
  kind: 'local' | 'remote';
  baseUrl?: string;
  token?: string;
};

type ClientGatewayPrefs = {
  activeId: string;
  gateways: ClientGatewayEntry[];
};

function hasSwitcherApi(): boolean {
  // Pure WebUI is single-gateway attached; list/switch live in Electron client config.
  if (isPureWebUi()) return false;
  return (
    typeof window.okbot?.getClientGatewayPrefs === 'function' &&
    typeof window.okbot?.switchClientGateway === 'function'
  );
}

/**
 * Circular gateway control to the left of the chat member pill.
 * Hover opens a dropdown of client gateways; click switches via the same
 * hot-switch path as Settings → 客户端 → 网关列表.
 */
export function ChatGatewaySwitcher({ lang }: { lang: UiLang }) {
  const [prefs, setPrefs] = useState<ClientGatewayPrefs | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const reloadPrefs = useCallback(async () => {
    if (!hasSwitcherApi()) {
      setPrefs(null);
      return;
    }
    try {
      const next = await window.okbot.getClientGatewayPrefs();
      setPrefs(next);
    } catch {
      setPrefs(null);
    }
  }, []);

  useEffect(() => {
    void reloadPrefs();
  }, [reloadPrefs]);

  useEffect(() => {
    const onReconnect = () => {
      void reloadPrefs();
    };
    window.addEventListener('okbot:gateway-reconnected', onReconnect);
    return () => window.removeEventListener('okbot:gateway-reconnected', onReconnect);
  }, [reloadPrefs]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    const onPointer = (e: MouseEvent | PointerEvent) => {
      const node = e.target as Node | null;
      if (!node) return;
      if (rootRef.current?.contains(node)) return;
      setOpen(false);
    };
    const timer = window.setTimeout(() => {
      window.addEventListener('keydown', onKey);
      window.addEventListener('pointerdown', onPointer, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [open]);

  const clearCloseTimer = () => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const openMenu = () => {
    clearCloseTimer();
    setOpen(true);
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, CLOSE_DELAY_MS);
  };

  async function switchActive(id: string) {
    if (!prefs || id === prefs.activeId || switching) return;
    const target = prefs.gateways.find((g) => g.id === id);
    const displayName =
      target?.kind === 'local'
        ? t(lang, 'clientGatewayLocalLabel')
        : target?.label || id;
    const switchApi = window.okbot.switchClientGateway;
    if (typeof switchApi !== 'function') {
      toast.error(t(lang, 'clientGatewaysUnavailable'));
      return;
    }

    const ok = await requestConfirm({
      title: t(lang, 'clientGatewaySwitchTitle'),
      message: t(lang, 'clientGatewaySwitchMessage').replace('{name}', displayName),
      confirmLabel: t(lang, 'clientGatewaySwitchConfirm'),
      cancelLabel: t(lang, 'cancel'),
      danger: false,
    });
    if (!ok) return;

    setOpen(false);
    setSwitching(true);
    try {
      toast.info(t(lang, 'clientGatewaySwitching'));
      const result = await switchApi(id);
      setPrefs(result.prefs);
      if (result.mode === 'hot') {
        toast.success(t(lang, 'clientGatewaySwitched'));
        return;
      }
      toast.info(t(lang, 'clientGatewayRelaunching'));
      await window.okbot.relaunchApp();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSwitching(false);
    }
  }

  if (!hasSwitcherApi() || !prefs || prefs.gateways.length === 0) return null;

  const label = t(lang, 'chatGatewaySwitcher');

  return (
    <div
      ref={rootRef}
      className={`chat-gateway-switcher${open ? ' is-open' : ''}${switching ? ' is-switching' : ''}`}
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className="chat-gateway-btn"
        title={label}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={switching}
        onClick={() => {
          clearCloseTimer();
          setOpen((v) => !v);
        }}
      >
        <GatewayIcon />
      </button>
      {open ? (
        <div className="menu chat-gateway-menu" role="menu" aria-label={label}>
          {prefs.gateways.map((gw) => {
            const selected = gw.id === prefs.activeId;
            const displayName =
              gw.kind === 'local' ? t(lang, 'clientGatewayLocalLabel') : gw.label;
            const kindLabel =
              gw.kind === 'local'
                ? t(lang, 'clientGatewayKindLocal')
                : t(lang, 'clientGatewayKindRemote');
            return (
              <button
                key={gw.id}
                type="button"
                role="menuitem"
                className={selected ? 'is-active' : undefined}
                aria-current={selected ? 'true' : undefined}
                disabled={switching || selected}
                onClick={() => {
                  if (selected) return;
                  void switchActive(gw.id);
                }}
              >
                <span className="chat-gateway-menu-main">
                  <span className="chat-gateway-menu-name">{displayName}</span>
                  <span className="chat-gateway-menu-kind">{kindLabel}</span>
                </span>
                {selected ? (
                  <span className="chat-gateway-menu-check" aria-hidden>
                    <CheckIcon />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

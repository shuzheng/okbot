import type { ClientGatewayPrefs } from './clientGatewayPrefs';

export type SwitchClientGatewayResult = {
  mode: 'hot' | 'relaunch';
  prefs: ClientGatewayPrefs;
  previousActiveId: string;
  /** Present when mode === 'hot' — renderer updates attach HTTP target. */
  base?: string;
  token?: string;
};

type SwitchFn = (id: string) => Promise<SwitchClientGatewayResult>;

let switchImpl: SwitchFn | null = null;

export function bindClientGatewaySwitch(fn: SwitchFn): void {
  switchImpl = fn;
}

export async function invokeClientGatewaySwitch(id: string): Promise<SwitchClientGatewayResult> {
  if (!switchImpl) {
    throw new Error('client_gateway_switch_unbound');
  }
  return switchImpl(id);
}

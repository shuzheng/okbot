/** getUserMedia helpers — honors settings microphoneId. */

export type MicErrorKind = 'unavailable' | 'no-device' | 'permission' | 'open-failed';

export type OpenMicResult =
  | { ok: true; stream: MediaStream }
  | { ok: false; kind: MicErrorKind; message?: string };

export async function openMicStream(preferredDeviceId?: string): Promise<OpenMicResult> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, kind: 'unavailable' };
  }

  let inputs: MediaDeviceInfo[] = [];
  try {
    inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  } catch {
    inputs = [];
  }
  if (inputs.length === 0) {
    return { ok: false, kind: 'no-device' };
  }

  const preferredId = (preferredDeviceId || '').trim();
  const audioConstraint: MediaTrackConstraints | true = preferredId
    ? { deviceId: { ideal: preferredId } }
    : true;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
    return { ok: true, stream };
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return { ok: false, kind: 'permission' };
    }
    for (const d of inputs) {
      if (!d.deviceId) continue;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: d.deviceId } },
        });
        return { ok: true, stream };
      } catch {
        /* next */
      }
    }
    return {
      ok: false,
      kind: 'open-failed',
      message: err instanceof Error ? err.message : undefined,
    };
  }
}

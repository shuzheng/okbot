import { useEffect, useRef, type MutableRefObject, type ReactNode } from 'react';
import { DistortionWave, type DistortionWaveHandle } from 'distortion-waves';
import { evolutionWavePlayOptions } from './memberEvolutionWave';

/**
 * Plays a one-shot center DistortionWave over the chat-header member pill
 * after that owner's post-turn self-evolution completes.
 */
export function MemberPillEvolutionWave({
  ownerId,
  nonce,
  consumedRef,
  children,
}: {
  ownerId: string;
  nonce: number;
  consumedRef: MutableRefObject<Record<string, number>>;
  children: ReactNode;
}) {
  const waveRef = useRef<DistortionWaveHandle>(null);

  useEffect(() => {
    if (!nonce) return;
    if (consumedRef.current[ownerId] === nonce) return;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      if (consumedRef.current[ownerId] === nonce) return;
      consumedRef.current[ownerId] = nonce;
      const el = waveRef.current?.element;
      if (!el) return;
      waveRef.current?.play(evolutionWavePlayOptions(el.clientWidth, el.clientHeight));
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [nonce, ownerId, consumedRef]);

  return (
    <DistortionWave
      ref={waveRef}
      type="center"
      className="chat-member-pill-wave"
      cornerRadius={999}
    >
      {children}
    </DistortionWave>
  );
}

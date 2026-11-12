/** Nivel 0..1 de un trozo de audio (RMS con una curva que levanta la voz baja). */
export function rmsLevel(samples: ArrayLike<number>): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  // ~0.003 es silencio de sala; ~0.25 es voz fuerte cerca del micrófono.
  const v = (Math.log10(Math.max(rms, 0.003)) - Math.log10(0.003)) / (Math.log10(0.25) - Math.log10(0.003));
  return Math.min(1, Math.max(0, v));
}

/** Agrega un nivel al historial y se queda con los últimos `max`. */
export function pushLevel(levels: number[], v: number, max: number): number[] {
  const next = levels.length >= max ? levels.slice(levels.length - max + 1) : levels.slice();
  next.push(v);
  return next;
}

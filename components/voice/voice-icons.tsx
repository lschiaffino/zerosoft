'use client';

const KNOWN_ERRORS = new Set([
  'ai_disabled',
  'quota_exceeded',
  'rate_limited',
  'transcribe_disabled',
  'transcribe_failed',
  'audio_too_large',
  'audio_type',
  'empty_audio',
  'mic_denied',
  'mic_missing',
  'mic_failed',
  'no_tab_audio',
  'too_short',
  'nothing_heard',
  'not_found',
  'duplicate',
  'limit_reached',
  'invalid_state',
  'invalid_input',
  'project_not_found',
  'contact_not_found',
  'booking_not_found',
  'nothing_to_send',
  'storage_unavailable',
  'network',
]);

/** Código de error de la API o del navegador → clave en voice.errors. */
export function voiceErrorKey(code: string | null | undefined): string {
  return code && KNOWN_ERRORS.has(code) ? code : 'generic';
}

export function MicIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="vc-mic-icon">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

/** Cinco barras que siguen el nivel del micrófono. */
export function LevelBars({ level }: { level: number }) {
  const bars = [0.35, 0.7, 1, 0.7, 0.35];
  return (
    <span className="vc-level" aria-hidden="true">
      {bars.map((w, i) => (
        <span key={i} style={{ transform: `scaleY(${Math.max(0.15, Math.min(1, level * w * 1.6))})` }} />
      ))}
    </span>
  );
}


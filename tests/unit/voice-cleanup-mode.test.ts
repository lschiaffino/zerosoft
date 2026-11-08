import { describe, expect, it } from 'vitest';
import { DEFAULT_VOICE_SETTINGS, dictationTone } from '@/lib/voice-types';
import { normalizeSettings } from '@/lib/voice';

/** La lógica del escritorio (portapapeles, atajo, reintentos) se prueba en Rust: desktop/src-tauri (cargo test). */
describe('Voice: modo de limpieza del dictado', () => {
  it('el tono sale del modo', () => {
    const styles = DEFAULT_VOICE_SETTINGS.styles;
    expect(dictationTone({ cleanupMode: 'raw', styles }, 'email')).toBeNull();
    expect(dictationTone({ cleanupMode: 'formal', styles }, 'chat')).toBe('formal');
    expect(dictationTone({ cleanupMode: 'clean', styles }, 'email')).toBe('neutral');
    expect(dictationTone({ cleanupMode: 'per_app', styles }, 'email')).toBe(styles.email);
    expect(dictationTone({ cleanupMode: 'per_app', styles }, 'chat')).toBe(styles.chat);
  });

  it('se guarda y se normaliza (por defecto según la app, como antes)', () => {
    expect(normalizeSettings({}).cleanupMode).toBe('per_app');
    expect(normalizeSettings({ cleanupMode: 'raw' }).cleanupMode).toBe('raw');
    expect(normalizeSettings({ cleanupMode: 'shouty' }).cleanupMode).toBe('per_app');
  });
});

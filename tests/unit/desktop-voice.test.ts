import { describe, expect, it, vi } from 'vitest';
import { pasteViaClipboard, type ClipboardPort } from '../../desktop/src/shared/clipboard';
import { DEFAULT_TOGGLE, isAccelerator, mergeSettingsInput, normalizeSettings, pasteLastShortcut, usesHold, usesToggle } from '../../desktop/src/shared/settings';
import { DOUBLE_TAP_MS, KEY, MIN_HOLD_MS, PushToTalk } from '../../desktop/src/shared/hotkey';
import { classifyResponse, formatClock, isPendingId, keepForRetry, newPendingId, parsePendingMeta, PENDING_MAX, PENDING_MAX_AGE_MS, prunePending, type PendingMeta } from '../../desktop/src/shared/retry';
import { strings } from '../../desktop/src/shared/strings';
import { DEFAULT_VOICE_SETTINGS, dictationTone } from '@/lib/voice-types';
import { normalizeSettings as normalizeVoiceSettings } from '@/lib/voice';

/** Portapapeles de mentira: un snapshot es la lista de "formatos" que había. */
function fakeClipboard(initial: string[]) {
  const state = { items: [...initial], text: initial[0] ?? '', writes: [] as string[], restored: 0, cleared: 0 };
  const port: ClipboardPort<string[]> = {
    snapshot: async () => [...state.items],
    isEmpty: (s) => !s.length,
    writeText: (t) => {
      state.text = t;
      state.items = [t];
      state.writes.push(t);
    },
    readText: () => state.text,
    restore: (s) => {
      state.items = [...s];
      state.text = s[0] ?? '';
      state.restored += 1;
    },
    clear: () => {
      state.items = [];
      state.text = '';
      state.cleared += 1;
    },
  };
  return { state, port };
}

const noSleep = async () => undefined;

describe('desktop: pegar con el portapapeles', () => {
  it('escribe, simula la tecla y devuelve lo que había', async () => {
    const { state, port } = fakeClipboard(['lo que había', '<b>html</b>']);
    const tap = vi.fn();
    const r = await pasteViaClipboard('hola mundo', { clipboard: port, tapPaste: tap, sleep: noSleep, restore: true });
    expect(r.how).toBe('pasted');
    expect(tap).toHaveBeenCalledTimes(1);
    expect(state.writes).toEqual(['hola mundo']);
    expect(await r.restored).toBe(true);
    expect(state.items).toEqual(['lo que había', '<b>html</b>']);
  });

  it('la tecla se simula después de escribir el texto (si no, pegaría lo viejo)', async () => {
    const { state, port } = fakeClipboard(['viejo']);
    let atTap = '';
    await pasteViaClipboard('nuevo', { clipboard: port, tapPaste: () => (atTap = state.text), sleep: noSleep, restore: true });
    expect(atTap).toBe('nuevo');
  });

  it('no pisa algo que la persona copió en el medio', async () => {
    const { state, port } = fakeClipboard(['viejo']);
    const r = await pasteViaClipboard('dictado', {
      clipboard: port,
      tapPaste: () => undefined,
      sleep: async () => {
        state.text = 'copiado por la persona';
      },
      restore: true,
    });
    expect(await r.restored).toBe(false);
    expect(state.text).toBe('copiado por la persona');
    expect(state.restored).toBe(0);
  });

  it('con el portapapeles vacío antes, lo deja vacío', async () => {
    const { state, port } = fakeClipboard([]);
    const r = await pasteViaClipboard('x', { clipboard: port, tapPaste: () => undefined, sleep: noSleep, restore: true });
    expect(await r.restored).toBe(true);
    expect(state.cleared).toBe(1);
    expect(state.items).toEqual([]);
  });

  it('con restaurar apagado, el dictado queda en el portapapeles', async () => {
    const { state, port } = fakeClipboard(['viejo']);
    const r = await pasteViaClipboard('dictado', { clipboard: port, tapPaste: () => undefined, sleep: noSleep, restore: false });
    expect(await r.restored).toBe(false);
    expect(state.text).toBe('dictado');
  });

  it('sin permiso para simular la tecla, solo copia', async () => {
    const { state, port } = fakeClipboard(['viejo']);
    const r = await pasteViaClipboard('dictado', { clipboard: port, tapPaste: null, sleep: noSleep, restore: true });
    expect(r.how).toBe('copied');
    expect(await r.restored).toBe(false);
    expect(state.text).toBe('dictado');
  });

  it('espera antes de devolver (la app de destino lee al procesar la tecla)', async () => {
    const { port } = fakeClipboard(['viejo']);
    const sleep = vi.fn(async () => undefined);
    const r = await pasteViaClipboard('x', { clipboard: port, tapPaste: () => undefined, sleep, restore: true, settleMs: 300 });
    await r.restored;
    expect(sleep).toHaveBeenCalledWith(300);
  });

  it('si leer el portapapeles falla, no devuelve nada ni rompe', async () => {
    const { port } = fakeClipboard(['viejo']);
    port.readText = () => {
      throw new Error('locked');
    };
    const r = await pasteViaClipboard('x', { clipboard: port, tapPaste: () => undefined, sleep: noSleep, restore: true });
    expect(await r.restored).toBe(false);
  });
});

describe('desktop: ajustes locales', () => {
  it('valores por defecto según la plataforma', () => {
    const mac = normalizeSettings({}, 'darwin', 'https://zerosoft.ai');
    expect(mac).toEqual({
      server: 'https://zerosoft.ai',
      mode: 'both',
      hotkey: 'ctrl+alt',
      toggleShortcut: DEFAULT_TOGGLE,
      restoreClipboard: true,
      meetingAlerts: true,
      onboarded: false,
    });
    expect(normalizeSettings(null, 'win32', 'https://x.test').hotkey).toBe('ctrl+meta');
  });

  it('descarta valores inválidos de settings.json', () => {
    const s = normalizeSettings({ mode: 'always', hotkey: 'fn', toggleShortcut: 'A', restoreClipboard: 'no', meetingAlerts: false, onboarded: 'yes' }, 'darwin', 'https://zerosoft.ai');
    expect(s.mode).toBe('both');
    expect(s.hotkey).toBe('ctrl+alt');
    expect(s.toggleShortcut).toBe(DEFAULT_TOGGLE);
    expect(s.restoreClipboard).toBe(true);
    expect(s.meetingAlerts).toBe(false);
    expect(s.onboarded).toBe(false);
  });

  it('atajos de alternar: con modificador o una F sola', () => {
    expect(isAccelerator('Control+Alt+Space')).toBe(true);
    expect(isAccelerator('CommandOrControl+Shift+D')).toBe(true);
    expect(isAccelerator('F8')).toBe(true);
    expect(isAccelerator('A')).toBe(false);
    expect(isAccelerator('Space')).toBe(false);
    expect(isAccelerator('Control+Control+A')).toBe(false);
    expect(isAccelerator('Control+Banana')).toBe(false);
    expect(isAccelerator('Control+Alt+Space'.repeat(10))).toBe(false);
    expect(isAccelerator(42)).toBe(false);
  });

  it('lo que manda Ajustes: solo pisa lo válido', () => {
    const cur = normalizeSettings({}, 'darwin', 'https://zerosoft.ai');
    expect(mergeSettingsInput(cur, { mode: 'toggle', hotkey: 'right-alt', toggleShortcut: 'Control+Shift+Space', restoreClipboard: false })).toEqual({
      mode: 'toggle',
      hotkey: 'right-alt',
      toggleShortcut: 'Control+Shift+Space',
      restoreClipboard: false,
    });
    expect(mergeSettingsInput(cur, { mode: 'x', hotkey: 'fn', toggleShortcut: 'Q', meetingAlerts: 'yes', server: 'http://evil' })).toEqual({});
    expect(mergeSettingsInput(cur, { toggleShortcut: DEFAULT_TOGGLE })).toEqual({});
    expect(mergeSettingsInput(cur, null)).toEqual({});
  });

  it('modos y atajo de pegar el último', () => {
    expect([usesHold('both'), usesToggle('both')]).toEqual([true, true]);
    expect([usesHold('hold'), usesToggle('hold')]).toEqual([true, false]);
    expect([usesHold('toggle'), usesToggle('toggle')]).toEqual([false, true]);
    expect(pasteLastShortcut('darwin')).toBe('Control+Command+V');
    expect(pasteLastShortcut('win32')).toBe('Control+Alt+Shift+V');
  });
});

describe('desktop: manos libres con dos toques', () => {
  it('dos toques rápidos graban sin mantener; el atajo otra vez termina', () => {
    const p = new PushToTalk('ctrl+alt');
    expect(p.keyDown(KEY.Ctrl, 0)).toBeNull();
    expect(p.keyDown(KEY.Alt, 10)).toBe('start');
    expect(p.keyUp(KEY.Alt, 80)).toBe('cancel'); // toque corto
    p.keyUp(KEY.Ctrl, 90);
    p.keyDown(KEY.Ctrl, 200);
    expect(p.keyDown(KEY.Alt, 210)).toBe('handsfree');
    expect(p.handsFree).toBe(true);
    // Soltar no termina; escribir otras teclas tampoco.
    expect(p.keyUp(KEY.Alt, 300)).toBeNull();
    expect(p.keyUp(KEY.Ctrl, 310)).toBeNull();
    expect(p.keyDown(30, 400)).toBeNull();
    expect(p.keyUp(30, 410)).toBeNull();
    expect(p.recording).toBe(true);
    p.keyDown(KEY.Ctrl, 5000);
    expect(p.keyDown(KEY.Alt, 5010)).toBe('stop');
    expect(p.recording).toBe(false);
    expect(p.keyUp(KEY.Alt, 5100)).toBeNull();
  });

  it('Esc cancela el manos libres', () => {
    const p = new PushToTalk('right-alt');
    p.keyDown(KEY.AltRight, 0);
    p.keyUp(KEY.AltRight, 50);
    expect(p.keyDown(KEY.AltRight, 100)).toBe('handsfree');
    p.keyUp(KEY.AltRight, 150);
    expect(p.keyDown(KEY.Escape, 2000)).toBe('cancel');
    expect(p.recording).toBe(false);
  });

  it('dos toques lentos no son manos libres', () => {
    const p = new PushToTalk('right-alt');
    p.keyDown(KEY.AltRight, 0);
    p.keyUp(KEY.AltRight, 50);
    expect(p.keyDown(KEY.AltRight, 50 + DOUBLE_TAP_MS + 1)).toBe('start');
    expect(p.keyUp(KEY.AltRight, 50 + DOUBLE_TAP_MS + 1 + MIN_HOLD_MS + 10)).toBe('stop');
  });

  it('mantener sigue igual: soltar manda', () => {
    const p = new PushToTalk('ctrl+alt');
    p.keyDown(KEY.Ctrl, 0);
    expect(p.keyDown(KEY.Alt, 0)).toBe('start');
    expect(p.keyUp(KEY.Ctrl, 2000)).toBe('stop');
  });

  it('release() olvida la grabación cuando main la termina por otro lado', () => {
    const p = new PushToTalk('right-alt');
    p.keyDown(KEY.AltRight, 0);
    p.keyUp(KEY.AltRight, 50);
    p.keyDown(KEY.AltRight, 100);
    p.release();
    expect(p.recording).toBe(false);
    expect(p.keyDown(KEY.Escape, 200)).toBeNull();
  });
});

describe('desktop: dictados que no llegan', () => {
  it('clasifica la respuesta del servidor', () => {
    expect(classifyResponse(201, { text: '  hola  ' })).toEqual({ ok: true, text: 'hola' });
    expect(classifyResponse(null, null)).toEqual({ ok: false, failure: 'offline' });
    expect(classifyResponse(0, null)).toEqual({ ok: false, failure: 'offline' });
    expect(classifyResponse(401, { error: 'unauthorized' })).toEqual({ ok: false, failure: 'signed_out' });
    expect(classifyResponse(429, null)).toEqual({ ok: false, failure: 'rate_limited' });
    expect(classifyResponse(413, { error: 'audio_too_large' })).toEqual({ ok: false, failure: 'too_large' });
    expect(classifyResponse(400, { error: 'empty_audio' })).toEqual({ ok: false, failure: 'empty' });
    expect(classifyResponse(502, { error: 'transcribe_failed' })).toEqual({ ok: false, failure: 'server' });
    expect(classifyResponse(201, { text: '' })).toEqual({ ok: false, failure: 'empty' });
    expect(classifyResponse(200, null)).toEqual({ ok: false, failure: 'server' });
    expect(classifyResponse(400, { error: 'audio_type' })).toEqual({ ok: false, failure: 'rejected' });
  });

  it('guarda el audio solo si el problema no era el audio', () => {
    expect(['offline', 'signed_out', 'rate_limited', 'server'].every((f) => keepForRetry(f as never))).toBe(true);
    expect(['too_large', 'empty', 'rejected'].some((f) => keepForRetry(f as never))).toBe(false);
  });

  it('ids y meta.json leídos del disco', () => {
    const id = newPendingId(1_700_000_000_000, () => 0.5);
    expect(isPendingId(id)).toBe(true);
    expect(isPendingId('../etc/passwd')).toBe(false);
    expect(isPendingId('AB')).toBe(false);
    expect(parsePendingMeta({ id, createdAt: 1, mime: 'audio/webm', durationMs: 1200.4, sourceApp: 'Slack', context: 'chat', failure: 'offline', attempts: 2 })).toEqual({
      id,
      createdAt: 1,
      mime: 'audio/webm',
      durationMs: 1200,
      sourceApp: 'Slack',
      context: 'chat',
      failure: 'offline',
      attempts: 2,
    });
    expect(parsePendingMeta({ id, createdAt: 1, mime: 'text/html' })?.mime).toBe('audio/webm');
    expect(parsePendingMeta({ id: '../x', createdAt: 1 })).toBeNull();
    expect(parsePendingMeta('nope')).toBeNull();
  });

  it('poda: los más nuevos primero, tope y una semana', () => {
    const now = 10 * PENDING_MAX_AGE_MS;
    const mk = (i: number, age: number): PendingMeta => ({ id: `id${String(i).padStart(6, '0')}`, createdAt: now - age, mime: 'audio/webm', durationMs: 1, sourceApp: '', context: 'other', failure: 'offline', attempts: 0 });
    const list = Array.from({ length: PENDING_MAX + 3 }, (_, i) => mk(i, i * 1000));
    list.push(mk(99, PENDING_MAX_AGE_MS + 1));
    const { keep, drop } = prunePending(list, now);
    expect(keep).toHaveLength(PENDING_MAX);
    expect(keep[0].id).toBe('id000000');
    expect(drop.map((d) => d.id)).toContain('id000099');
    expect(drop).toHaveLength(4);
  });

  it('reloj del overlay', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(7_900)).toBe('0:07');
    expect(formatClock(90_000)).toBe('1:30');
    expect(formatClock(-5)).toBe('0:00');
  });

  it('textos nuevos en los tres idiomas', () => {
    for (const l of ['en', 'es', 'pt'] as const) {
      const s = strings(l);
      for (const k of ['errOffline', 'savedToRetry', 'hudHandsFreeHint', 'retryPendingItem', 'tabHistory', 'updatesManual'] as const) expect(s[k]).toBeTruthy();
      expect(s.hudHandsFreeHint).toContain('{key}');
      expect(s.retryPendingItem).toContain('{n}');
    }
  });
});

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
    expect(normalizeVoiceSettings({}).cleanupMode).toBe('per_app');
    expect(normalizeVoiceSettings({ cleanupMode: 'raw' }).cleanupMode).toBe('raw');
    expect(normalizeVoiceSettings({ cleanupMode: 'shouty' }).cleanupMode).toBe('per_app');
  });
});

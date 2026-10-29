import { describe, expect, it } from 'vitest';
import { deepLinkFromArgv, parseDeepLink } from '../../desktop/src/shared/deeplink';
import { classifyNavigation, isAppUrl, normalizeServer, safeAppPath } from '../../desktop/src/shared/nav';
import { defaultHotkey, hotkeyLabel, isHotkeyId, KEY, MIN_HOLD_MS, PushToTalk } from '../../desktop/src/shared/hotkey';
import { currentEvent, detectMeetingApp, dueEvents } from '../../desktop/src/shared/meetings';
import { contextForApp } from '../../desktop/src/shared/dictation';
import { fill, pickLocale, strings } from '../../desktop/src/shared/strings';
import { multipartBody } from '../../desktop/src/main/multipart';
import { NonceStore } from '../../desktop/src/shared/nonce';

const CODE = 'a'.repeat(43);
const STATE = 'S'.repeat(32);

describe('desktop: deep links zerosoft://', () => {
  it('auth callback con código y state válidos', () => {
    expect(parseDeepLink(`zerosoft://auth/callback?code=${CODE}&state=${STATE}`)).toEqual({ kind: 'auth', code: CODE, state: STATE });
    expect(parseDeepLink(`ZEROSOFT://auth/callback/?code=${CODE}&state=${STATE}`)).toEqual({ kind: 'auth', code: CODE, state: STATE });
  });

  it('rechaza códigos o states con otra forma, otro host o credenciales', () => {
    expect(parseDeepLink(`zerosoft://auth/callback?code=short&state=${STATE}`)).toBeNull();
    expect(parseDeepLink(`zerosoft://auth/callback?code=${CODE}&state=bad state`)).toBeNull();
    expect(parseDeepLink(`zerosoft://auth/callback?code=${CODE}<script>&state=${STATE}`)).toBeNull();
    expect(parseDeepLink(`zerosoft://auth/other?code=${CODE}&state=${STATE}`)).toBeNull();
    expect(parseDeepLink(`zerosoft://user:pw@auth/callback?code=${CODE}&state=${STATE}`)).toBeNull();
    expect(parseDeepLink(`https://auth/callback?code=${CODE}&state=${STATE}`)).toBeNull();
    expect(parseDeepLink(`zerosoft://auth/callback?code=${'x'.repeat(3000)}`)).toBeNull();
    expect(parseDeepLink(42)).toBeNull();
  });

  it('open solo lleva a páginas de la app', () => {
    expect(parseDeepLink('zerosoft://open?path=/app/talk')).toEqual({ kind: 'open', path: '/app/talk' });
    expect(parseDeepLink('zerosoft://open/app/voice?new=1')).toEqual({ kind: 'open', path: '/app/voice?new=1' });
    expect(parseDeepLink('zerosoft://open?path=/es/app/crm/deals')).toEqual({ kind: 'open', path: '/es/app/crm/deals' });
    expect(parseDeepLink('zerosoft://open?path=//evil.com/app')).toBeNull();
    expect(parseDeepLink('zerosoft://open?path=https://evil.com/app')).toBeNull();
    expect(parseDeepLink('zerosoft://open?path=/blog')).toBeNull();
    expect(parseDeepLink('zerosoft://open?path=/app\\..\\x')).toBeNull();
    expect(parseDeepLink('zerosoft://notes')).toEqual({ kind: 'notes' });
    expect(parseDeepLink('zerosoft://nope')).toBeNull();
  });

  it('el link llega en argv (Windows, segunda instancia)', () => {
    expect(deepLinkFromArgv(['zerosoft.exe', '--flag', 'zerosoft://notes'])).toBe('zerosoft://notes');
    expect(deepLinkFromArgv(['zerosoft.exe'])).toBeNull();
  });
});

describe('desktop: navegación', () => {
  const server = 'https://zerosoft.ai';

  it('normaliza el servidor: https, o http solo en localhost', () => {
    expect(normalizeServer('zerosoft.ai')).toBe('https://zerosoft.ai');
    expect(normalizeServer('https://crm.acme.com/app/x')).toBe('https://crm.acme.com');
    expect(normalizeServer('http://localhost:3945')).toBe('http://localhost:3945');
    expect(normalizeServer('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000');
    expect(normalizeServer('http://acme.com')).toBeNull();
    expect(normalizeServer('http://localhost.evil.com')).toBeNull();
    expect(normalizeServer('https://user:pw@acme.com')).toBeNull();
    expect(normalizeServer('ftp://acme.com')).toBeNull();
    expect(normalizeServer('')).toBeNull();
  });

  it('adentro solo el origen exacto del servidor', () => {
    expect(classifyNavigation('https://zerosoft.ai/app/talk', server)).toBe('app');
    expect(classifyNavigation('https://zerosoft.ai.evil.com/app', server)).toBe('external');
    expect(classifyNavigation('http://zerosoft.ai/app', server)).toBe('external');
    expect(classifyNavigation('https://feedback.zerosoft.ai/', server)).toBe('external');
    expect(classifyNavigation('https://accounts.google.com/o/oauth2/v2/auth?client_id=x', server)).toBe('google-login');
    expect(classifyNavigation('mailto:hola@zerosoft.ai', server)).toBe('external');
    expect(classifyNavigation('file:///etc/passwd', server)).toBe('blocked');
    expect(classifyNavigation('javascript:alert(1)', server)).toBe('blocked');
    expect(classifyNavigation('zerosoft://notes', server)).toBe('blocked');
    expect(classifyNavigation('not a url', server)).toBe('blocked');
    expect(isAppUrl('https://zerosoft.ai/x', server)).toBe(true);
    expect(isAppUrl('https://zerosoft.ai:444/x', server)).toBe(false);
  });

  it('paths de la app para avisos y deep links', () => {
    expect(safeAppPath('/app')).toBe('/app');
    expect(safeAppPath('/pt/app/talk/c1?n=2#m')).toBe('/pt/app/talk/c1?n=2#m');
    expect(safeAppPath('/application')).toBeNull();
    expect(safeAppPath('//app')).toBeNull();
    expect(safeAppPath('/app/\u0000')).toBeNull();
    expect(safeAppPath(null)).toBeNull();
  });
});

describe('desktop: mantener para dictar', () => {
  it('empieza con el atajo exacto y termina al soltar', () => {
    const p = new PushToTalk('ctrl+alt');
    expect(p.keyDown(KEY.Ctrl, 0)).toBeNull();
    expect(p.keyDown(KEY.Ctrl, 10)).toBeNull(); // autorepetición
    expect(p.keyDown(KEY.Alt, 20)).toBe('start');
    expect(p.recording).toBe(true);
    expect(p.keyUp(KEY.Alt, 20 + MIN_HOLD_MS + 50)).toBe('stop');
    expect(p.anyDown()).toBe(true);
    expect(p.keyUp(KEY.Ctrl, 400)).toBeNull();
    expect(p.anyDown()).toBe(false);
  });

  it('un toque corto o una tecla de más cancela', () => {
    const p = new PushToTalk('ctrl+alt');
    p.keyDown(KEY.Ctrl, 0);
    expect(p.keyDown(KEY.AltRight, 0)).toBe('start');
    expect(p.keyUp(KEY.Ctrl, 100)).toBe('cancel');
    p.keyUp(KEY.AltRight, 110);
    p.keyDown(KEY.Ctrl, 200);
    expect(p.keyDown(KEY.Alt, 210)).toBe('start');
    expect(p.keyDown(30 /* K */, 600)).toBe('cancel');
    // Con otra tecla ya apretada no empieza.
    const q = new PushToTalk('ctrl+alt');
    q.keyDown(KEY.Shift, 0);
    q.keyDown(KEY.Ctrl, 0);
    expect(q.keyDown(KEY.Alt, 0)).toBeNull();
  });

  it('Option derecho solo, y reset si el hook pierde eventos', () => {
    const p = new PushToTalk('right-alt');
    expect(p.keyDown(KEY.Alt, 0)).toBeNull();
    p.keyUp(KEY.Alt, 10);
    expect(p.keyDown(KEY.AltRight, 20)).toBe('start');
    expect(p.reset()).toBe('cancel');
    expect(p.reset()).toBeNull();
  });

  it('atajo por defecto y nombres por sistema', () => {
    expect(defaultHotkey('darwin')).toBe('ctrl+alt');
    expect(defaultHotkey('win32')).toBe('ctrl+meta');
    expect(hotkeyLabel('ctrl+alt', 'darwin')).toBe('Control + Option');
    expect(hotkeyLabel('ctrl+meta', 'win32')).toBe('Ctrl + Windows');
    expect(isHotkeyId('ctrl+alt')).toBe(true);
    expect(isHotkeyId('fn')).toBe(false);
  });
});

describe('desktop: reuniones', () => {
  it('reconoce Zoom, Meet y Teams en curso', () => {
    expect(detectMeetingApp({ processes: ['zoom.us', 'CptHost'], windowTitles: [] })).toBe('zoom');
    expect(detectMeetingApp({ processes: ['CptHost.exe'], windowTitles: [] })).toBe('zoom');
    expect(detectMeetingApp({ processes: ['zoom.us'], windowTitles: ['Zoom Workplace'] })).toBeNull();
    expect(detectMeetingApp({ processes: [], windowTitles: ['Meet - abc-defg-hij - Google Chrome'] })).toBe('meet');
    expect(detectMeetingApp({ processes: [], windowTitles: ['Google Meet'] })).toBeNull();
    expect(detectMeetingApp({ processes: [], windowTitles: ['Meeting in General | Microsoft Teams'] })).toBe('teams');
    expect(detectMeetingApp({ processes: [], windowTitles: ['Chat | Microsoft Teams'] })).toBeNull();
  });

  it('avisa de eventos que empiezan ahora, sin reunión y una sola vez', () => {
    const now = Date.parse('2026-10-29T15:00:00Z');
    const ev = (key: string, start: string, end: string, sessionId: string | null = null) => ({ key, title: key, startsAt: start, endsAt: end, sessionId });
    const events = [
      ev('soon', '2026-10-29T15:01:00Z', '2026-10-29T15:30:00Z'),
      ev('started', '2026-10-29T14:55:00Z', '2026-10-29T15:30:00Z'),
      ev('late', '2026-10-29T14:40:00Z', '2026-10-29T15:30:00Z'),
      ev('later', '2026-10-29T15:10:00Z', '2026-10-29T15:30:00Z'),
      ev('has-notes', '2026-10-29T15:00:00Z', '2026-10-29T15:30:00Z', 's1'),
      ev('over', '2026-10-29T14:30:00Z', '2026-10-29T14:58:00Z'),
    ];
    expect(dueEvents(events, now, new Set()).map((e) => e.key)).toEqual(['soon', 'started']);
    expect(dueEvents(events, now, new Set(['soon'])).map((e) => e.key)).toEqual(['started']);
    expect(currentEvent(events, now)?.key).toBe('soon');
  });
});

describe('desktop: dictado y textos', () => {
  it('contexto según la app de destino', () => {
    expect(contextForApp('Mail')).toBe('email');
    expect(contextForApp('Slack')).toBe('chat');
    expect(contextForApp('Notion')).toBe('note');
    expect(contextForApp('Figma')).toBe('other');
    expect(contextForApp('')).toBe('other');
  });

  it('multipart con campos y archivo', () => {
    const { body, contentType } = multipartBody({ context: 'chat', sourceApp: 'Slack "x"\r\n' }, { field: 'audio', name: 'd.webm', type: 'audio/webm', data: new Uint8Array([1, 2, 3]) });
    const boundary = contentType.split('boundary=')[1];
    const text = body.toString('latin1');
    expect(text.startsWith(`--${boundary}\r\n`)).toBe(true);
    expect(text).toContain('name="context"\r\n\r\nchat\r\n');
    expect(text).toContain('filename="d.webm"\r\nContent-Type: audio/webm\r\n\r\n\u0001\u0002\u0003\r\n');
    expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true);
  });

  it('los tres idiomas tienen las mismas claves', () => {
    expect(pickLocale('es-AR')).toBe('es');
    expect(pickLocale('pt-BR')).toBe('pt');
    expect(pickLocale('fr')).toBe('en');
    const keys = Object.keys(strings('en')).sort();
    expect(Object.keys(strings('es')).sort()).toEqual(keys);
    expect(Object.keys(strings('pt')).sort()).toEqual(keys);
    expect(fill(strings('es').dictateHint, { key: 'Control + Option' })).toBe('Dictar: mantené Control + Option');
    for (const l of ['en', 'es', 'pt'] as const) for (const v of Object.values(strings(l))) expect(v).not.toMatch(/—/);
  });
});

describe('desktop: grabar sola solo con un nonce de la app', () => {
  it('ningún path de la app conserva autostart (links, deep links, avisos del servidor)', () => {
    expect(safeAppPath('/app/voice?new=1&autostart=desktop')).toBe('/app/voice?new=1');
    expect(safeAppPath('/es/app/voice?event=cal%3A1&autostart=AAAAAAAAAAAAAAAAAAAAAAAA#x')).toBe('/es/app/voice?event=cal%3A1#x');
    expect(parseDeepLink('zerosoft://open?path=/app/voice?new=1%26autostart=desktop')).toEqual({ kind: 'open', path: '/app/voice?new=1' });
    expect(parseDeepLink('zerosoft://open/app/voice?autostart=desktop')).toEqual({ kind: 'open', path: '/app/voice' });
  });

  it('el nonce vale una vez y por 2 minutos; uno inventado no vale', () => {
    const store = new NonceStore();
    const n = 'n'.repeat(32);
    store.add(n, 1000);
    expect(store.consume('x'.repeat(32), 1000)).toBe(false);
    expect(store.consume('desktop', 1000)).toBe(false);
    expect(store.consume(n, 1000 + 60_000)).toBe(true);
    expect(store.consume(n, 1000 + 60_000)).toBe(false);
    const old = 'o'.repeat(32);
    store.add(old, 0);
    expect(store.consume(old, 2 * 60_000 + 1)).toBe(false);
    expect(store.consume(42, 0)).toBe(false);
  });
});

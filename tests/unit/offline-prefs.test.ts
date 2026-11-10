import { readFileSync } from 'fs';
import path from 'path';
import vm from 'vm';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OFFLINE_PREFS,
  OFFLINE_LIMITS,
  offlineAllows,
  offlineAppOf,
  offlineEvictions,
  offlineUsage,
  parseOfflinePrefs,
  type OfflineEntry,
} from '@/lib/offline-prefs';
import { compareVersions, desktopUpdateKind } from '@/lib/desktop-version';

type Sw = {
  parseOfflinePrefs: typeof parseOfflinePrefs;
  offlineAppOf: typeof offlineAppOf;
  offlineAllows: typeof offlineAllows;
  offlineEvictions: typeof offlineEvictions;
  OFFLINE_LIMITS: typeof OFFLINE_LIMITS;
  DEFAULT_PREFS: typeof DEFAULT_OFFLINE_PREFS;
  setPrefs: (raw: unknown) => Promise<void>;
  getPrefs: () => Promise<typeof DEFAULT_OFFLINE_PREFS>;
};

function memoryCaches() {
  const all = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!all.has(name)) all.set(name, new Map());
    const c = all.get(name)!;
    return {
      put: async (k: string | Request, r: Response) => void c.set(typeof k === 'string' ? k : k.url, r),
      match: async (k: string | Request) => c.get(typeof k === 'string' ? k : k.url)?.clone(),
      delete: async (k: string | Request) => c.delete(typeof k === 'string' ? k : k.url),
      keys: async () => [...c.keys()].map((url) => ({ url })),
    };
  };
  return { all, api: { open, keys: async () => [...all.keys()], delete: async (k: string) => all.delete(k) } };
}

function loadSw() {
  const code = readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
  const caches = memoryCaches();
  const self: Record<string, unknown> = { addEventListener: () => undefined, location: { origin: 'https://app.test' } };
  vm.runInNewContext(code, { self, URL, Response, console, caches: caches.api });
  return { sw: self.__zsOffline as Sw, caches };
}

const entry = (url: string, app: OfflineEntry['app'], mb: number, daysAgo: number, now: number): OfflineEntry => ({ url, app, bytes: mb * 1024 * 1024, at: now - daysAgo * 86_400_000 });

describe('modo sin conexión: ajustes', () => {
  it('por defecto: prendido, todas las apps, Normal y 30 días; lo inválido vuelve al default', () => {
    expect(parseOfflinePrefs(null)).toEqual(DEFAULT_OFFLINE_PREFS);
    expect(parseOfflinePrefs({ enabled: 'no', size: 'huge', days: 12, apps: { crm: false, evil: true } })).toEqual({
      ...DEFAULT_OFFLINE_PREFS,
      apps: { ...DEFAULT_OFFLINE_PREFS.apps, crm: false },
    });
    expect(OFFLINE_LIMITS.light.mb).toBe(50);
  });

  it('cada ruta guardada es de una app; apagado o la app afuera, no se guarda', () => {
    expect(offlineAppOf('/es/app')).toBe('crm');
    expect(offlineAppOf('/app/crm/contacts/1')).toBe('crm');
    expect(offlineAppOf('/api/crm/deals')).toBe('crm');
    expect(offlineAppOf('/en/app/docs/p1')).toBe('docs');
    expect(offlineAppOf('/app/track/issue/ZS-1/x')).toBe('track');
    expect(offlineAppOf('/pt/app/notes')).toBe('notes');
    expect(offlineAppOf('/app/notes/abc')).toBeNull();
    expect(offlineAppOf('/app/chat')).toBeNull();
    const prefs = parseOfflinePrefs({ apps: { docs: false } });
    expect(offlineAllows(prefs, '/en/app/docs/p1')).toBe(false);
    expect(offlineAllows(prefs, '/en/app/track')).toBe(true);
    expect(offlineAllows({ ...prefs, enabled: false }, '/en/app/track')).toBe(false);
  });

  it('recorte: lo vencido sale; después lo más viejo hasta entrar en vistas y megas', () => {
    const now = Date.now();
    const light = parseOfflinePrefs({ size: 'light', days: 7 });
    const entries = [
      entry('old', 'crm', 1, 10, now),
      entry('a', 'docs', 20, 3, now),
      entry('b', 'track', 20, 2, now),
      entry('s', 'static', 15, 2, now),
      entry('c', 'crm', 5, 1, now),
    ];
    // 50 MB: "old" vencido; quedan 60 MB → sale "a" (el más viejo), quedan 40.
    expect(offlineEvictions(entries, light, now)).toEqual(['old', 'a']);
    const many = Array.from({ length: 65 }, (_, i) => entry(`p${i}`, 'crm', 0.01, 1 - i / 100, now));
    expect(offlineEvictions(many, light, now)).toHaveLength(5);
    const usage = offlineUsage(entries);
    expect(usage.docs).toEqual({ pages: 1, bytes: 20 * 1024 * 1024 });
    expect(usage.static.pages).toBe(1);
  });

  it('el service worker usa las mismas reglas', () => {
    const { sw } = loadSw();
    const now = Date.now();
    const prefs = parseOfflinePrefs({ size: 'light', days: 7 });
    const entries = [entry('old', 'crm', 1, 10, now), entry('a', 'docs', 30, 3, now), entry('b', 'track', 30, 2, now)];
    expect(sw.offlineEvictions(entries, prefs, now)).toEqual(offlineEvictions(entries, prefs, now));
    expect(sw.parseOfflinePrefs({ enabled: false, apps: { notes: false } })).toEqual(parseOfflinePrefs({ enabled: false, apps: { notes: false } }));
    for (const p of ['/es/app', '/app/crm/x', '/app/docs/a', '/app/track', '/app/notes', '/app/notes/x', '/app/chat']) expect(sw.offlineAppOf(p), p).toBe(offlineAppOf(p));
    expect(sw.OFFLINE_LIMITS).toEqual(OFFLINE_LIMITS);
    expect(sw.DEFAULT_PREFS).toEqual(DEFAULT_OFFLINE_PREFS);
  });

  it('apagarlo borra las vistas y los archivos guardados, nunca la cola', async () => {
    const { sw, caches } = loadSw();
    const pages = await caches.api.open('zs-app-v7-pages-olivia');
    await pages.put('https://app.test/es/app/crm', new Response('x'));
    const statics = await caches.api.open('zs-app-v7-static');
    await statics.put('https://app.test/_next/static/a.js', new Response('y'));
    await sw.setPrefs({ enabled: false });
    expect((await sw.getPrefs()).enabled).toBe(false);
    const names = [...caches.all.keys()];
    expect(names.some((n) => n.includes('-pages'))).toBe(false);
    expect(names).not.toContain('zs-app-v7-static');
    // Los ajustes quedan guardados en META para el próximo arranque del worker.
    expect(names.some((n) => n.endsWith('-meta'))).toBe(true);
  });
});

describe('versiones del escritorio', () => {
  it('compara X.Y.Z y dice si se actualiza sola o hay que bajarla', () => {
    expect(compareVersions('0.3.2', '0.3.10')).toBe(-1);
    expect(compareVersions('v1.0.0', '0.9.9')).toBe(1);
    expect(desktopUpdateKind('0.3.2', '0.3.2')).toBe('none');
    expect(desktopUpdateKind('0.3.2', '0.3.1')).toBe('none');
    expect(desktopUpdateKind('0.3.1', '0.3.2')).toBe('auto');
    expect(desktopUpdateKind('0.2.1', '0.3.2')).toBe('manual');
    expect(desktopUpdateKind('raro', '0.3.2')).toBe('manual');
    expect(desktopUpdateKind('0.3.1', 'nope')).toBe('none');
  });
});

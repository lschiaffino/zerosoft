import { readFileSync } from 'fs';
import path from 'path';
import vm from 'vm';
import { describe, expect, it } from 'vitest';
import { OFFLINE_PRODUCTS, OFFLINE_ROOTS_EVERY_MS, offlineRoots, rootsDue, worksOffline } from '@/lib/offline-apps';
import { PRODUCT_CONFIG } from '@/lib/products';

type Prefs = { enabled: boolean; apps: Record<string, boolean> };
type SwApi = {
  offlineHtml: (locale: string, kind: string, appName: string | null, prefs?: Prefs) => string;
  appNameOf: (pathname: string) => string | null;
  localeOf: (pathname: string) => string;
  staticUrlsIn: (html: string) => string[];
  isOfflineNavigation: (url: URL) => boolean;
  APP_ANY: RegExp;
  OFFLINE_PRODUCTS: Array<[string, string, string]>;
};

function loadServiceWorker(language = 'en-US'): SwApi {
  const code = readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
  const self: Record<string, unknown> = {
    addEventListener: () => undefined,
    location: { origin: 'https://app.test' },
    navigator: { language },
  };
  vm.runInNewContext(code, { self, URL, Response, console });
  return self.__zsOffline as SwApi;
}

const sw = loadServiceWorker();

describe('apps sin conexión', () => {
  it('el worker y la app tienen la misma lista, con el mismo inicio', () => {
    expect(sw.OFFLINE_PRODUCTS.map(([k]) => k)).toEqual([...OFFLINE_PRODUCTS]);
    for (const [key, name, launch] of sw.OFFLINE_PRODUCTS) {
      const cfg = PRODUCT_CONFIG[key as keyof typeof PRODUCT_CONFIG];
      expect(cfg.name).toBe(name);
      expect(cfg.launch).toBe(launch);
    }
  });

  it('cada inicio de una app sin conexión es una vista que el worker guarda', () => {
    for (const p of offlineRoots('es')) expect(sw.isOfflineNavigation(new URL(p, 'https://app.test'))).toBe(true);
  });

  it('worksOffline', () => {
    expect(worksOffline('docs')).toBe(true);
    expect(worksOffline('track')).toBe(true);
    expect(worksOffline('groups')).toBe(false);
    expect(worksOffline('talk')).toBe(false);
    expect(worksOffline(null)).toBe(false);
  });
});

describe('página sin red', () => {
  it('una app que necesita conexión lo dice con su nombre y lleva a las que andan sin red', () => {
    const html = sw.offlineHtml('es', 'online-only', 'Lines');
    expect(html).toContain('Lines necesita conexión');
    expect(html).toContain('lang="es"');
    for (const [key, , launch] of sw.OFFLINE_PRODUCTS) expect(html).toContain(`href="/es${launch}" data-app="${key}"`);
    // Se recarga sola al volver la red.
    expect(html).toContain("addEventListener('online'");
  });

  it('solo ofrece las apps prendidas en Ajustes › Sin conexión', () => {
    const html = sw.offlineHtml('en', 'online-only', 'Talk', { enabled: true, apps: { docs: true, notes: false, track: true, crm: false } });
    expect(html).toContain('data-app="docs"');
    expect(html).toContain('data-app="track"');
    expect(html).not.toContain('data-app="notes"');
    expect(html).not.toContain('data-app="crm"');
    const off = sw.offlineHtml('en', 'online-only', 'Talk', { enabled: false, apps: { docs: true, notes: true, track: true, crm: true } });
    expect(off).not.toContain('data-app=');
  });

  it('una vista que nunca se abrió en el dispositivo; un idioma que no existe va en inglés', () => {
    expect(sw.offlineHtml('pt', 'not-cached', null)).toContain('ainda não foi aberta');
    expect(sw.offlineHtml('fr', 'not-cached', null)).toContain('lang="en"');
  });

  it('el nombre de la app va escapado', () => {
    expect(sw.offlineHtml('en', 'online-only', '<b>x</b>')).toContain('&lt;b&gt;x&lt;/b&gt; needs a connection');
  });

  it('nombre de la app y locale de la ruta', () => {
    expect(sw.appNameOf('/en/app/lines/inbox')).toBe('Lines');
    expect(sw.appNameOf('/app/calendar')).toBe('Cal');
    expect(sw.appNameOf('/es/app/settings/offline')).toBeNull();
    expect(sw.appNameOf('/es/app/nada')).toBeNull();
    expect(sw.localeOf('/pt/app/talk')).toBe('pt');
    expect(sw.localeOf('/app/talk')).toBe('en');
    expect(loadServiceWorker('es-AR').localeOf('/app/talk')).toBe('es');
  });

  it('APP_ANY: toda la app y nada del sitio público', () => {
    for (const p of ['/en/app', '/en/app/talk', '/app/lines/inbox', '/es/app/settings']) expect(sw.APP_ANY.test(p)).toBe(true);
    for (const p of ['/', '/en', '/en/pricing', '/en/apps', '/api/app/x', '/en/application']) expect(sw.APP_ANY.test(p)).toBe(false);
  });
});

describe('archivos de una vista', () => {
  it('saca los /_next/static de un HTML, sin repetir', () => {
    const html = `<link rel="stylesheet" href="/_next/static/css/a1.css"><script src="/_next/static/chunks/app/page-9f.js" async=""></script>
      <script>self.__next_f.push([1,"0:[\\"/_next/static/chunks/12-ab.js\\"]"])</script><script src="/_next/static/chunks/app/page-9f.js"></script>`;
    expect(sw.staticUrlsIn(html).sort()).toEqual(['/_next/static/chunks/12-ab.js', '/_next/static/chunks/app/page-9f.js', '/_next/static/css/a1.css']);
    expect(sw.staticUrlsIn('')).toEqual([]);
  });
});

describe('rootsDue', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it('devuelve los inicios una vez cada 6 horas por persona', () => {
    const s = mem();
    const first = rootsDue(s, 'u:w', 'en', 'https://app.test', 1_000_000);
    expect(first).toEqual(['https://app.test/en/app', 'https://app.test/en/app/docs', 'https://app.test/en/app/notes', 'https://app.test/en/app/track', 'https://app.test/en/app/crm']);
    expect(rootsDue(s, 'u:w', 'en', 'https://app.test', 1_000_000 + 1000)).toEqual([]);
    expect(rootsDue(s, 'otra:w', 'en', 'https://app.test', 1_000_000 + 1000)).toHaveLength(5);
    expect(rootsDue(s, 'u:w', 'en', 'https://app.test', 1_000_000 + OFFLINE_ROOTS_EVERY_MS)).toHaveLength(5);
  });

  it('en un navegador automatizado solo si el test lo pide; sin storage ni persona, nada', () => {
    const s = mem();
    expect(rootsDue(s, 'u:w', 'en', 'https://app.test', 1, true)).toEqual([]);
    s.setItem('zs-e2e-warm-roots', '1');
    expect(rootsDue(s, 'u:w', 'en', 'https://app.test', 1, true)).toHaveLength(5);
    expect(rootsDue(null, 'u:w', 'en', 'https://app.test', 1)).toEqual([]);
    expect(rootsDue(mem(), '', 'en', 'https://app.test', 1)).toEqual([]);
  });
});

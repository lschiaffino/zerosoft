/**
 * Ajustes del modo sin conexión de este dispositivo (Ajustes › Sin conexión).
 * Se guardan en el navegador (localStorage) y se le mandan al service worker
 * (public/sw.js, mensaje zs-offline-prefs), que los guarda en su caché META
 * y los aplica: qué apps guarda, cuánto (vistas y megas) y por cuánto tiempo.
 * public/sw.js repite estas reglas (sin build); tests/unit/offline-prefs.test.ts
 * compara las dos.
 */
export const OFFLINE_APPS = ['crm', 'docs', 'track', 'notes'] as const;
export type OfflineApp = (typeof OFFLINE_APPS)[number];

export const OFFLINE_SIZES = ['light', 'normal', 'max'] as const;
export type OfflineSize = (typeof OFFLINE_SIZES)[number];

export const OFFLINE_DAYS = [7, 30, 90] as const;
export type OfflineDays = (typeof OFFLINE_DAYS)[number];

/** Topes por tamaño: vistas guardadas y megas (páginas más archivos de la app). */
export const OFFLINE_LIMITS: Record<OfflineSize, { pages: number; mb: number }> = {
  light: { pages: 60, mb: 50 },
  normal: { pages: 300, mb: 200 },
  max: { pages: 1000, mb: 1024 },
};

export interface OfflinePrefs {
  enabled: boolean;
  apps: Record<OfflineApp, boolean>;
  size: OfflineSize;
  days: OfflineDays;
}

export const DEFAULT_OFFLINE_PREFS: OfflinePrefs = {
  enabled: true,
  apps: { crm: true, docs: true, track: true, notes: true },
  size: 'normal',
  days: 30,
};

export const OFFLINE_PREFS_KEY = 'zs-offline-prefs';

/** Lo guardado (o lo que llega por mensaje) → ajustes válidos; lo que no se entiende queda en el default. */
export function parseOfflinePrefs(raw: unknown): OfflinePrefs {
  const d = DEFAULT_OFFLINE_PREFS;
  if (!raw || typeof raw !== 'object') return { ...d, apps: { ...d.apps } };
  const r = raw as Record<string, unknown>;
  const apps = { ...d.apps };
  if (r.apps && typeof r.apps === 'object') {
    for (const a of OFFLINE_APPS) {
      const v = (r.apps as Record<string, unknown>)[a];
      if (typeof v === 'boolean') apps[a] = v;
    }
  }
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    apps,
    size: (OFFLINE_SIZES as readonly string[]).includes(r.size as string) ? (r.size as OfflineSize) : d.size,
    days: (OFFLINE_DAYS as readonly number[]).includes(r.days as number) ? (r.days as OfflineDays) : d.days,
  };
}

/** De qué app es una ruta guardada (con o sin locale); null si no se guarda. El inicio (/app) va con el CRM. */
export function offlineAppOf(pathname: string): OfflineApp | null {
  const p = pathname.replace(/^\/(en|es|pt)(?=\/)/, '');
  if (/^\/app\/notes\/?$/.test(p)) return 'notes';
  if (/^\/app\/?$/.test(p) || /^\/app\/crm(\/|$)/.test(p) || /^\/api\/crm\//.test(p)) return 'crm';
  if (/^\/app\/docs(\/|$)/.test(p)) return 'docs';
  if (/^\/app\/track(\/|$)/.test(p)) return 'track';
  return null;
}

/** ¿Se guarda (y se sirve sin red) esta ruta con estos ajustes? */
export function offlineAllows(prefs: OfflinePrefs, pathname: string): boolean {
  if (!prefs.enabled) return false;
  const app = offlineAppOf(pathname);
  return app !== null && prefs.apps[app];
}

export interface OfflineEntry {
  url: string;
  app: OfflineApp | 'static';
  bytes: number;
  at: number;
}

/**
 * Qué borrar para respetar los topes: primero lo vencido (más viejo que
 * `days`), después lo más viejo hasta quedar bajo las vistas y los megas.
 * Los archivos de la app (static) cuentan para los megas pero no como vistas.
 */
export function offlineEvictions(entries: readonly OfflineEntry[], prefs: OfflinePrefs, now: number): string[] {
  const limit = OFFLINE_LIMITS[prefs.size];
  const maxAge = prefs.days * 86_400_000;
  const out = new Set<string>();
  const live = [...entries].sort((a, b) => a.at - b.at).filter((e) => {
    if (now - e.at > maxAge) {
      out.add(e.url);
      return false;
    }
    return true;
  });
  let pages = live.filter((e) => e.app !== 'static').length;
  let bytes = live.reduce((n, e) => n + e.bytes, 0);
  const cap = limit.mb * 1024 * 1024;
  for (const e of live) {
    if (pages <= limit.pages && bytes <= cap) break;
    if (e.app === 'static' && bytes <= cap) continue;
    out.add(e.url);
    bytes -= e.bytes;
    if (e.app !== 'static') pages -= 1;
  }
  return [...out];
}

/** Uso por app a partir del índice del worker. */
export function offlineUsage(entries: readonly OfflineEntry[]): Record<OfflineApp | 'static', { pages: number; bytes: number }> {
  const out = { crm: { pages: 0, bytes: 0 }, docs: { pages: 0, bytes: 0 }, track: { pages: 0, bytes: 0 }, notes: { pages: 0, bytes: 0 }, static: { pages: 0, bytes: 0 } };
  for (const e of entries) {
    out[e.app].pages += 1;
    out[e.app].bytes += e.bytes;
  }
  return out;
}

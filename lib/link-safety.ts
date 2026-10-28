/**
 * Protección contra abuso de Link: un acortador es el envoltorio favorito
 * del phishing y el malware. Cada destino nuevo (y cada variante de la
 * segmentación) se revisa al crear o editar el link, y el cron vuelve a
 * revisar los destinos cada semana (una URL limpia hoy puede estar
 * comprometida mañana). Un link bloqueado no redirige: muestra un aviso.
 *
 * Reglas locales (sin red): credenciales en la URL (https://banco.com@otro.com,
 * el truco clásico para disfrazar el host) y dominios bloqueados por la
 * instancia (LINK_BLOCKED_DOMAINS, separados por coma; cubre subdominios).
 * Con GOOGLE_SAFE_BROWSING_KEY se consulta la Lookup API v4 de Google Safe
 * Browsing (malware, phishing, software no deseado). LINK_SAFETY_FAKE=1
 * (tests) no sale a internet: marca las URLs de prueba oficiales de Google.
 * Si la API no responde, el link se crea igual y el cron lo revisa después.
 * Server-only.
 */
import { getDb } from './db';

export type SafetyReason = 'phishing' | 'malware' | 'unwanted' | 'blocked_domain' | 'credentials';

export const SAFETY_REASONS: readonly SafetyReason[] = ['phishing', 'malware', 'unwanted', 'blocked_domain', 'credentials'];

/** Resultado por URL: null = limpia, una razón = bloqueada, 'unknown' = no se pudo revisar. */
export type SafetyResult = SafetyReason | null | 'unknown';

const SAFE_BROWSING_URL = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';
/** La Lookup API acepta hasta 500 URLs por consulta. */
export const SAFE_BROWSING_BATCH = 500;
const TIMEOUT_MS = 2500;

function fakeMode(): boolean {
  return process.env.LINK_SAFETY_FAKE === '1' && process.env.VERCEL_ENV !== 'production';
}

/** Revisión remota disponible (Safe Browsing o su fake de tests). */
export function remoteSafetyEnabled(): boolean {
  return fakeMode() || Boolean(process.env.GOOGLE_SAFE_BROWSING_KEY);
}

function blockedDomains(): string[] {
  return (process.env.LINK_BLOCKED_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^\*\./, '').replace(/^www\./, ''))
    .filter(Boolean);
}

/** Reglas locales (puras): credenciales en la URL o dominio bloqueado por la instancia. */
export function localSafetyCheck(raw: string, blocked: string[] = blockedDomains()): SafetyReason | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.username || u.password) return 'credentials';
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (blocked.some((d) => host === d || host.endsWith(`.${d}`))) return 'blocked_domain';
  return null;
}

/** URLs de prueba oficiales de Google Safe Browsing (las marca también la API real). */
const FAKE_THREATS: Array<[RegExp, SafetyReason]> = [
  [/^https?:\/\/testsafebrowsing\.appspot\.com\/s\/phishing/i, 'phishing'],
  [/^https?:\/\/testsafebrowsing\.appspot\.com\/s\/malware/i, 'malware'],
  [/^https?:\/\/testsafebrowsing\.appspot\.com\/s\/unwanted/i, 'unwanted'],
  [/^https?:\/\/malware\.testing\.google\.test\//i, 'malware'],
];

function reasonOfThreat(type: string): SafetyReason {
  if (type === 'SOCIAL_ENGINEERING') return 'phishing';
  if (type === 'UNWANTED_SOFTWARE' || type === 'POTENTIALLY_HARMFUL_APPLICATION') return 'unwanted';
  return 'malware';
}

/** Consulta Safe Browsing para hasta 500 URLs. null = no se pudo consultar. */
async function safeBrowsingLookup(urls: string[]): Promise<Map<string, SafetyReason> | null> {
  const out = new Map<string, SafetyReason>();
  if (fakeMode()) {
    for (const url of urls) {
      const hit = FAKE_THREATS.find(([re]) => re.test(url));
      if (hit) out.set(url, hit[1]);
    }
    return out;
  }
  const key = process.env.GOOGLE_SAFE_BROWSING_KEY;
  if (!key) return out;
  try {
    // Host fijo de Google (no es una URL del usuario): fetch directo, con timeout corto.
    const res = await fetch(`${SAFE_BROWSING_URL}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        client: { clientId: 'zerosoft-link', clientVersion: '1.0' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: urls.map((url) => ({ url })),
        },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { matches?: Array<{ threatType?: string; threat?: { url?: string } }> } | null;
    for (const m of data?.matches ?? []) {
      const url = m.threat?.url;
      if (url && !out.has(url)) out.set(url, reasonOfThreat(String(m.threatType ?? '')));
    }
    return out;
  } catch {
    return null;
  }
}

/** Revisa varias URLs: reglas locales y, si está configurado, Safe Browsing. */
export async function checkUrlsSafety(urls: string[]): Promise<Map<string, SafetyResult>> {
  const unique = [...new Set(urls.filter(Boolean))];
  const result = new Map<string, SafetyResult>();
  const remote: string[] = [];
  for (const url of unique) {
    const local = localSafetyCheck(url);
    if (local) result.set(url, local);
    else remote.push(url);
  }
  if (!remoteSafetyEnabled()) {
    for (const url of remote) result.set(url, null);
    return result;
  }
  for (let i = 0; i < remote.length; i += SAFE_BROWSING_BATCH) {
    const batch = remote.slice(i, i + SAFE_BROWSING_BATCH);
    const hits = await safeBrowsingLookup(batch);
    for (const url of batch) result.set(url, hits === null ? 'unknown' : (hits.get(url) ?? null));
  }
  return result;
}

/** Primera razón de bloqueo entre las URLs (null = todas limpias o sin revisar). */
export async function firstUnsafe(urls: string[]): Promise<{ reason: SafetyReason | null; checked: boolean }> {
  const res = await checkUrlsSafety(urls);
  let checked = true;
  for (const v of res.values()) {
    if (v === 'unknown') checked = false;
    else if (v) return { reason: v, checked: true };
  }
  return { reason: null, checked };
}

/** Solo las reglas locales (altas masivas e importaciones: Safe Browsing lo hace el cron en lotes de 500). */
export function firstLocalUnsafe(urls: string[]): SafetyReason | null {
  const blocked = blockedDomains();
  for (const url of urls) {
    const r = localSafetyCheck(url, blocked);
    if (r) return r;
  }
  return null;
}

/** Cada cuánto se vuelve a revisar un destino limpio. */
const RECHECK_DAYS = 7;

/**
 * Revisión periódica (cron): los links activos con la revisión más vieja (o
 * sin revisar), hasta `limit`. Los que ahora aparecen como peligrosos quedan
 * bloqueados y el registro de actividad lo anota. Claim por fila: cada link
 * se marca revisado antes de consultar, así dos corridas no lo repiten.
 */
export async function recheckLinkSafety(opts: { limit?: number } = {}): Promise<{ checked: number; blocked: number }> {
  if (!remoteSafetyEnabled() && blockedDomains().length === 0) return { checked: 0, blocked: 0 };
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
  const due = (await db
    .prepare(
      `SELECT id, user_id, slug, url, targeting, safety_checked_at FROM links
       WHERE archived = 0 AND safety IS NULL
         AND (safety_checked_at IS NULL OR safety_checked_at < datetime('now', ?))
       ORDER BY safety_checked_at IS NOT NULL, safety_checked_at ASC LIMIT ?`,
    )
    .all(`-${RECHECK_DAYS} days`, limit)) as Array<{
    id: string;
    user_id: string;
    slug: string;
    url: string;
    targeting: string | null;
    safety_checked_at: string | null;
  }>;
  const claimed: typeof due = [];
  for (const row of due) {
    const r = await db
      .prepare(
        `UPDATE links SET safety_checked_at = datetime('now')
         WHERE id = ? AND safety IS NULL AND COALESCE(safety_checked_at, '') = COALESCE(?, '')`,
      )
      .run(row.id, row.safety_checked_at);
    if (r.changes === 1) claimed.push(row);
  }
  if (claimed.length === 0) return { checked: 0, blocked: 0 };
  const { parseTargeting, targetingDestinations } = await import('./link-targeting');
  const urlsOf = (row: (typeof claimed)[number]) => {
    const t = parseTargeting(row.targeting);
    return [row.url, ...(t ? targetingDestinations(t) : [])];
  };
  const results = await checkUrlsSafety(claimed.flatMap(urlsOf));
  let blocked = 0;
  const { logLinkActivity } = await import('./link-activity');
  for (const row of claimed) {
    const urls = urlsOf(row);
    if (urls.some((u) => results.get(u) === 'unknown')) {
      // Sin respuesta de la API: se reintenta en la próxima corrida.
      await db.prepare('UPDATE links SET safety_checked_at = NULL WHERE id = ? AND safety IS NULL').run(row.id);
      continue;
    }
    const reason = urls.map((u) => results.get(u)).find((v): v is SafetyReason => typeof v === 'string');
    if (!reason) continue;
    await db.prepare(`UPDATE links SET safety = 'blocked', safety_reason = ? WHERE id = ?`).run(reason, row.id);
    await logLinkActivity({ userId: row.user_id, linkId: row.id, slug: row.slug, actorId: null, via: 'system', action: 'blocked', changes: { reason } });
    blocked++;
  }
  return { checked: claimed.length, blocked };
}

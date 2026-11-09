/**
 * Lista de espera de las apps "Próximamente" (lib/products.ts). Una fila por
 * app y email (UNIQUE): sumarse dos veces no duplica ni manda dos emails.
 *
 * - Desde la app es un clic (el email de la sesión); desde el sitio, un
 *   formulario con email. "¿Para qué la usarías?" es opcional.
 * - Al sumarse llega un email de confirmación en el idioma de la persona.
 * - Aviso de salida: cuando una app deja de estar en Próximamente (se borra
 *   `status` en PRODUCT_CONFIG), el cron de cada hora le escribe a su lista
 *   (notifyLiveApps), reclamando cada fila con notified_at para no avisar dos veces.
 * - El staff ve los números por app y baja el CSV en Ajustes › Admin.
 */
import { getDb, type Db } from './db';
import { appSender, escapeHtml, renderBrandedHtml, sendEmail } from './email';
import { isComingSoon, PRODUCT_CONFIG, PRODUCT_KEYS, type ProductKey } from './products';
import { siteOrigin } from './seo';

export type WaitlistLang = 'en' | 'es' | 'pt';
export const WAITLIST_USE_CASE_MAX = 500;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class WaitlistError extends Error {
  constructor(public code: 'invalid_app' | 'invalid_email') {
    super(code);
  }
}

export function normalizeLang(raw: unknown): WaitlistLang {
  return raw === 'es' || raw === 'pt' ? raw : 'en';
}

export function normalizeEmail(raw: unknown): string | null {
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

/** Texto libre de una línea a varias, sin controles, acotado. */
export function cleanUseCase(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, WAITLIST_USE_CASE_MAX);
}

export interface JoinInput {
  app: string;
  email: unknown;
  userId?: string | null;
  useCase?: unknown;
  locale?: unknown;
  source: 'app' | 'site';
}

/**
 * Suma a la lista. `created` = es nueva (solo entonces sale el email). Si ya
 * estaba, guarda el "para qué" si ahora vino uno.
 */
export async function joinWaitlist(input: JoinInput, db: Db = getDb()): Promise<{ created: boolean; email: string; app: ProductKey }> {
  if (!isComingSoon(input.app)) throw new WaitlistError('invalid_app');
  const email = normalizeEmail(input.email);
  if (!email) throw new WaitlistError('invalid_email');
  const useCase = cleanUseCase(input.useCase);
  const lang = normalizeLang(input.locale);
  const res = await db
    .prepare(
      `INSERT INTO app_waitlist (id, app, email, user_id, use_case, locale, source) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(app, email) DO NOTHING`,
    )
    .run(`wl_${crypto.randomUUID()}`, input.app, email, input.userId ?? null, useCase, lang, input.source);
  // Ya estaba: solo la persona logueada con ese email cambia su "para qué" (desde el sitio, cualquiera escribe cualquier email).
  if (res.changes === 0 && input.userId) {
    await db
      .prepare(
        `UPDATE app_waitlist SET use_case = CASE WHEN ? != '' THEN ? ELSE use_case END, user_id = COALESCE(user_id, ?)
         WHERE app = ? AND email = ?`,
      )
      .run(useCase, useCase, input.userId, input.app, email);
  }
  return { created: res.changes > 0, email, app: input.app as ProductKey };
}

/** Apps de la lista donde ya está ese email (para mostrar "Ya estás en la lista"). */
export async function joinedApps(email: string | null | undefined, db: Db = getDb()): Promise<ProductKey[]> {
  const clean = normalizeEmail(email);
  if (!clean) return [];
  try {
    const rows = (await db.prepare('SELECT app FROM app_waitlist WHERE email = ?').all(clean)) as Array<{ app: string }>;
    return rows.map((r) => r.app).filter((a): a is ProductKey => (PRODUCT_KEYS as string[]).includes(a));
  } catch {
    return [];
  }
}

export interface WaitlistCount {
  app: ProductKey;
  total: number;
  last7: number;
  withUseCase: number;
  notified: number;
}

/** Cuántos por app (todas las que tienen filas y las que están en Próximamente). */
export async function waitlistCounts(db: Db = getDb()): Promise<WaitlistCount[]> {
  const rows = (await db
    .prepare(
      `SELECT app, COUNT(*) AS total,
        SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS last7,
        SUM(CASE WHEN use_case != '' THEN 1 ELSE 0 END) AS with_use_case,
        SUM(CASE WHEN notified_at IS NOT NULL THEN 1 ELSE 0 END) AS notified
       FROM app_waitlist GROUP BY app`,
    )
    .all()) as Array<{ app: string; total: number; last7: number; with_use_case: number; notified: number }>;
  const by = new Map(rows.map((r) => [r.app, r]));
  return PRODUCT_KEYS.filter((k) => isComingSoon(k) || by.has(k)).map((app) => {
    const r = by.get(app);
    return { app, total: Number(r?.total ?? 0), last7: Number(r?.last7 ?? 0), withUseCase: Number(r?.with_use_case ?? 0), notified: Number(r?.notified ?? 0) };
  });
}

export interface WaitlistRow {
  app: string;
  email: string;
  use_case: string;
  locale: string;
  source: string;
  created_at: string;
  notified_at: string | null;
}

export async function waitlistRows(app: ProductKey | null, db: Db = getDb()): Promise<WaitlistRow[]> {
  const sql = `SELECT app, email, use_case, locale, source, created_at, notified_at FROM app_waitlist ${app ? 'WHERE app = ?' : ''} ORDER BY app, created_at`;
  return (await db.prepare(sql).all(...(app ? [app] : []))) as unknown as WaitlistRow[];
}

/** Celda CSV: comillas y, contra fórmulas en planillas, un apóstrofo delante de =, +, - y @. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function waitlistCsv(rows: WaitlistRow[]): string {
  const head = ['app', 'email', 'use_case', 'locale', 'source', 'created_at', 'notified_at'];
  const lines = rows.map((r) => [r.app, r.email, r.use_case, r.locale, r.source, r.created_at, r.notified_at ?? ''].map((v) => csvCell(String(v))).join(','));
  return [head.join(','), ...lines].join('\n') + '\n';
}

// ---------- Emails ----------

const COPY: Record<WaitlistLang, { joinedSubject: string; joinedHeading: string; joinedLines: string[]; liveSubject: string; liveHeading: string; liveLines: string[]; open: string }> = {
  en: {
    joinedSubject: "You're on the {app} waitlist",
    joinedHeading: "You're on the {app} waitlist",
    joinedLines: [
      '{app} is not available yet and has no date.',
      "We'll email you once, the day you can use it. Nothing else goes to this list.",
    ],
    liveSubject: '{app} is ready to use',
    liveHeading: '{app} is ready',
    liveLines: ['You joined the {app} waitlist. You can use it now in your zerosoft workspace.'],
    open: 'Open {app}',
  },
  es: {
    joinedSubject: 'Estás en la lista de espera de {app}',
    joinedHeading: 'Estás en la lista de espera de {app}',
    joinedLines: [
      '{app} todavía no se puede usar y no tiene fecha.',
      'Te escribimos una sola vez, el día que se pueda usar. A esta lista no le mandamos nada más.',
    ],
    liveSubject: '{app} ya se puede usar',
    liveHeading: '{app} ya está disponible',
    liveLines: ['Te sumaste a la lista de espera de {app}. Ya la podés usar en tu workspace de zerosoft.'],
    open: 'Abrir {app}',
  },
  pt: {
    joinedSubject: 'Você está na lista de espera do {app}',
    joinedHeading: 'Você está na lista de espera do {app}',
    joinedLines: [
      'O {app} ainda não pode ser usado e não tem data.',
      'Vamos escrever uma única vez, no dia em que der para usar. Esta lista não recebe mais nada.',
    ],
    liveSubject: 'O {app} já pode ser usado',
    liveHeading: 'O {app} está disponível',
    liveLines: ['Você entrou na lista de espera do {app}. Já dá para usar no seu workspace do zerosoft.'],
    open: 'Abrir {app}',
  },
};

const fill = (s: string, app: string) => s.replace(/\{app\}/g, app);

export async function sendWaitlistJoined(to: string, app: ProductKey, lang: WaitlistLang): Promise<boolean> {
  const c = COPY[lang];
  const name = PRODUCT_CONFIG[app].name;
  const lines = c.joinedLines.map((l) => fill(l, name));
  const res = await sendEmail({
    to,
    from: appSender(),
    subject: fill(c.joinedSubject, name),
    text: [fill(c.joinedHeading, name), '', ...lines].join('\n'),
    html: renderBrandedHtml({ heading: fill(c.joinedHeading, name), paragraphs: lines.map(escapeHtml), eyebrow: `zerosoft · ${name.toLowerCase()}` }),
  });
  return res.ok;
}

async function sendWaitlistLive(to: string, app: ProductKey, lang: WaitlistLang): Promise<boolean> {
  const c = COPY[lang];
  const name = PRODUCT_CONFIG[app].name;
  const url = `${siteOrigin()}/${lang}${PRODUCT_CONFIG[app].launch}`;
  const lines = c.liveLines.map((l) => fill(l, name));
  const res = await sendEmail({
    to,
    from: appSender(),
    subject: fill(c.liveSubject, name),
    text: [fill(c.liveHeading, name), '', ...lines, '', `${fill(c.open, name)}: ${url}`].join('\n'),
    html: renderBrandedHtml({
      heading: fill(c.liveHeading, name),
      paragraphs: [...lines.map(escapeHtml), `<a href="${escapeHtml(url)}">${escapeHtml(fill(c.open, name))}</a>`],
      eyebrow: `zerosoft · ${name.toLowerCase()}`,
    }),
  });
  return res.ok;
}

/**
 * Aviso de salida (corre en /api/cron/tick): a cada persona en la lista de una
 * app que ya no está en Próximamente, un email. Cada fila se reclama con
 * compare-and-set en notified_at (un solo intento por persona).
 */
export async function notifyLiveApps(opts: { limit?: number } = {}, db: Db = getDb()): Promise<{ sent: number; failed: number }> {
  const live = PRODUCT_KEYS.filter((k) => !isComingSoon(k));
  let rows: Array<{ id: string; app: string; email: string; locale: string }>;
  try {
    rows = (await db
      .prepare(
        `SELECT id, app, email, locale FROM app_waitlist WHERE notified_at IS NULL AND app IN (${live.map(() => '?').join(',')}) ORDER BY created_at LIMIT ?`,
      )
      .all(...live, Math.min(Math.max(opts.limit ?? 200, 1), 1000))) as typeof rows;
  } catch {
    return { sent: 0, failed: 0 };
  }
  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    const claim = await db.prepare("UPDATE app_waitlist SET notified_at = datetime('now') WHERE id = ? AND notified_at IS NULL").run(r.id);
    if (claim.changes === 0) continue;
    const ok = await sendWaitlistLive(r.email, r.app as ProductKey, normalizeLang(r.locale)).catch(() => false);
    // Un solo intento por persona: un email que rebota no se reintenta cada hora.
    if (ok) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

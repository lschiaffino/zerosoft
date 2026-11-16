/**
 * Analítica de Rec: lo que se arma con las vistas de un video. Módulo puro
 * (sin base ni headers), lo usan el servidor (lib/rec.ts) y la pestaña
 * Analítica (components/rec/RecInsights.tsx).
 *
 * Privacidad: de cada vista se guarda solo lo aproximado (país, región,
 * ciudad, tipo de dispositivo, navegador, sistema y el dominio de donde vino).
 * Nunca la IP ni el user agent completo. La ciudad y el país salen de los
 * headers de geo de Vercel (lib/rec-view-context.ts).
 */
import { coveredPct, mergeRanges, retentionCurve, type Range } from './rec-schema';

/** Tramos del video para la curva de retención y las re-vistas. */
export const HEAT_BUCKETS = 50;
/** Tope de reproducciones por tramo y por vista (un loop no infla la curva). */
export const MAX_PLAYS_PER_BUCKET = 20;
/** Vistas que se leen enteras (intervalos y tramos); los totales cuentan todas. */
export const INSIGHTS_SAMPLE = 5000;
/** Días del gráfico de vistas: desde la primera vista, entre 7 y 90. */
export const MIN_DAYS = 7;
export const MAX_DAYS = 90;

export type RecDevice = 'desktop' | 'mobile' | 'tablet';

export interface RecViewContext {
  /** ISO 3166-1 alfa-2 en mayúsculas, o ''. */
  country: string;
  /** Subdivisión ISO 3166-2 sin el país ("C", "CA"), o ''. */
  region: string;
  city: string;
  device: RecDevice | '';
  browser: string;
  os: string;
  /** Dominio de donde vino (sin www), o '' si entró directo. */
  referrer: string;
}

export const EMPTY_CONTEXT: RecViewContext = { country: '', region: '', city: '', device: '', browser: '', os: '', referrer: '' };

/** Un dominio de referencia limpio ("mail.google.com"), o '' si no parece uno. */
export function cleanRefHost(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let h = raw.trim().toLowerCase();
  if (!h) return '';
  // Si llega una URL entera, solo el host.
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(h)) {
    try {
      h = new URL(h).hostname;
    } catch {
      return '';
    }
  }
  h = h.replace(/^www\./, '').replace(/\.$/, '');
  if (h.length > 100 || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) return '';
  return h;
}

/** Bandera emoji de un código de país ("AR" → 🇦🇷); '' si no es un código. */
export function flagEmoji(code: string | null | undefined): string {
  const cc = (code ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc) || cc === 'XX' || cc === 'T1') return '';
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/**
 * Segundos reproducidos por tramo en una vista, saneados: `HEAT_BUCKETS`
 * números finitos entre 0 y el tope (largo del tramo × MAX_PLAYS_PER_BUCKET).
 */
export function cleanHeat(raw: unknown, duration: number): number[] | null {
  if (!Array.isArray(raw) || raw.length !== HEAT_BUCKETS) return null;
  const cap = duration > 0 ? (duration / HEAT_BUCKETS) * MAX_PLAYS_PER_BUCKET : 0;
  return raw.map((x) => {
    const n = Number(x);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(Math.min(n, cap) * 10) / 10;
  });
}

/** Los pings mandan el acumulado de la vista: se queda el mayor de cada tramo. */
export function mergeHeat(prev: number[] | null, next: number[] | null): number[] | null {
  if (!next) return prev;
  if (!prev || prev.length !== next.length) return next;
  return next.map((x, i) => Math.max(x, prev[i] ?? 0));
}

/** Reproducciones por tramo de una vista: con su `heat`, o 1 por tramo visto según sus intervalos. */
export function playsOf(heat: number[] | null, ranges: Range[], duration: number): number[] {
  const out = new Array<number>(HEAT_BUCKETS).fill(0);
  if (!(duration > 0)) return out;
  const size = duration / HEAT_BUCKETS;
  if (heat && heat.length === HEAT_BUCKETS) {
    for (let i = 0; i < HEAT_BUCKETS; i++) out[i] = Math.min(MAX_PLAYS_PER_BUCKET, heat[i] / size);
    return out;
  }
  for (let i = 0; i < HEAT_BUCKETS; i++) {
    const mid = (i + 0.5) * size;
    if (ranges.some(([a, b]) => a <= mid && b >= mid)) out[i] = 1;
  }
  return out;
}

/** Una vista como la lee la analítica (la consulta ya resolvió nombre y email). */
export interface RecViewInput {
  viewerKey: string;
  viewerNo: number;
  signedIn: boolean;
  name: string;
  email: string;
  watchedSec: number;
  maxPosition: number;
  durationSec: number;
  ctaClicks: number;
  ranges: Range[];
  heat: number[] | null;
  startedAt: string;
  context: RecViewContext;
}

export interface RecViewerRow extends RecViewContext {
  viewerKey: string;
  /** Orden en que llegó cada espectador al video (1, 2, 3…): "Espectador 3" si no hay nombre. */
  viewerNo: number;
  name: string;
  /** El que dejó en el pedido de email (sin verificar), su link mágico o su cuenta si está invitado. */
  email: string;
  signedIn: boolean;
  views: number;
  watchedSec: number;
  pct: number;
  ctaClicks: number;
  firstAt: string;
  lastAt: string;
}

export interface RecCount {
  name: string;
  count: number;
}

export interface RecDayCount {
  date: string;
  count: number;
}

export interface RecTotals {
  views: number;
  unique: number;
  ctaClicks: number;
  watchSec: number;
}

export interface RecAnalytics extends RecTotals {
  avgPct: number;
  completed: number;
  /** Qué % de los espectadores vio cada tramo (HEAT_BUCKETS tramos). */
  retention: number[];
  /** Reproducciones de cada tramo contando re-vistas (sumadas entre vistas). */
  plays: number[];
  days: RecDayCount[];
  /** Espectadores únicos por país ("AR"), ciudad ("Córdoba|AR"), dispositivo y origen. */
  countries: RecCount[];
  cities: RecCount[];
  devices: RecCount[];
  sources: RecCount[];
  viewers: RecViewerRow[];
  /** Si hay más vistas que INSIGHTS_SAMPLE: cuántas (las más nuevas) se usaron para la curva y la tabla. */
  sampled: number | null;
}

function countBy(rows: RecViewerRow[], key: (r: RecViewerRow) => string, limit: number): RecCount[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  // Lo desconocido va al final aunque empate.
  const special = (n: string) => (n === 'unknown' || n === 'direct' ? 1 : 0);
  const sorted = [...m.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || special(a.name) - special(b.name) || a.name.localeCompare(b.name));
  if (sorted.length <= limit) return sorted;
  const rest = sorted.slice(limit - 1).reduce((s, x) => s + x.count, 0);
  return [...sorted.slice(0, limit - 1), { name: 'other', count: rest }];
}

/**
 * Agrupa las vistas (las más nuevas primero) por espectador y arma la curva,
 * los desgloses y la tabla. El % visto es tiempo distinto reproducido (unión
 * de intervalos, adelantar no cuenta); el lugar y el dispositivo son los de su
 * última vista que los tenga.
 */
export function buildInsights(
  views: RecViewInput[],
  visible: number,
  extra: { totals?: RecTotals; days?: RecDayCount[]; sampled?: number | null } = {},
): RecAnalytics {
  const by = new Map<string, RecViewerRow & { ranges: Range[] }>();
  const plays = new Array<number>(HEAT_BUCKETS).fill(0);
  let ctaClicks = 0;
  let watchSec = 0;
  for (const r of views) {
    const d = r.durationSec > 0 ? r.durationSec : visible;
    const ranges = r.ranges.length ? r.ranges : r.maxPosition > 0 ? ([[0, Math.min(r.maxPosition, r.watchedSec || r.maxPosition)]] as Range[]) : [];
    ctaClicks += r.ctaClicks;
    watchSec += r.watchedSec;
    const p = playsOf(r.heat, ranges, d);
    for (let i = 0; i < HEAT_BUCKETS; i++) plays[i] += p[i];
    const cur = by.get(r.viewerKey);
    if (!cur) {
      by.set(r.viewerKey, {
        ...r.context,
        viewerKey: r.viewerKey,
        viewerNo: r.viewerNo,
        name: r.name,
        email: r.email,
        signedIn: r.signedIn,
        views: 1,
        watchedSec: r.watchedSec,
        pct: 0,
        ctaClicks: r.ctaClicks,
        firstAt: r.startedAt,
        lastAt: r.startedAt,
        ranges: mergeRanges(ranges, d),
      });
      continue;
    }
    cur.views++;
    cur.watchedSec += r.watchedSec;
    cur.ctaClicks += r.ctaClicks;
    cur.ranges = mergeRanges([...cur.ranges, ...ranges], d);
    if (r.startedAt < cur.firstAt) cur.firstAt = r.startedAt;
    if (r.startedAt > cur.lastAt) cur.lastAt = r.startedAt;
    if (!cur.name && r.name) cur.name = r.name;
    if (!cur.email && r.email) cur.email = r.email;
    if (r.signedIn) cur.signedIn = true;
    if ((!cur.viewerNo || (r.viewerNo && r.viewerNo < cur.viewerNo)) && r.viewerNo) cur.viewerNo = r.viewerNo;
    // Vistas viejas (antes de guardar el lugar) no pisan lo que ya hay.
    if (!cur.country && r.context.country) Object.assign(cur, { country: r.context.country, region: r.context.region, city: r.context.city });
    if (!cur.device && r.context.device) Object.assign(cur, { device: r.context.device, browser: r.context.browser, os: r.context.os });
    if (!cur.referrer && r.context.referrer) cur.referrer = r.context.referrer;
  }
  const merged = [...by.values()].map((x) => ({ ...x, pct: coveredPct(x.ranges, visible) }));
  // Sin número guardado (vistas viejas): por orden de llegada, después de los numerados.
  let next = merged.reduce((m, x) => Math.max(m, x.viewerNo || 0), 0);
  [...merged]
    .filter((x) => !x.viewerNo)
    .sort((a, b) => a.firstAt.localeCompare(b.firstAt) || a.viewerKey.localeCompare(b.viewerKey))
    .forEach((x) => {
      x.viewerNo = ++next;
    });
  const pcts = merged.map((x) => x.pct);
  const viewers: RecViewerRow[] = merged.map(({ ranges: _r, ...rest }) => rest).sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.viewerNo - b.viewerNo);
  const totals = extra.totals ?? { views: views.length, unique: viewers.length, ctaClicks, watchSec };
  return {
    ...totals,
    watchSec: Math.round(totals.watchSec),
    avgPct: pcts.length ? Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length) : 0,
    completed: pcts.filter((p) => p >= 95).length,
    retention: retentionCurve(
      merged.map((x) => x.ranges),
      visible,
      HEAT_BUCKETS,
    ),
    plays: plays.map((x) => Math.round(x * 10) / 10),
    days: extra.days ?? [],
    countries: countBy(viewers, (r) => r.country || 'unknown', 8),
    cities: countBy(viewers, (r) => (r.city ? `${r.city}|${r.country}` : 'unknown'), 8),
    devices: countBy(viewers, (r) => r.device || 'unknown', 4),
    sources: countBy(viewers, (r) => r.referrer || 'direct', 8),
    viewers,
    sampled: extra.sampled ?? null,
  };
}

function addDay(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Primer día del gráfico de vistas: la primera vista, sin pasar de MAX_DAYS ni bajar de MIN_DAYS. */
export function daysStart(firstView: string | null, today: string): string {
  const min = addDay(today, -(MAX_DAYS - 1));
  const max = addDay(today, -(MIN_DAYS - 1));
  const first = firstView ? firstView.slice(0, 10) : max;
  return first < min ? min : first > max ? max : first;
}

/** Completa con ceros los días sin vistas, de `start` a `end` inclusive. */
export function fillDays(counts: RecCount[], start: string, end: string): RecDayCount[] {
  const m = new Map(counts.map((c) => [c.name, c.count]));
  const out: RecDayCount[] = [];
  for (let d = start; d <= end && out.length <= MAX_DAYS; d = addDay(d, 1)) out.push({ date: d, count: m.get(d) ?? 0 });
  return out;
}

/** Tramos donde se re-vio bastante (más reproducciones que espectadores, por al menos un 25 %). */
export function rewatchPeaks(retention: number[], plays: number[], unique: number): number[] {
  if (!unique) return [];
  const out: number[] = [];
  for (let i = 0; i < plays.length; i++) {
    const viewers = ((retention[i] ?? 0) / 100) * unique;
    if (plays[i] >= 2 && plays[i] >= viewers * 1.25) out.push(i);
  }
  return out;
}

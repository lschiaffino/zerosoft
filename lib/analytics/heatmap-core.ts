/**
 * Heatmaps, la parte pura: los valores vienen del navegador de cualquiera, así
 * que al leer se recortan a rangos válidos y lo que no tiene sentido se ignora.
 * Clics por celda, elementos más clickeados y hasta dónde llega el scroll.
 */
export const VIEWPORT_BUCKETS = ['desktop', 'tablet', 'mobile'] as const;
export type ViewportBucket = (typeof VIEWPORT_BUCKETS)[number];

export const HEATMAP_LIMITS = {
  /** Eventos que se leen como máximo por consulta (los más nuevos). */
  maxEvents: 20_000,
  maxY: 200_000,
  /** Alto máximo que se dibuja. */
  maxDocHeight: 12_000,
  minViewport: 100,
  maxViewport: 10_000,
  maxPoints: 4000,
  maxElements: 30,
  /** Celda de la grilla: 0,5 % del ancho y 8 px de alto. */
  gridX: 0.005,
  gridY: 8,
} as const;

/** Ancho con el que se muestra la página en cada tamaño. */
export const BUCKET_WIDTH: Record<ViewportBucket, number> = { desktop: 1280, tablet: 820, mobile: 390 };

export function viewportBucket(width: number): ViewportBucket {
  return width < 768 ? 'mobile' : width < 1024 ? 'tablet' : 'desktop';
}

export interface ClickRow {
  x: unknown;
  y: unknown;
  viewport: unknown;
  docHeight: unknown;
  tag: unknown;
  text: unknown;
  href: unknown;
}

export interface LeaveRow {
  viewId: unknown;
  sessionId?: unknown;
  depth: unknown;
  viewport: unknown;
}

export interface HeatPoint {
  x: number;
  y: number;
  n: number;
}

export interface HeatElement {
  tag: string;
  text: string;
  href: string;
  count: number;
}

export interface ClickAggregate {
  total: number;
  ignored: number;
  docHeight: number;
  points: HeatPoint[];
  maxCell: number;
  elements: HeatElement[];
}

const finite = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const short = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';

/** Una fila de clic válida o null. Un valor fuera de rango no se "arregla": se ignora. */
export function cleanClick(r: ClickRow): { x: number; y: number; viewport: number; docHeight: number | null } | null {
  const x = finite(r.x);
  const y = finite(r.y);
  const viewport = finite(r.viewport);
  if (x === null || y === null || viewport === null) return null;
  if (x < 0 || x > 1 || y < 0 || y > HEATMAP_LIMITS.maxY) return null;
  if (viewport < HEATMAP_LIMITS.minViewport || viewport > HEATMAP_LIMITS.maxViewport) return null;
  const dh = finite(r.docHeight);
  return { x, y: Math.round(y), viewport, docHeight: dh !== null && dh > 0 && dh <= HEATMAP_LIMITS.maxY ? Math.round(dh) : null };
}

/** Clics de un tamaño de pantalla: celdas, alto de la página y los elementos más clickeados. */
export function aggregateClicks(rows: readonly ClickRow[], bucket: ViewportBucket): ClickAggregate {
  const cells = new Map<string, HeatPoint>();
  const elements = new Map<string, HeatElement>();
  const heights: number[] = [];
  let total = 0;
  let ignored = 0;
  for (const r of rows) {
    const c = cleanClick(r);
    if (!c) {
      ignored++;
      continue;
    }
    if (viewportBucket(c.viewport) !== bucket) continue;
    total++;
    if (c.docHeight !== null) heights.push(c.docHeight);
    const gx = Math.floor(c.x / HEATMAP_LIMITS.gridX);
    const gy = Math.floor(c.y / HEATMAP_LIMITS.gridY);
    const key = `${gx}:${gy}`;
    const cell = cells.get(key);
    if (cell) cell.n++;
    else cells.set(key, { x: Math.min(1, (gx + 0.5) * HEATMAP_LIMITS.gridX), y: (gy + 0.5) * HEATMAP_LIMITS.gridY, n: 1 });
    const tag = short(r.tag, 30).toLowerCase() || 'unknown';
    const text = short(r.text, 100);
    const href = short(r.href, 300);
    const ek = `${tag}\u0001${text}\u0001${href}`;
    const el = elements.get(ek);
    if (el) el.count++;
    else if (elements.size < 2000) elements.set(ek, { tag, text, href, count: 1 });
  }
  // Mediana del alto: un valor loco de un cliente no estira el dibujo.
  heights.sort((a, b) => a - b);
  const median = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  const lowest = [...cells.values()].reduce((m, p) => Math.max(m, p.y), 0);
  const docHeight = Math.min(HEATMAP_LIMITS.maxDocHeight, Math.max(median, Math.ceil(lowest) + 40, 600));
  const points = [...cells.values()].filter((p) => p.y <= docHeight).sort((a, b) => b.n - a.n).slice(0, HEATMAP_LIMITS.maxPoints);
  return {
    total,
    ignored,
    docHeight,
    points,
    maxCell: points[0]?.n ?? 0,
    elements: [...elements.values()].sort((a, b) => b.count - a.count).slice(0, HEATMAP_LIMITS.maxElements),
  };
}

export interface ScrollStep {
  /** Hasta dónde: 10, 20… 100 (% de la página). */
  depth: number;
  reached: number;
  share: number;
}

/**
 * Por cada vista de página, el mayor scroll reportado (una vista puede mandar
 * más de un $pageleave si la pestaña se oculta y vuelve). "Llegó a N %" cuenta
 * las vistas que alcanzaron al menos esa profundidad.
 */
export function aggregateScroll(rows: readonly LeaveRow[], bucket: ViewportBucket): { views: number; steps: ScrollStep[] } {
  const byView = new Map<string, number>();
  let anon = 0;
  for (const r of rows) {
    const depth = finite(r.depth);
    const viewport = finite(r.viewport);
    if (depth === null || viewport === null || depth < 0 || depth > 100) continue;
    if (viewport < HEATMAP_LIMITS.minViewport || viewport > HEATMAP_LIMITS.maxViewport) continue;
    if (viewportBucket(viewport) !== bucket) continue;
    const id = short(r.viewId, 100) || `anon-${anon++}`;
    byView.set(id, Math.max(byView.get(id) ?? 0, depth));
  }
  const views = byView.size;
  const steps: ScrollStep[] = [];
  for (let depth = 10; depth <= 100; depth += 10) {
    let reached = 0;
    for (const d of byView.values()) if (d >= depth) reached++;
    steps.push({ depth, reached, share: views ? reached / views : 0 });
  }
  return { views, steps };
}

/** La URL a enmarcar: http(s), del dominio permitido si el proyecto tiene lista, y que coincida con la ruta. */
export function frameableUrl(raw: unknown, pathname: string, hostOk: (host: string) => boolean): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > 2000) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    if (u.pathname !== pathname) return null;
    return hostOk(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Inicio de un rango relativo ('-24h', '-7d'…). null si no es un rango válido. */
export function rangeStart(range: string | null | undefined, now: number): number | null {
  const m = /^-(\d{1,3})([hd])$/.exec(range ?? '');
  if (!m) return null;
  return now - Number(m[1]) * (m[2] === 'h' ? 3_600_000 : 86_400_000);
}

/**
 * Design: reglas del export (puro, lo testean los unit tests). El dibujo en
 * canvas está en components/design/exporter.ts.
 */

export type ExportFormat = 'png' | 'jpg' | 'pdf';
export const EXPORT_SCALES = [1, 2, 3] as const;
/** Lado más largo permitido al exportar (px): por encima los navegadores fallan al crear el canvas. */
export const MAX_EXPORT_SIDE = 12_000;

/** Nombre de archivo seguro: "Summer sale" → "summer-sale.png"; con página → "summer-sale-2.png". */
export function exportFileName(name: string, ext: ExportFormat, page: number | null = null): string {
  const base =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'design';
  return `${base}${page ? `-${page}` : ''}.${ext}`;
}

export interface ExportPlan {
  format: ExportFormat;
  pages: number[];
  scale: number;
  transparent: boolean;
  width: number;
  height: number;
}

/**
 * Qué se exporta: páginas (la actual o todas; el PDF siempre las elegidas en
 * un archivo), escala (bajada si el lado más largo pasaría el máximo) y fondo
 * transparente (solo PNG).
 */
export function exportPlan(
  doc: { width: number; height: number; pages: unknown[] },
  opts: { format: ExportFormat; which: 'current' | 'all'; current: number; scale: number; transparent?: boolean },
): ExportPlan {
  const count = doc.pages.length;
  const current = Math.min(Math.max(0, opts.current), count - 1);
  const pages = opts.which === 'all' ? Array.from({ length: count }, (_, i) => i) : [current];
  const wanted = (EXPORT_SCALES as readonly number[]).includes(opts.scale) ? opts.scale : 1;
  const maxScale = MAX_EXPORT_SIDE / Math.max(doc.width, doc.height);
  const scale = Math.max(0.1, Math.min(wanted, maxScale));
  return {
    format: opts.format,
    pages,
    scale,
    transparent: opts.format === 'png' && Boolean(opts.transparent),
    width: Math.round(doc.width * scale),
    height: Math.round(doc.height * scale),
  };
}

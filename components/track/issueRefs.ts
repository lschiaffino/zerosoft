/**
 * Referencias a issues (ZER-12) en textos de Track: se resuelven en lote
 * contra /api/track/refs y se cachean por pestaña. Las usan la lectura
 * (MarkdownView) y el editor visual (chips).
 */
import { glyphColor } from '@/lib/track-color';

export interface RefInfo {
  id: string;
  identifier: string;
  title: string;
  status_name: string | null;
  status_color: string | null;
  status_category: string | null;
  /** Identificador viejo pedido (el issue se movió de team). */
  ref?: string;
}

// Referencias ya resueltas en esta pestaña (el estado se refresca cada minuto).
export const refCache = new Map<string, { at: number; info: RefInfo | null }>();
const REF_TTL = 60_000;

export async function resolveRefs(refs: string[]): Promise<void> {
  const now = Date.now();
  const missing = refs.filter((r) => {
    const hit = refCache.get(r);
    return !hit || now - hit.at > REF_TTL;
  });
  if (missing.length === 0) return;
  const res = await fetch(`/api/track/refs?refs=${encodeURIComponent(missing.join(','))}`).catch(() => null);
  if (!res?.ok) return;
  const rows = ((await res.json()) as { rows: RefInfo[] }).rows;
  for (const r of missing) refCache.set(r, { at: now, info: null });
  for (const row of rows) {
    refCache.set(row.identifier, { at: now, info: row });
    refCache.set(row.id, { at: now, info: row });
    if (row.ref) refCache.set(row.ref, { at: now, info: row });
  }
}

export function statusGlyph(info: RefInfo): string {
  const c = info.status_category === 'cancelled' ? '#8c8c8c' : glyphColor(info.status_color);
  const filled = info.status_category === 'done' || info.status_category === 'cancelled';
  const half = info.status_category === 'in_progress' ? '<path d="M7 3.25a3.75 3.75 0 0 1 0 7.5z" fill="currentColor"/>' : '';
  const dash = info.status_category === 'backlog' ? ' stroke-dasharray="2.2 1.8"' : '';
  // El color va en style (acepta var(--ink)); el SVG usa currentColor.
  return `<svg class="track-status-glyph" viewBox="0 0 14 14" width="12" height="12" aria-hidden="true" style="color:${c}"><circle cx="7" cy="7" r="5.75" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5"${dash}/>${half}</svg>`;
}


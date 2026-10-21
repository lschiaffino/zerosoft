/**
 * Board — notas adhesivas (stickies) como herramienta propia. Puro (sin DB ni
 * DOM): lo usan la barra del editor, las insignias sobre el lienzo y la ruta
 * que convierte stickies en issues de Track.
 *
 * Un sticky es un rectángulo de color con el texto adentro (texto ligado de
 * Excalidraw) y `customData.sticky = true`; los tags viven en
 * `customData.tags`. Las notas de las plantillas (sin customData) también
 * cuentan como stickies para tags, votos y Track: cualquier forma con texto.
 */
import { normalizeTag } from './notes-types';

/** Colores de la paleta de Excalidraw (los mismos tonos de las plantillas). */
export const STICKY_COLORS = [
  { key: 'yellow', fill: '#ffec99' },
  { key: 'green', fill: '#b2f2bb' },
  { key: 'blue', fill: '#a5d8ff' },
  { key: 'pink', fill: '#ffc9c9' },
  { key: 'violet', fill: '#d0bfff' },
  { key: 'orange', fill: '#ffd8a8' },
] as const;

export type StickyColorKey = (typeof STICKY_COLORS)[number]['key'];

export const STICKY_W = 200;
export const STICKY_H = 150;
const GAP = 24;
/** Tope de stickies por pegado (una lista larga no traba el lienzo). */
export const STICKY_PASTE_MAX = 100;
export const STICKY_TAGS_MAX = 8;
export const STICKY_TEXT_MAX = 500;

export function stickyFill(key: string | null | undefined): string {
  return (STICKY_COLORS.find((c) => c.key === key) ?? STICKY_COLORS[0]).fill;
}

export interface StickyDraft {
  text: string;
  tags: string[];
}

/** Tags limpios y sin repetir (mismo formato que los de Notes). */
export function cleanStickyTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const t = normalizeTag(raw);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= STICKY_TAGS_MAX) break;
  }
  return out;
}

/**
 * Pegado en bloque: una línea = un sticky. Saca viñetas ("- ", "* ", "1. ",
 * "[ ] ") y los #tags del final o del medio de la línea, que pasan a ser tags
 * del sticky. Las celdas separadas por tab (pegado de una planilla) se unen
 * con " · ".
 */
export function parseBulkStickies(text: string, extraTags: readonly string[] = []): StickyDraft[] {
  const out: StickyDraft[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/\t+/g, ' · ').trim();
    line = line.replace(/^(?:[-*•]\s+|\d+[.)]\s+|\[[ xX]?\]\s+)/, '').trim();
    const tags: string[] = [];
    line = line
      .replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (_m, pre: string, tag: string) => {
        tags.push(tag);
        return pre;
      })
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!line) continue;
    out.push({ text: line.slice(0, STICKY_TEXT_MAX), tags: cleanStickyTags([...extraTags, ...tags]) });
    if (out.length >= STICKY_PASTE_MAX) break;
  }
  return out;
}

/**
 * Espacio entre filas: los tags van arriba de cada sticky (insignias de ~22px
 * de alto, fijas en pantalla), así que entre filas tiene que entrar una línea
 * de tags incluso con poco zoom.
 */
const ROW_GAP = 56;
/** Margen libre alrededor de lo que ya hay en el lienzo (y de sus tags). */
const CLEARANCE = 32;

type Box = { x: number; y: number; width: number; height: number };

/** Grilla centrada en `center` para `count` stickies (hasta 6 columnas). */
export function layoutStickies(count: number, center: { x: number; y: number }): Array<{ x: number; y: number }> {
  if (count <= 0) return [];
  const { cols, width, height } = gridSize(count);
  const left = Math.round(center.x - width / 2);
  const top = Math.round(center.y - height / 2);
  return Array.from({ length: count }, (_, i) => ({
    x: left + (i % cols) * (STICKY_W + GAP),
    y: top + Math.floor(i / cols) * (STICKY_H + ROW_GAP),
  }));
}

function gridSize(count: number): { cols: number; width: number; height: number } {
  const cols = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(count))));
  const rows = Math.ceil(count / cols);
  return { cols, width: cols * STICKY_W + (cols - 1) * GAP, height: rows * STICKY_H + (rows - 1) * ROW_GAP };
}

function overlaps(a: Box, b: Box, margin: number): boolean {
  return a.x < b.x + b.width + margin && b.x < a.x + a.width + margin && a.y < b.y + b.height + margin && b.y < a.y + a.height + margin;
}

/**
 * Como layoutStickies, pero sin pisar lo que ya está en el lienzo: prueba la
 * grilla centrada en `center` y, si choca con algún elemento, la corre en
 * anillos cada vez más lejos hasta encontrar un hueco (lo más cerca posible
 * del centro de la vista). Si no hay hueco cerca, va debajo de todo.
 */
export function layoutStickiesInFreeSpace(
  count: number,
  center: { x: number; y: number },
  occupied: readonly Box[],
): Array<{ x: number; y: number }> {
  if (count <= 0) return [];
  const { width, height } = gridSize(count);
  const boxes = occupied.filter((b) => b.width > 0 || b.height > 0);
  const fits = (c: { x: number; y: number }) => {
    const area = { x: c.x - width / 2, y: c.y - height / 2, width, height };
    return !boxes.some((b) => overlaps(area, b, CLEARANCE));
  };
  if (fits(center)) return layoutStickies(count, center);
  const stepX = Math.max(STICKY_W, Math.round(width / 2));
  const stepY = Math.max(STICKY_H, Math.round(height / 2));
  for (let ring = 1; ring <= 12; ring++) {
    const candidates: Array<{ x: number; y: number; d: number }> = [];
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const c = { x: center.x + i * stepX, y: center.y + j * stepY };
        candidates.push({ ...c, d: Math.hypot(i * stepX, j * stepY) });
      }
    }
    candidates.sort((a, b) => a.d - b.d);
    const hit = candidates.find(fits);
    if (hit) return layoutStickies(count, hit);
  }
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return layoutStickies(count, { x: center.x, y: bottom + CLEARANCE + ROW_GAP + height / 2 });
}

/** Esqueleto para convertToExcalidrawElements (Excalidraw arma el texto ligado). */
export function stickySkeleton(draft: StickyDraft, pos: { x: number; y: number }, fill: string): Record<string, unknown> {
  return {
    type: 'rectangle',
    x: pos.x,
    y: pos.y,
    width: STICKY_W,
    height: STICKY_H,
    backgroundColor: fill,
    fillStyle: 'solid',
    strokeColor: '#1e1e1e',
    strokeWidth: 1,
    roughness: 1,
    roundness: { type: 3 },
    label: { text: draft.text, fontSize: 18 },
    customData: { sticky: true, tags: draft.tags },
  };
}

// ---------- Elementos de la escena ----------

export interface SceneEl {
  id: string;
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isDeleted?: boolean;
  text?: string;
  originalText?: string;
  containerId?: string | null;
  boundElements?: ReadonlyArray<{ id: string; type: string }> | null;
  backgroundColor?: string;
  customData?: Record<string, unknown> | null;
  version?: number;
  versionNonce?: number;
  updated?: number;
}

const CONTAINERS = new Set(['rectangle', 'ellipse', 'diamond']);

export function isSticky(el: SceneEl | undefined | null): boolean {
  return Boolean(el && !el.isDeleted && CONTAINERS.has(el.type ?? '') && (el.customData?.sticky === true || boundTextId(el)));
}

function boundTextId(el: SceneEl): string | null {
  return el.boundElements?.find((b) => b.type === 'text')?.id ?? null;
}

export function stickyTags(el: SceneEl | undefined | null): string[] {
  const raw = el?.customData?.tags;
  return Array.isArray(raw) ? cleanStickyTags(raw.filter((t): t is string => typeof t === 'string')) : [];
}

/** Elemento con tags nuevos y la versión subida (así el guardado y el merge lo ven). */
export function withStickyTags<T extends SceneEl>(el: T, tags: readonly string[], nonce = Math.floor(Math.random() * 2 ** 31)): T {
  return {
    ...el,
    customData: { ...(el.customData ?? {}), sticky: true, tags: cleanStickyTags(tags) },
    version: (el.version ?? 0) + 1,
    versionNonce: nonce,
    updated: Date.now(),
  };
}

/** Elemento con otro color de fondo (versión subida). */
export function withFill<T extends SceneEl>(el: T, fill: string, nonce = Math.floor(Math.random() * 2 ** 31)): T {
  return { ...el, backgroundColor: fill, version: (el.version ?? 0) + 1, versionNonce: nonce, updated: Date.now() };
}

/** Tags de la pizarra con cuántos stickies los usan (más usados primero). */
export function collectStickyTags(elements: readonly SceneEl[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const el of elements) {
    if (!isSticky(el)) continue;
    for (const t of stickyTags(el)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Ids de los stickies con un tag. */
export function stickiesWithTag(elements: readonly SceneEl[], tag: string): string[] {
  return elements.filter((el) => isSticky(el) && stickyTags(el).includes(tag)).map((el) => el.id);
}

/**
 * Lo seleccionado, resuelto a "tarjetas" con texto: un sticky (o forma con
 * texto) vale por su texto ligado; un texto suelto vale por sí mismo; un
 * texto ligado seleccionado cuenta como su forma. Sin texto, afuera.
 */
export function selectionItems(
  elements: readonly SceneEl[],
  selectedIds: Readonly<Record<string, boolean | undefined>>,
): Array<{ elementId: string; text: string }> {
  const byId = new Map(elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  const seen = new Set<string>();
  const out: Array<{ elementId: string; text: string }> = [];
  for (const [id, on] of Object.entries(selectedIds)) {
    if (!on) continue;
    let el = byId.get(id);
    if (!el) continue;
    if (el.type === 'text' && el.containerId && byId.has(el.containerId)) el = byId.get(el.containerId)!;
    if (seen.has(el.id)) continue;
    seen.add(el.id);
    const text = elementText(el, byId);
    if (text) out.push({ elementId: el.id, text });
  }
  return out;
}

/** Texto de un elemento: el propio (texto suelto) o el ligado (forma). */
export function elementText(el: SceneEl, byId: ReadonlyMap<string, SceneEl>): string {
  if (el.type === 'text') return (el.originalText ?? el.text ?? '').trim();
  const tid = boundTextId(el);
  const t = tid ? byId.get(tid) : undefined;
  return (t?.originalText ?? t?.text ?? '').trim();
}

/** Título de issue a partir del texto de un sticky: primera línea, sin saltos, hasta 200. */
export function stickyIssueTitle(text: string): string {
  const first = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
  const flat = first.replace(/\s+/g, ' ');
  return flat.length > 200 ? `${flat.slice(0, 199)}…` : flat;
}

/** Caja del elemento en coordenadas de la escena (sin rotación: alcanza para las insignias). */
export function elementBox(el: SceneEl): { x: number; y: number; width: number; height: number } {
  return { x: Number(el.x) || 0, y: Number(el.y) || 0, width: Math.abs(Number(el.width) || 0), height: Math.abs(Number(el.height) || 0) };
}

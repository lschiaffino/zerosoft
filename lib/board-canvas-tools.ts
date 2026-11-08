/**
 * Board — lógica pura de las herramientas del lienzo: el sticky siguiente
 * (Tab, Alt+flecha), reacciones con emoji sobre los objetos, el modo privado
 * del taller, el minimapa, insertar una tabla, importar stickies desde un CSV
 * (el nuestro o el de Miro) y a qué objeto se pega un comentario. Sin DOM.
 */
import { STICKY_COLORS, STICKY_H, STICKY_W, STICKY_PASTE_MAX, STICKY_TEXT_MAX, cleanStickyTags, elementBox, type SceneEl } from './board-stickies';

type Box = { x: number; y: number; width: number; height: number };

// ---------- Sticky siguiente ----------

export type Direction = 'right' | 'left' | 'down' | 'up';
const NEXT_GAP = 24;

/**
 * Dónde va el sticky siguiente a `from` en `dir`: pegado, con el mismo tamaño;
 * si ese lugar está ocupado, sigue corriéndose en la misma dirección.
 */
export function nextStickyBox(from: Box, dir: Direction, occupied: readonly Box[]): Box {
  const w = from.width || STICKY_W;
  const h = from.height || STICKY_H;
  const step = { right: [w + NEXT_GAP, 0], left: [-(w + NEXT_GAP), 0], down: [0, h + NEXT_GAP], up: [0, -(h + NEXT_GAP)] }[dir];
  let box = { x: from.x + step[0], y: from.y + step[1], width: w, height: h };
  for (let i = 0; i < 50; i++) {
    const hit = occupied.some((o) => o.x < box.x + box.width && box.x < o.x + o.width && o.y < box.y + box.height && box.y < o.y + o.height);
    if (!hit) break;
    box = { ...box, x: box.x + step[0], y: box.y + step[1] };
  }
  return box;
}

// ---------- Reacciones ----------

/** Reacciones que se ofrecen (las de siempre en Miro y Slack). */
export const REACTIONS = ['👍', '❤️', '🎉', '😂', '🤔', '👀'] as const;
const REACTORS_MAX = 200;

/** Reacciones de un elemento: emoji → quiénes (claves de persona), sin vacías. */
export function reactionsOf(el: SceneEl | null | undefined): Record<string, string[]> {
  const raw = el?.customData?.reactions;
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string[]> = {};
  for (const [emoji, who] of Object.entries(raw as Record<string, unknown>)) {
    if (!(REACTIONS as readonly string[]).includes(emoji) || !Array.isArray(who)) continue;
    const list = [...new Set(who.filter((w): w is string => typeof w === 'string' && w.length > 0 && w.length <= 80))].slice(0, REACTORS_MAX);
    if (list.length) out[emoji] = list;
  }
  return out;
}

/** El elemento con la reacción de `who` puesta o sacada (versión subida, así viaja y se guarda). */
export function toggleReaction<T extends SceneEl>(el: T, emoji: string, who: string, nonce = Math.floor(Math.random() * 2 ** 31)): T {
  const current = reactionsOf(el);
  const list = current[emoji] ?? [];
  const next = list.includes(who) ? list.filter((w) => w !== who) : [...list, who];
  const reactions = { ...current, [emoji]: next };
  if (!next.length) delete reactions[emoji];
  return {
    ...el,
    customData: { ...(el.customData ?? {}), reactions },
    version: (el.version ?? 0) + 1,
    versionNonce: nonce,
    updated: Date.now(),
  };
}

// ---------- Modo privado ----------

/** Quién escribió el sticky (lo marca la herramienta de stickies al crearlo). */
export function stickyAuthor(el: SceneEl | null | undefined): string | null {
  const a = el?.customData?.author;
  return typeof a === 'string' && a ? a : null;
}

/** En modo privado, los stickies con autor que no es `me` se tapan. Sin autor (plantillas) se ven. */
export function hiddenInPrivate(el: SceneEl, me: string, privateMode: boolean): boolean {
  if (!privateMode) return false;
  const author = stickyAuthor(el);
  return author !== null && author !== me;
}

// ---------- Minimapa ----------

export interface MinimapLayout {
  /** Escala escena → minimapa y desplazamiento (en px del minimapa). */
  scale: number;
  offsetX: number;
  offsetY: number;
  /** Rectángulo de lo que se ve, en px del minimapa. */
  viewport: Box;
}

/**
 * Encaja en `size` todo el contenido más lo que se ve ahora (así el recuadro
 * de la vista nunca queda afuera), con un margen.
 */
export function minimapLayout(content: Box | null, view: Box, size: { width: number; height: number }, pad = 8): MinimapLayout {
  const all = content
    ? {
        x: Math.min(content.x, view.x),
        y: Math.min(content.y, view.y),
        right: Math.max(content.x + content.width, view.x + view.width),
        bottom: Math.max(content.y + content.height, view.y + view.height),
      }
    : { x: view.x, y: view.y, right: view.x + view.width, bottom: view.y + view.height };
  const w = Math.max(1, all.right - all.x);
  const h = Math.max(1, all.bottom - all.y);
  const scale = Math.min((size.width - pad * 2) / w, (size.height - pad * 2) / h);
  const offsetX = (size.width - w * scale) / 2 - all.x * scale;
  const offsetY = (size.height - h * scale) / 2 - all.y * scale;
  return {
    scale,
    offsetX,
    offsetY,
    viewport: { x: view.x * scale + offsetX, y: view.y * scale + offsetY, width: view.width * scale, height: view.height * scale },
  };
}

/** Punto del minimapa (px) → punto de la escena. */
export function minimapToScene(p: { x: number; y: number }, layout: Pick<MinimapLayout, 'scale' | 'offsetX' | 'offsetY'>): { x: number; y: number } {
  return { x: (p.x - layout.offsetX) / layout.scale, y: (p.y - layout.offsetY) / layout.scale };
}

/** Caja que contiene a todos los elementos (sin los textos ligados, que van adentro de su forma). */
export function contentBounds(elements: readonly SceneEl[]): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    if (el.isDeleted || el.containerId) continue;
    const b = elementBox(el);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
}

// ---------- Tabla ----------

export const TABLE_MAX = 12;

/**
 * Esqueletos de una tabla de `rows` × `cols` celdas (rectángulos agrupados, la
 * primera fila con fondo de encabezado y texto en cada celda para escribir con
 * doble clic). `groupId` agrupa la tabla entera: se mueve como una sola cosa.
 */
export function tableSkeletons(
  rows: number,
  cols: number,
  origin: { x: number; y: number },
  groupId: string,
  texts: ReadonlyArray<readonly string[]> = [],
  cell = { width: 180, height: 56 },
): Array<Record<string, unknown>> {
  const r = Math.min(TABLE_MAX, Math.max(1, Math.round(rows)));
  const c = Math.min(TABLE_MAX, Math.max(1, Math.round(cols)));
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < c; j++) {
      const header = i === 0;
      out.push({
        type: 'rectangle',
        x: origin.x + j * cell.width,
        y: origin.y + i * cell.height,
        width: cell.width,
        height: cell.height,
        strokeColor: '#868e96',
        backgroundColor: header ? '#e9ecef' : '#ffffff',
        fillStyle: 'solid',
        strokeWidth: 1,
        roughness: 0,
        roundness: null,
        groupIds: [groupId],
        label: { text: (texts[i]?.[j] ?? '').trim().slice(0, 500) || ' ', fontSize: 16, fontFamily: 6 },
        customData: { table: groupId, row: i, col: j },
      });
    }
  }
  return out;
}

/**
 * Texto pegado de una planilla (Sheets, Excel): filas por línea y celdas por
 * tab. Null si no parece una tabla (menos de 2 columnas o 2 filas).
 */
export function parseSpreadsheetPaste(text: string): string[][] | null {
  if (!text.includes('\t')) return null;
  const rows = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .slice(0, TABLE_MAX)
    .map((l) => l.split('\t').slice(0, TABLE_MAX));
  const cols = Math.max(0, ...rows.map((r) => r.length));
  return rows.length >= 2 && cols >= 2 ? rows : null;
}

// ---------- Importar stickies desde CSV ----------

export interface CsvSticky {
  text: string;
  tags: string[];
  /** Relleno (#rrggbb) si la fila trae color. */
  fill: string | null;
  x: number | null;
  y: number | null;
}

/** Filas de un CSV (comillas dobles, comas o punto y coma, saltos dentro de comillas). */
export function parseCsvRows(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const TEXT_HEADERS = ['text', 'content', 'texto', 'contenido', 'conteúdo', 'conteudo', 'sticky', 'note', 'title'];
const COLOR_BY_NAME: Record<string, string> = Object.fromEntries(STICKY_COLORS.map((c) => [c.key, c.fill]));
// Nombres de colores de Miro y equivalentes cercanos de nuestra paleta.
Object.assign(COLOR_BY_NAME, {
  light_yellow: '#ffec99',
  gold: '#ffec99',
  light_green: '#b2f2bb',
  dark_green: '#b2f2bb',
  cyan: '#a5d8ff',
  light_blue: '#a5d8ff',
  dark_blue: '#a5d8ff',
  light_pink: '#ffc9c9',
  red: '#ffc9c9',
  purple: '#d0bfff',
  gray: '#e9ecef',
  black: '#e9ecef',
});

function colorOf(raw: string | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return null;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  return COLOR_BY_NAME[v.replace(/[\s-]+/g, '_')] ?? null;
}

/** Saca el apóstrofe que nuestro export pone delante de =, +, - y @ (anti fórmulas). */
function unguard(v: string): string {
  return /^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v;
}

/**
 * Stickies desde un CSV: el que exporta Board (text, tags, color, x, y), el de
 * stickies de Miro (una columna de contenido, con o sin encabezado) o una
 * planilla cualquiera (se usa la columna de texto, o la primera).
 */
export function parseStickyCsv(text: string): CsvSticky[] {
  const rows = parseCsvRows(text);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const textCol = head.findIndex((h) => TEXT_HEADERS.includes(h));
  const hasHeader = textCol >= 0;
  const col = (name: string[]) => (hasHeader ? head.findIndex((h) => name.includes(h)) : -1);
  const tagsCol = col(['tags', 'tag', 'etiquetas', 'labels']);
  const colorCol = col(['color', 'colour', 'cor']);
  const xCol = col(['x']);
  const yCol = col(['y']);
  const out: CsvSticky[] = [];
  for (const r of hasHeader ? rows.slice(1) : rows) {
    const body = unguard((r[hasHeader ? textCol : 0] ?? '').trim()).slice(0, STICKY_TEXT_MAX);
    if (!body) continue;
    const num = (i: number) => {
      if (i < 0) return null;
      const n = Number(r[i]);
      return r[i]?.trim() && Number.isFinite(n) ? n : null;
    };
    out.push({
      text: body,
      tags: tagsCol >= 0 ? cleanStickyTags((r[tagsCol] ?? '').split(/[\s,#]+/)) : [],
      fill: colorCol >= 0 ? colorOf(r[colorCol]) : null,
      x: num(xCol),
      y: num(yCol),
    });
    if (out.length >= STICKY_PASTE_MAX) break;
  }
  return out;
}

// ---------- Comentarios pegados a un objeto ----------

/**
 * El objeto bajo `p` al que se pega un comentario: el más chico que lo
 * contiene (un sticky adentro de un frame gana sobre el frame). Un texto
 * ligado cuenta como su forma; flechas y líneas no.
 */
export function elementAt(elements: readonly SceneEl[], p: { x: number; y: number }): SceneEl | null {
  let best: SceneEl | null = null;
  let bestArea = Infinity;
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const raw of elements) {
    if (raw.isDeleted) continue;
    const el = raw.type === 'text' && raw.containerId ? byId.get(raw.containerId) : raw;
    if (!el || el.isDeleted || el.type === 'arrow' || el.type === 'line' || el.type === 'freedraw') continue;
    const b = elementBox(el);
    if (p.x < b.x || p.y < b.y || p.x > b.x + b.width || p.y > b.y + b.height) continue;
    const area = b.width * b.height;
    if (area < bestArea) {
      best = el;
      bestArea = area;
    }
  }
  return best;
}

/** Dónde se dibuja un pin: si su objeto sigue en la escena, corrido lo que se movió el objeto. */
export function pinPosition(
  th: { x: number; y: number; element_id: string | null; anchor_x: number | null; anchor_y: number | null },
  byId: ReadonlyMap<string, SceneEl>,
): { x: number; y: number; attached: boolean } {
  if (!th.element_id || th.anchor_x == null || th.anchor_y == null) return { x: th.x, y: th.y, attached: false };
  const el = byId.get(th.element_id);
  if (!el || el.isDeleted) return { x: th.x, y: th.y, attached: false };
  return { x: th.x + (Number(el.x) || 0) - th.anchor_x, y: th.y + (Number(el.y) || 0) - th.anchor_y, attached: true };
}

/**
 * Board — lógica pura de las herramientas del lienzo: el sticky siguiente
 * (Tab, Alt+flecha), reacciones con emoji sobre los objetos, el modo privado
 * del taller, el minimapa, insertar una tabla, importar stickies desde un CSV
 * (el nuestro o el de Miro) y a qué objeto se pega un comentario. Sin DOM.
 */
import { STICKY_COLORS, STICKY_H, STICKY_W, STICKY_TEXT_MAX, cleanStickyTags, elementBox, type SceneEl } from './board-stickies';

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

/**
 * Esquina de un hueco libre de `size` lo más cerca posible de `center` (para
 * una tabla nueva, que no caiga encima de lo que hay). Prueba anillos cada vez
 * más lejos; si no encuentra, va debajo de todo.
 */
export function freeSpot(
  size: { width: number; height: number },
  center: { x: number; y: number },
  occupied: readonly Box[],
  margin = 32,
  /** Si se da, el hueco tiene que quedar adentro (lo que se ve, sin la barra de herramientas). */
  within?: Box,
): { x: number; y: number } {
  const at = (cx: number, cy: number) => ({ x: Math.round(cx - size.width / 2), y: Math.round(cy - size.height / 2) });
  const inside = (p: { x: number; y: number }) =>
    !within || (p.x >= within.x && p.y >= within.y && p.x + size.width <= within.x + within.width && p.y + size.height <= within.y + within.height);
  const fits = (p: { x: number; y: number }) =>
    inside(p) &&
    !occupied.some((o) => p.x < o.x + o.width + margin && o.x < p.x + size.width + margin && p.y < o.y + o.height + margin && o.y < p.y + size.height + margin);
  const first = at(center.x, center.y);
  if (fits(first)) return first;
  const stepX = Math.max(120, size.width / 2);
  const stepY = Math.max(90, size.height / 2);
  for (let ring = 1; ring <= 12; ring++) {
    const options: Array<{ p: { x: number; y: number }; d: number }> = [];
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        options.push({ p: at(center.x + i * stepX, center.y + j * stepY), d: Math.hypot(i * stepX, j * stepY) });
      }
    }
    options.sort((a, b) => a.d - b.d);
    const hit = options.find((o) => fits(o.p));
    if (hit) return hit.p;
  }
  const bottom = Math.max(...occupied.map((o) => o.y + o.height));
  return { x: first.x, y: bottom + margin };
}

// ---------- Teclas mientras se abre un sticky ----------

/** Una tecla que llegó antes de que el editor del sticky tuviera el foco. */
export type TypedKey = { kind: 'char'; ch: string } | { kind: 'back' } | { kind: 'enter' } | { kind: 'tab'; shift: boolean } | { kind: 'esc' };

/** La tecla (de un keydown) como algo para repetir en el editor, o null si no escribe nada. */
export function typedKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): TypedKey | null {
  if (e.ctrlKey || e.metaKey) return null;
  if (e.key === 'Backspace') return { kind: 'back' };
  if (e.key === 'Enter') return { kind: 'enter' };
  if (e.key === 'Tab') return { kind: 'tab', shift: e.shiftKey };
  if (e.key === 'Escape') return { kind: 'esc' };
  return [...e.key].length === 1 ? { kind: 'char', ch: e.key } : null;
}

/**
 * Aplica las teclas guardadas al texto del editor (con la selección dada, que
 * se reemplaza). Corta en el primer Tab o Esc: lo que sigue queda para el
 * sticky siguiente.
 */
export function replayKeys(
  value: string,
  start: number,
  end: number,
  keys: readonly TypedKey[],
): { value: string; caret: number; stop: 'tab' | 'esc' | null; shift: boolean; rest: TypedKey[] } {
  let v = value;
  let a = start;
  let b = end;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k.kind === 'tab' || k.kind === 'esc') {
      return { value: v, caret: a, stop: k.kind, shift: k.kind === 'tab' && k.shift, rest: keys.slice(i + 1) };
    }
    if (k.kind === 'back') {
      if (a !== b) v = v.slice(0, a) + v.slice(b);
      else if (a > 0) {
        v = v.slice(0, a - 1) + v.slice(a);
        a -= 1;
      }
      b = a;
      continue;
    }
    const ins = k.kind === 'enter' ? '\n' : k.ch;
    v = v.slice(0, a) + ins + v.slice(b);
    a += ins.length;
    b = a;
  }
  return { value: v, caret: a, stop: null, shift: false, rest: [] };
}

// ---------- Listas en el texto ----------

const BULLET = '• ';

/**
 * Listas al escribir en un sticky o un texto (el texto de Excalidraw es plano:
 * no hay negrita ni cursiva por partes). "- " o "* " al empezar la línea pasa
 * a "• "; Enter en una línea con viñeta sigue la lista, y en una viñeta vacía
 * la termina. Null si la tecla no cambia nada.
 */
export function bulletEdit(value: string, start: number, end: number, key: string, modified: boolean): { value: string; caret: number } | null {
  if (modified || start !== end) return null;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const before = value.slice(lineStart, start);
  if (key === ' ' && (before === '-' || before === '*')) {
    return { value: value.slice(0, lineStart) + BULLET + value.slice(start), caret: lineStart + BULLET.length };
  }
  if (key === 'Enter') {
    const lineEndAt = value.indexOf('\n', start);
    const line = value.slice(lineStart, lineEndAt === -1 ? value.length : lineEndAt);
    if (!line.startsWith(BULLET)) return null;
    if (line.trim() === BULLET.trim()) {
      return { value: value.slice(0, lineStart) + value.slice(lineStart + BULLET.length), caret: lineStart };
    }
    return { value: `${value.slice(0, start)}\n${BULLET}${value.slice(start)}`, caret: start + 1 + BULLET.length };
  }
  return null;
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

const STICKY_FILLS = new Set<string>(STICKY_COLORS.map((c) => c.fill));

/**
 * ¿Parece un sticky? Uno de la herramienta (customData.sticky) o un rectángulo
 * con texto y fondo de la paleta de stickies (las notas de las plantillas, o
 * uno dibujado a mano con esos colores).
 */
export function isStickyLike(el: SceneEl | null | undefined): boolean {
  if (!el || el.isDeleted) return false;
  if (el.customData?.sticky === true) return true;
  return el.type === 'rectangle' && STICKY_FILLS.has(String(el.backgroundColor ?? '').toLowerCase()) && Boolean(el.boundElements?.some((b) => b.type === 'text'));
}

/**
 * En modo privado se tapa todo lo que parece un sticky salvo lo que escribió
 * `me`: las notas de ejemplo de una plantilla (sin autor) también se tapan.
 */
export function hiddenInPrivate(el: SceneEl, me: string, privateMode: boolean): boolean {
  if (!privateMode || !isStickyLike(el)) return false;
  return stickyAuthor(el) !== me;
}

/** ¿Lo escribió alguien en modo privado y todavía no se reveló? (no se guarda ni viaja en vivo) */
export function isPrivateDraft(el: { customData?: Record<string, unknown> | null } | null | undefined): boolean {
  return el?.customData?.private === true;
}

/** Los elementos sin los borradores privados (ni sus textos ligados): lo que se guarda y viaja. */
export function withoutPrivate<T extends { id: string; containerId?: string | null; customData?: Record<string, unknown> | null }>(elements: readonly T[]): T[] {
  const priv = new Set(elements.filter((e) => isPrivateDraft(e)).map((e) => e.id));
  if (!priv.size) return elements as T[];
  return elements.filter((e) => !priv.has(e.id) && !(e.containerId && priv.has(e.containerId)));
}

/** Solo los borradores privados de `me` y sus textos (lo que se manda como borrador). */
export function privateDraftsOf<T extends { id: string; type?: string; containerId?: string | null; customData?: Record<string, unknown> | null; isDeleted?: boolean }>(
  elements: readonly T[],
  me: string,
): T[] {
  const mine = new Set(elements.filter((e) => !e.isDeleted && isPrivateDraft(e) && e.customData?.author === me).map((e) => e.id));
  return elements.filter((e) => !e.isDeleted && (mine.has(e.id) || (e.containerId != null && mine.has(e.containerId))));
}

/** El elemento con autor (versión subida): lo que se crea en modo privado queda de quien lo escribió. */
export function withAuthor<T extends SceneEl>(el: T, author: string, nonce = Math.floor(Math.random() * 2 ** 31), privateDraft = false): T {
  return {
    ...el,
    customData: { ...(el.customData ?? {}), author, ...(privateDraft ? { private: true } : {}) },
    version: (el.version ?? 0) + 1,
    versionNonce: nonce,
    updated: Date.now(),
  };
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
        label: { text: (texts[i]?.[j] ?? '').trim().slice(0, 500) || ' ', fontSize: 16, fontFamily: 6, strokeColor: '#1e1e1e' },
        customData: { table: groupId, row: i, col: j },
      });
    }
  }
  return out;
}

type TableCell = SceneEl & { customData: { table: string; row: number; col: number } };

function tableCellsOf(elements: readonly SceneEl[], tableId: string): TableCell[] {
  return elements.filter(
    (e): e is TableCell => !e.isDeleted && e.customData?.table === tableId && typeof e.customData?.row === 'number' && typeof e.customData?.col === 'number',
  );
}

/** Tabla de los elementos elegidos (todos de la misma) y la celda puntual si hay una sola. */
export function selectedTable(elements: readonly SceneEl[], selectedIds: readonly string[]): { tableId: string; cell: { row: number; col: number } | null } | null {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const picked = new Set<SceneEl>();
  for (const id of selectedIds) {
    let el = byId.get(id);
    if (el?.type === 'text' && el.containerId) el = byId.get(el.containerId);
    if (el && !el.isDeleted) picked.add(el);
  }
  const tables = new Set([...picked].map((e) => e.customData?.table));
  if (picked.size === 0 || tables.size !== 1) return null;
  const tableId = [...tables][0];
  if (typeof tableId !== 'string') return null;
  const only = picked.size === 1 ? [...picked][0] : null;
  return { tableId, cell: only ? { row: Number(only.customData?.row), col: Number(only.customData?.col) } : null };
}

export type TableOp =
  | { kind: 'addRow'; after: number }
  | { kind: 'addCol'; after: number }
  | { kind: 'removeRow'; index: number }
  | { kind: 'removeCol'; index: number };

export interface TableEdit {
  /** Elementos que cambian (celdas corridas, con su texto), con versión subida. */
  updated: SceneEl[];
  /** Ids a borrar (celdas de la fila o columna sacada y su texto). */
  removed: string[];
  /** Celdas nuevas, como esqueletos para convertToExcalidrawElements. */
  added: Array<Record<string, unknown>>;
}

/** Tamaño de cada fila y columna, y cuántas hay. */
export function tableShape(elements: readonly SceneEl[], tableId: string) {
  const cells = tableCellsOf(elements, tableId);
  const rows = Math.max(0, ...cells.map((c) => c.customData.row + 1));
  const cols = Math.max(0, ...cells.map((c) => c.customData.col + 1));
  const rowTop = (r: number) => Math.min(...cells.filter((c) => c.customData.row === r).map((c) => Number(c.y)));
  const rowH = (r: number) => Math.max(...cells.filter((c) => c.customData.row === r).map((c) => Number(c.height)));
  const colLeft = (c: number) => Math.min(...cells.filter((x) => x.customData.col === c).map((x) => Number(x.x)));
  const colW = (c: number) => Math.max(...cells.filter((x) => x.customData.col === c).map((x) => Number(x.width)));
  return { cells, rows, cols, rowTop, rowH, colLeft, colW };
}

/**
 * Sumar o sacar una fila o columna de una tabla: corre las celdas de abajo
 * (o de la derecha) con su texto y arma las celdas nuevas con el estilo de la
 * fila o columna vecina. No saca la última fila ni la última columna.
 */
export function editTable(elements: readonly SceneEl[], tableId: string, op: TableOp, nonce = () => Math.floor(Math.random() * 2 ** 31)): TableEdit | null {
  const { cells, rows, cols, rowTop, rowH, colLeft, colW } = tableShape(elements, tableId);
  if (!cells.length) return null;
  const byId = new Map(elements.map((e) => [e.id, e]));
  const group = (cells[0] as SceneEl & { groupIds?: string[] }).groupIds ?? [tableId];
  const textOf = (c: SceneEl) => c.boundElements?.filter((b) => b.type === 'text').map((b) => byId.get(b.id)).filter(Boolean) as SceneEl[];
  const updated: SceneEl[] = [];
  const bump = <T extends SceneEl>(el: T, patch: Partial<SceneEl>): T => ({ ...el, ...patch, version: (el.version ?? 0) + 1, versionNonce: nonce(), updated: Date.now() });
  const shift = (c: TableCell, dx: number, dy: number, data: Partial<TableCell['customData']>) => {
    updated.push(bump(c, { x: Number(c.x) + dx, y: Number(c.y) + dy, customData: { ...c.customData, ...data } }));
    for (const t of textOf(c)) updated.push(bump(t, { x: Number(t.x) + dx, y: Number(t.y) + dy }));
  };
  const cellSkeleton = (x: number, y: number, width: number, height: number, row: number, col: number, like?: SceneEl) => ({
    type: 'rectangle',
    x,
    y,
    width,
    height,
    strokeColor: like?.strokeColor ?? '#868e96',
    backgroundColor: row === 0 ? (like?.backgroundColor ?? '#e9ecef') : '#ffffff',
    fillStyle: 'solid',
    strokeWidth: 1,
    roughness: 0,
    roundness: null,
    groupIds: group,
    label: { text: ' ', fontSize: 16, fontFamily: 6, strokeColor: '#1e1e1e' },
    customData: { table: tableId, row, col },
  });
  const removed: string[] = [];
  const added: Array<Record<string, unknown>> = [];
  if (op.kind === 'addRow') {
    const after = Math.min(Math.max(op.after, 0), rows - 1);
    const h = rowH(after);
    const top = rowTop(after) + h;
    for (const c of cells) if (c.customData.row > after) shift(c, 0, h, { row: c.customData.row + 1 });
    for (let col = 0; col < cols; col++) added.push(cellSkeleton(colLeft(col), top, colW(col), h, after + 1, col));
  } else if (op.kind === 'addCol') {
    const after = Math.min(Math.max(op.after, 0), cols - 1);
    const w = colW(after);
    const left = colLeft(after) + w;
    const header = cells.find((c) => c.customData.row === 0);
    for (const c of cells) if (c.customData.col > after) shift(c, w, 0, { col: c.customData.col + 1 });
    for (let row = 0; row < rows; row++) added.push(cellSkeleton(left, rowTop(row), w, rowH(row), row, after + 1, row === 0 ? header : undefined));
  } else if (op.kind === 'removeRow') {
    if (rows <= 1 || op.index < 0 || op.index >= rows) return null;
    const h = rowH(op.index);
    for (const c of cells) {
      if (c.customData.row === op.index) removed.push(c.id, ...textOf(c).map((t) => t.id));
      else if (c.customData.row > op.index) shift(c, 0, -h, { row: c.customData.row - 1 });
    }
  } else {
    if (cols <= 1 || op.index < 0 || op.index >= cols) return null;
    const w = colW(op.index);
    for (const c of cells) {
      if (c.customData.col === op.index) removed.push(c.id, ...textOf(c).map((t) => t.id));
      else if (c.customData.col > op.index) shift(c, -w, 0, { col: c.customData.col - 1 });
    }
  }
  return { updated, removed, added };
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

// ---------- Archivos en el lienzo ----------

export interface FileCardData {
  fileId: string;
  url: string;
  name: string;
  mime: string;
  size: number;
}

const KINDS: Array<{ exts: string[]; icon: string; label: string }> = [
  { exts: ['pdf'], icon: '📕', label: 'PDF' },
  { exts: ['doc', 'docx', 'odt', 'rtf'], icon: '📄', label: 'DOC' },
  { exts: ['xls', 'xlsx', 'ods', 'csv'], icon: '📊', label: 'XLS' },
  { exts: ['ppt', 'pptx', 'odp'], icon: '📽️', label: 'PPT' },
  { exts: ['txt', 'md'], icon: '📝', label: 'TXT' },
  { exts: ['zip'], icon: '🗜️', label: 'ZIP' },
];

/** Ícono y tipo corto de un archivo por su extensión. */
export function fileKind(name: string): { icon: string; label: string } {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]?.toLowerCase() ?? '';
  const hit = KINDS.find((k) => k.exts.includes(ext));
  return hit ? { icon: hit.icon, label: hit.label } : { icon: '📎', label: ext.toUpperCase() || 'FILE' };
}

/** Tamaño legible: 820 B, 14 KB, 1.2 MB. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const FILE_CARD = { width: 300, height: 84 };

/**
 * Tarjeta de un archivo: rectángulo con ícono, nombre, tipo y tamaño, y el
 * link del archivo (Excalidraw muestra el ícono de link y lo abre). Los datos
 * del archivo quedan en customData.file.
 */
export function fileCardSkeleton(file: FileCardData, pos: { x: number; y: number }): Record<string, unknown> {
  const kind = fileKind(file.name);
  const name = file.name.length > 60 ? `${file.name.slice(0, 57)}…` : file.name;
  return {
    type: 'rectangle',
    x: pos.x,
    y: pos.y,
    width: FILE_CARD.width,
    height: FILE_CARD.height,
    strokeColor: '#868e96',
    backgroundColor: '#ffffff',
    fillStyle: 'solid',
    strokeWidth: 1,
    roughness: 0,
    roundness: { type: 3 },
    link: file.url,
    label: { text: `${kind.icon} ${name}\n${kind.label} · ${formatBytes(file.size)}`, fontSize: 16, fontFamily: 6, textAlign: 'left', strokeColor: '#1e1e1e' },
    customData: { file: { fileId: file.fileId, name: file.name, mime: file.mime, size: file.size } },
  };
}

/** ¿Es un link a un archivo de esta app (adjunto o imagen de una pizarra)? */
export function isBoardFileLink(link: string | null | undefined): boolean {
  return typeof link === 'string' && /^\/api\/boards\/[A-Za-z0-9_-]{1,64}\/files\/[A-Za-z0-9_-]{1,128}$/.test(link);
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
/** Tope de stickies por archivo importado (más filas: se avisa cuántas entraron). */
export const STICKY_IMPORT_MAX = 500;

export function parseStickyCsv(text: string, max: number = STICKY_IMPORT_MAX): CsvSticky[] {
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
    if (out.length >= max) break;
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

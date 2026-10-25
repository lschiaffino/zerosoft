import { DOCS_MAX_INDENT, type DocsBlock } from './docs-types';
import { blockIndent, setIndent, subtreeEnd } from './docs-blocks';

/**
 * Columnas de Docs sobre la lista plana (como en Notion: column_list >
 * column > bloques). Un bloque `columns` con indent d tiene como hijos
 * directos solo bloques `column` (indent d + 1), y cada columna tiene sus
 * bloques en indent d + 2 o más. Así mover, duplicar, borrar o deshacer la
 * fila de columnas es mover su subárbol, igual que cualquier bloque. Puro.
 */

export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 5;

export function isStructuralBlock(b: Pick<DocsBlock, 'type'> | undefined): boolean {
  return b?.type === 'columns' || b?.type === 'column';
}

function block(type: DocsBlock['type'], indent: number, newId: () => string, extra: Partial<DocsBlock> = {}): DocsBlock {
  return setIndent({ id: newId(), type, content: '', ...extra }, indent);
}

function shift(list: DocsBlock[], to: number): DocsBlock[] {
  if (!list.length) return list;
  const delta = to - blockIndent(list[0]);
  return list.map((b) => setIndent(b, blockIndent(b) + delta));
}

/** Índice del bloque `column` que contiene a `i` (-1 si no está en columnas). */
export function columnOf(blocks: DocsBlock[], i: number): number {
  let level = blockIndent(blocks[i]);
  for (let j = i - 1; j >= 0; j--) {
    const d = blockIndent(blocks[j]);
    if (d < level) {
      if (blocks[j].type === 'column') return j;
      level = d;
    }
  }
  return -1;
}

/** Índice de la fila `columns` de una columna (-1 si no hay). */
export function columnListOf(blocks: DocsBlock[], columnIndex: number): number {
  const d = blockIndent(blocks[columnIndex]);
  for (let j = columnIndex - 1; j >= 0; j--) {
    if (blockIndent(blocks[j]) < d) return blocks[j].type === 'columns' ? j : -1;
  }
  return -1;
}

/** Índices de las columnas de una fila `columns`. */
export function columnsIn(blocks: DocsBlock[], listIndex: number): number[] {
  const d = blockIndent(blocks[listIndex]);
  const end = subtreeEnd(blocks, listIndex);
  const out: number[] = [];
  for (let j = listIndex + 1; j <= end; j++) if (blockIndent(blocks[j]) === d + 1) out.push(j);
  return out;
}

/** Fila de columnas nueva con `count` columnas vacías (cada una con un párrafo). */
export function makeColumnList(count: number, indent: number, newId: () => string): DocsBlock[] {
  const n = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, Math.floor(count)));
  const out: DocsBlock[] = [block('columns', indent, newId)];
  for (let k = 0; k < n; k++) {
    out.push(block('column', indent + 1, newId, { ratio: 1 }));
    out.push(block('paragraph', indent + 2, newId));
  }
  return out;
}

/**
 * Deja las columnas válidas: dentro de `columns` solo columnas (lo que quedó
 * suelto entra a la columna anterior, o a la primera), columnas vacías
 * afuera, una fila con una sola columna se deshace (su contenido sube al
 * nivel de la fila) y una sin columnas se borra. Un `column` fuera de una
 * fila pasa a párrafo. No anida columnas dentro de columnas (como Notion,
 * el contenido de la columna interna sube a la externa). Devuelve el mismo
 * array si no hubo cambios.
 */
export function normalizeColumns(blocks: DocsBlock[], newId: () => string): DocsBlock[] {
  if (!blocks.some(isStructuralBlock)) return blocks;
  const out: DocsBlock[] = [];
  let changed = false;
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type === 'column') {
      // Columna huérfana (sin fila arriba): se queda su contenido.
      changed = true;
      const end = subtreeEnd(blocks, i);
      out.push(...shift(blocks.slice(i + 1, end + 1), blockIndent(b)));
      i = end + 1;
      continue;
    }
    if (b.type !== 'columns') {
      out.push(b);
      i++;
      continue;
    }
    const d = blockIndent(b);
    const end = subtreeEnd(blocks, i);
    // Agrupa los hijos en columnas.
    const cols: { col: DocsBlock; body: DocsBlock[] }[] = [];
    let loose: DocsBlock[] = [];
    let j = i + 1;
    while (j <= end) {
      const c = blocks[j];
      const cd = blockIndent(c);
      if (cd === d + 1 && c.type === 'column') {
        const cEnd = subtreeEnd(blocks, j);
        cols.push({ col: c, body: blocks.slice(j + 1, cEnd + 1) });
        j = cEnd + 1;
        continue;
      }
      // Hijo directo que no es columna: entra a la columna anterior (o a la primera).
      changed = true;
      const cEnd = subtreeEnd(blocks, j);
      const sub = shift(blocks.slice(j, cEnd + 1), d + 2);
      if (cols.length) cols[cols.length - 1].body.push(...sub);
      else loose = [...loose, ...sub];
      j = cEnd + 1;
    }
    if (loose.length) {
      if (cols.length) cols[0].body.unshift(...loose);
      else cols.push({ col: block('column', d + 1, newId, { ratio: 1 }), body: loose });
    }
    // Columnas anidadas: su contenido sube a la columna que las contiene.
    for (const c of cols) {
      if (!c.body.some(isStructuralBlock)) continue;
      changed = true;
      const flat: DocsBlock[] = [];
      for (const x of c.body) if (!isStructuralBlock(x)) flat.push(x);
      c.body = flat.length ? normalizeBodyIndent(flat, d + 2) : [];
    }
    const kept = cols.filter((c) => c.body.length > 0);
    if (kept.length !== cols.length) changed = true;
    if (kept.length === 0) {
      changed = true;
      i = end + 1;
      continue;
    }
    if (kept.length === 1) {
      changed = true;
      out.push(...shift(kept[0].body, d));
      i = end + 1;
      continue;
    }
    // Más de MAX_COLUMNS: las de sobra se suman a la última permitida.
    if (kept.length > MAX_COLUMNS) {
      changed = true;
      const extra = kept.splice(MAX_COLUMNS);
      for (const x of extra) kept[MAX_COLUMNS - 1].body.push(...x.body);
    }
    out.push(b);
    for (const c of kept) {
      out.push(c.col);
      out.push(...c.body);
    }
    i = end + 1;
  }
  return changed ? out : blocks;
}

/** Indents de un cuerpo de columna: el primero en `base` y nadie más de un nivel abajo del anterior. */
function normalizeBodyIndent(list: DocsBlock[], base: number): DocsBlock[] {
  let prev = base - 1;
  return list.map((b) => {
    const want = Math.max(base, Math.min(blockIndent(b), prev + 1));
    prev = want;
    return setIndent(b, want);
  });
}

/**
 * Soltar el bloque [from, subtreeEnd(from)] al costado de `target`: si el
 * destino está en una columna, se abre una columna nueva al lado de esa (hasta
 * MAX_COLUMNS); si no, el destino y lo soltado pasan a ser una fila de dos
 * columnas. null si no se puede (soltarlo sobre sí mismo, sin lugar, o sin
 * niveles de anidado libres).
 */
export function dropBeside(
  blocks: DocsBlock[],
  from: number,
  target: number,
  side: 'left' | 'right',
  newId: () => string,
): DocsBlock[] | null {
  const fromEnd = subtreeEnd(blocks, from);
  if (target >= from && target <= fromEnd) return null;
  if (isStructuralBlock(blocks[from]) && blocks[from].type === 'column') return null;
  const targetId = blocks[target]?.id;
  if (!targetId) return null;
  const moved = blocks.slice(from, fromEnd + 1);
  if (moved.some((b) => b.type === 'columns')) return null;
  const rest = [...blocks.slice(0, from), ...blocks.slice(fromEnd + 1)];
  const t = rest.findIndex((b) => b.id === targetId);
  if (t === -1) return null;
  const col = columnOf(rest, t);
  if (col !== -1) {
    const list = columnListOf(rest, col);
    if (list === -1) return null;
    const cols = columnsIn(rest, list);
    if (cols.length >= MAX_COLUMNS) return null;
    const cd = blockIndent(rest[col]);
    const body = shift(moved, cd + 1);
    if (body.some((b) => blockIndent(b) > DOCS_MAX_INDENT)) return null;
    const newCol = block('column', cd, newId, { ratio: 1 });
    const at = side === 'left' ? col : subtreeEnd(rest, col) + 1;
    const next = [...rest.slice(0, at), newCol, ...body, ...rest.slice(at)];
    return evenRatios(normalizeColumns(next, newId), targetId);
  }
  const tEnd = subtreeEnd(rest, t);
  const d = blockIndent(rest[t]);
  if (d + 2 + Math.max(...moved.map((b) => blockIndent(b) - blockIndent(moved[0])), 0) > DOCS_MAX_INDENT) return null;
  const targetBody = shift(rest.slice(t, tEnd + 1), d + 2);
  const movedBody = shift(moved, d + 2);
  if (targetBody.some((b) => blockIndent(b) > DOCS_MAX_INDENT)) return null;
  const listBlock = block('columns', d, newId);
  const c1 = block('column', d + 1, newId, { ratio: 1 });
  const c2 = block('column', d + 1, newId, { ratio: 1 });
  const row =
    side === 'left'
      ? [listBlock, c1, ...movedBody, c2, ...targetBody]
      : [listBlock, c1, ...targetBody, c2, ...movedBody];
  return normalizeColumns([...rest.slice(0, t), ...row, ...rest.slice(tEnd + 1)], newId);
}

/** Todas las columnas de la fila que contiene a `blockId` con el mismo ancho. */
function evenRatios(blocks: DocsBlock[], blockId: string): DocsBlock[] {
  const i = blocks.findIndex((b) => b.id === blockId);
  const col = i === -1 ? -1 : columnOf(blocks, i);
  const list = col === -1 ? -1 : columnListOf(blocks, col);
  if (list === -1) return blocks;
  const set = new Set(columnsIn(blocks, list));
  return blocks.map((b, k) => (set.has(k) ? { ...b, ratio: 1 } : b));
}

/**
 * Nuevos pesos de dos columnas vecinas al arrastrar el separador: `dx` px
 * sobre un ancho total `total` px de la fila. Cada columna queda con al menos
 * el 10% del ancho.
 */
export function resizeRatios(ratios: number[], left: number, dx: number, total: number): number[] {
  if (left < 0 || left + 1 >= ratios.length || total <= 0) return ratios;
  const sum = ratios.reduce((a, b) => a + b, 0) || 1;
  const pair = ratios[left] + ratios[left + 1];
  const min = sum * 0.1;
  const delta = (dx / total) * sum;
  const a = Math.max(min, Math.min(pair - min, ratios[left] + delta));
  const out = [...ratios];
  out[left] = Math.round(a * 1000) / 1000;
  out[left + 1] = Math.round((pair - a) * 1000) / 1000;
  return out;
}

/** Peso válido de una columna (default 1). */
export function columnRatio(b: Pick<DocsBlock, 'ratio'>): number {
  const r = Number(b.ratio);
  return Number.isFinite(r) && r > 0 ? Math.min(r, 100) : 1;
}

/** Contenedor más cercano de `i`: una columna o un bloque sincronizado (-1 si ninguno). */
export function containerOf(blocks: DocsBlock[], i: number): number {
  let level = blockIndent(blocks[i]);
  for (let j = i - 1; j >= 0; j--) {
    const d = blockIndent(blocks[j]);
    if (d < level) {
      if (blocks[j].type === 'column' || blocks[j].type === 'synced') return j;
      level = d;
    }
  }
  return -1;
}

/** Indent mínimo de un bloque en su contenedor (0 afuera de columnas y sincronizados). */
export function scopeBaseIndent(blocks: DocsBlock[], i: number): number {
  const c = containerOf(blocks, i);
  return c === -1 ? 0 : blockIndent(blocks[c]) + 1;
}

/** Profundidad visual de un bloque dentro de su contenedor. */
export function visualIndent(blocks: DocsBlock[], i: number): number {
  return Math.max(0, blockIndent(blocks[i]) - scopeBaseIndent(blocks, i));
}

/**
 * Las bases no se sincronizan (sus filas, relaciones y automatizaciones son de
 * la página donde viven): una base dentro de un bloque sincronizado sale y
 * queda justo debajo de él, al mismo nivel. Si no, al recargar la página el
 * contenido compartido (sin bases) la reemplazaba y se perdía.
 */
export function liftDatabasesOutOfSynced(blocks: DocsBlock[]): DocsBlock[] {
  if (!blocks.some((b) => b.type === 'synced') || !blocks.some((b) => b.type === 'database')) return blocks;
  const out: DocsBlock[] = [];
  let changed = false;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    out.push(b);
    if (b.type !== 'synced') continue;
    const end = subtreeEnd(blocks, i);
    const lifted: DocsBlock[] = [];
    for (let j = i + 1; j <= end; j++) {
      if (blocks[j].type === 'database') lifted.push(setIndent(blocks[j], blockIndent(b)));
      else out.push(blocks[j]);
    }
    if (lifted.length) changed = true;
    out.push(...lifted);
    i = end;
  }
  return changed ? out : blocks;
}

/**
 * Columnas válidas (normalizeColumns) y bloques sincronizados con al menos un
 * hijo (un párrafo vacío si quedó sin contenido).
 */
export function normalizeStructure(blocks: DocsBlock[], newId: () => string): DocsBlock[] {
  let out = normalizeColumns(liftDatabasesOutOfSynced(blocks), newId);
  if (!out.some((b) => b.type === 'synced')) return out;
  let changed = false;
  const next: DocsBlock[] = [];
  out.forEach((b, i) => {
    next.push(b);
    if (b.type !== 'synced') return;
    const following = out[i + 1];
    if (!following || blockIndent(following) <= blockIndent(b)) {
      changed = true;
      next.push(setIndent({ id: newId(), type: 'paragraph', content: '' }, blockIndent(b) + 1));
    }
  });
  if (changed) out = next;
  return out;
}

/**
 * Lista sin contenedores (columnas, columnas y sincronizados se quitan y su
 * contenido sube los niveles que ocupaban). Para exportar (Markdown, Word) y
 * contar: el contenido queda en orden, una columna después de la otra.
 */
export function flattenContainers(blocks: DocsBlock[]): DocsBlock[] {
  if (!blocks.some((b) => isStructuralBlock(b) || b.type === 'synced')) return blocks;
  const out: DocsBlock[] = [];
  const stack: Array<{ indent: number; container: boolean }> = [];
  for (const b of blocks) {
    const d = blockIndent(b);
    while (stack.length && stack[stack.length - 1].indent >= d) stack.pop();
    const containers = stack.filter((x) => x.container).length;
    const container = isStructuralBlock(b) || b.type === 'synced';
    stack.push({ indent: d, container });
    if (!container) out.push(setIndent(b, d - containers));
  }
  return out;
}

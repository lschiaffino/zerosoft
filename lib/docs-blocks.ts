import { DOCS_MAX_INDENT, type DocsBlock } from './docs-types';

/**
 * Estructura de bloques de Docs (y Notes) sobre la lista plana: los hijos de
 * un bloque son los que le siguen con un `indent` mayor, hasta el primero con
 * un indent igual o menor. Puro (sin DOM ni DB): lo usan el editor (Tab,
 * toggles, selección de varios bloques) y los renders de solo lectura.
 */

export function blockIndent(b: Pick<DocsBlock, 'indent'> | undefined): number {
  const n = Number(b?.indent ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(DOCS_MAX_INDENT, Math.floor(n));
}

/** Toggle de lista o heading con toggle: pliega a sus hijos. */
export function isToggleBlock(b: Pick<DocsBlock, 'type' | 'toggle'> | undefined): boolean {
  return !!b && (b.type === 'toggle' || (b.type === 'heading' && b.toggle === true));
}

/** Último índice del subárbol de `i` (él mismo si no tiene hijos). */
export function subtreeEnd(blocks: DocsBlock[], i: number): number {
  const base = blockIndent(blocks[i]);
  let end = i;
  while (end + 1 < blocks.length && blockIndent(blocks[end + 1]) > base) end++;
  return end;
}

/** true en cada bloque que queda adentro de un toggle plegado (no se muestra). */
export function hiddenBlocks(blocks: DocsBlock[]): boolean[] {
  const out: boolean[] = new Array(blocks.length).fill(false);
  // Indent del toggle plegado más externo que está tapando (-1 = ninguno).
  let hideAbove = -1;
  blocks.forEach((b, i) => {
    const d = blockIndent(b);
    if (hideAbove !== -1 && d > hideAbove) {
      out[i] = true;
      return;
    }
    hideAbove = isToggleBlock(b) && b.collapsed ? d : -1;
  });
  return out;
}

/** Índice visible anterior/siguiente a `i` (-1 si no hay). */
export function nextVisible(hidden: boolean[], i: number, dir: -1 | 1): number {
  for (let j = i + dir; j >= 0 && j < hidden.length; j += dir) if (!hidden[j]) return j;
  return -1;
}

/**
 * Deja la estructura válida: el primer bloque sin indent y cada uno con a lo
 * sumo un nivel más que el anterior. Devuelve los mismos objetos si no hubo cambios.
 */
export function normalizeIndents(blocks: DocsBlock[]): DocsBlock[] {
  let prev = -1;
  let changed = false;
  const out = blocks.map((b) => {
    const want = Math.min(blockIndent(b), prev + 1);
    prev = want;
    if (want === (b.indent ?? 0)) return b;
    changed = true;
    const next = { ...b };
    if (want === 0) delete next.indent;
    else next.indent = want;
    return next;
  });
  return changed ? out : blocks;
}

/** Rango [start, end] estirado para incluir los hijos de todo lo seleccionado. */
export function expandRange(blocks: DocsBlock[], start: number, end: number): [number, number] {
  const s = Math.max(0, Math.min(start, end));
  let e = Math.min(blocks.length - 1, Math.max(start, end));
  for (let k = s; k <= e; k++) e = Math.max(e, subtreeEnd(blocks, k));
  return [s, e];
}

function withIndent(b: DocsBlock, indent: number): DocsBlock {
  const next = { ...b };
  if (indent <= 0) delete next.indent;
  else next.indent = indent;
  return next;
}

/**
 * Tab (+1) / Shift+Tab (-1) sobre [start, end] con sus hijos. Tab necesita un
 * bloque arriba del mismo nivel o más profundo (el primero no se anida). null
 * si no se puede.
 */
export function indentRange(blocks: DocsBlock[], start: number, end: number, dir: -1 | 1): DocsBlock[] | null {
  if (!blocks.length) return null;
  const [s, e] = expandRange(blocks, start, end);
  if (dir === 1) {
    if (s === 0 || blockIndent(blocks[s]) > blockIndent(blocks[s - 1])) return null;
    for (let k = s; k <= e; k++) if (blockIndent(blocks[k]) >= DOCS_MAX_INDENT) return null;
  } else if (!blocks.slice(s, e + 1).some((b) => blockIndent(b) > 0)) {
    return null;
  }
  const out = blocks.map((b, k) => (k >= s && k <= e ? withIndent(b, blockIndent(b) + dir) : b));
  return normalizeIndents(out);
}

export interface RangeResult {
  blocks: DocsBlock[];
  /** Rango resultante (los bloques movidos/copiados, sin contar sus hijos). */
  start: number;
  end: number;
}

/** Borra [start, end] con sus hijos. Nunca deja la página sin bloques. */
export function deleteRange(blocks: DocsBlock[], start: number, end: number, newId: () => string): RangeResult {
  const [s, e] = expandRange(blocks, start, end);
  const rest = [...blocks.slice(0, s), ...blocks.slice(e + 1)];
  const out = rest.length ? normalizeIndents(rest) : [{ id: newId(), type: 'paragraph' as const, content: '' }];
  const at = Math.min(Math.max(0, s - 1), out.length - 1);
  return { blocks: out, start: at, end: at };
}

/** Copia profunda de un bloque con id nuevo (filas y columnas copiadas). */
export function cloneBlock(b: DocsBlock, newId: () => string): DocsBlock {
  return {
    ...b,
    id: newId(),
    rows: b.rows?.map((r) => [...r]),
    columns: b.columns?.map((c) => ({ ...c, options: c.options ? [...c.options] : undefined })),
  };
}

/** Duplica [start, end] (con hijos) justo debajo; el resultado apunta a la copia. */
export function duplicateRange(blocks: DocsBlock[], start: number, end: number, newId: () => string): RangeResult {
  const [s, e] = expandRange(blocks, start, end);
  const copies = blocks.slice(s, e + 1).map((b) => cloneBlock(b, newId));
  const out = [...blocks.slice(0, e + 1), ...copies, ...blocks.slice(e + 1)];
  const span = Math.abs(end - start);
  return { blocks: out, start: e + 1, end: e + 1 + span };
}

/**
 * Mueve [start, end] (con hijos) un lugar arriba o abajo, como Alt+Shift+↑/↓
 * en Notion: si hay un hermano del mismo nivel, salta su subárbol entero; si
 * no (primer o último hijo), sale del padre por arriba o entra como primer
 * hijo del bloque siguiente. null si ya está en el borde.
 */
export function moveRange(blocks: DocsBlock[], start: number, end: number, dir: -1 | 1): RangeResult | null {
  const [s, e] = expandRange(blocks, start, end);
  const span = Math.abs(end - start);
  const range = blocks.slice(s, e + 1);
  const level = blockIndent(blocks[s]);
  if (dir === -1) {
    let q = s - 1;
    while (q >= 0 && blockIndent(blocks[q]) > level) q--;
    if (q < 0) return null;
    const out = [...blocks.slice(0, q), ...range, ...blocks.slice(q, s), ...blocks.slice(e + 1)];
    const norm = normalizeIndents(out);
    return { blocks: norm, start: q, end: q + span };
  }
  const n = e + 1;
  if (n >= blocks.length) return null;
  if (blockIndent(blocks[n]) >= level) {
    const t = subtreeEnd(blocks, n);
    const out = [...blocks.slice(0, s), ...blocks.slice(n, t + 1), ...range, ...blocks.slice(t + 1)];
    const at = s + (t - n + 1);
    return { blocks: normalizeIndents(out), start: at, end: at + span };
  }
  // Último hijo: pasa a ser el primer hijo del bloque siguiente (que se despliega).
  const host = isToggleBlock(blocks[n]) && blocks[n].collapsed ? { ...blocks[n], collapsed: false } : blocks[n];
  const out = [...blocks.slice(0, s), host, ...range, ...blocks.slice(n + 1)];
  return { blocks: normalizeIndents(out), start: s + 1, end: s + 1 + span };
}

/**
 * Dónde cae un bloque nuevo "debajo" de `index` (Enter en bloques sin texto,
 * el "+" entre bloques, "Insertar debajo"): si el bloque tiene hijos
 * visibles, entra como primer hijo; si es un toggle plegado, después de todo
 * su subárbol; si no, justo debajo con el mismo nivel.
 */
export function insertionPoint(blocks: DocsBlock[], index: number): { at: number; indent: number } {
  const b = blocks[index];
  if (!b) return { at: blocks.length, indent: 0 };
  const d = blockIndent(b);
  if (isToggleBlock(b) && b.collapsed) return { at: subtreeEnd(blocks, index) + 1, indent: d };
  const next = blocks[index + 1];
  if (next && blockIndent(next) > d) return { at: index + 1, indent: d + 1 };
  return { at: index + 1, indent: d };
}

/** Bloque con su indent (sin la clave cuando es 0). */
export function setIndent(b: DocsBlock, indent: number): DocsBlock {
  return withIndent(b, Math.min(DOCS_MAX_INDENT, Math.max(0, indent)));
}

/**
 * Número de cada ítem de lista numerada (0 si no es numerada): la cuenta
 * sigue mientras los hermanos del mismo nivel sean numerados; los hijos no la cortan.
 */
export function listNumbers(blocks: DocsBlock[]): number[] {
  const counters: number[] = [];
  const prevType: (string | null)[] = [];
  return blocks.map((b) => {
    const d = blockIndent(b);
    counters.length = d + 1;
    prevType.length = d + 1;
    const n = b.type === 'numbered_list_item' ? (prevType[d] === 'numbered_list_item' ? (counters[d] ?? 0) + 1 : 1) : 0;
    counters[d] = n;
    prevType[d] = b.type;
    return n;
  });
}

export interface DocsBlockNode {
  block: DocsBlock;
  children: DocsBlockNode[];
}

/** Lista plana → árbol (render de solo lectura: toggles con <details>, listas anidadas). */
export function blocksToTree(blocks: DocsBlock[]): DocsBlockNode[] {
  const roots: DocsBlockNode[] = [];
  const stack: Array<{ node: DocsBlockNode; indent: number }> = [];
  for (const block of normalizeIndents(blocks)) {
    const node: DocsBlockNode = { block, children: [] };
    const d = blockIndent(block);
    while (stack.length && stack[stack.length - 1].indent >= d) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ node, indent: d });
  }
  return roots;
}

/**
 * Docs: qué cambió entre dos versiones de una página, bloque por bloque
 * (los bloques tienen id estable) y, adentro de un bloque cambiado, palabra
 * por palabra. Puro: lo usa el panel de historial y los tests.
 */
import type { DocsBlock } from './docs-types';
import { flatText } from './docs-marks';

export type DiffOp = 'eq' | 'ins' | 'del';

export interface TextSegment {
  op: DiffOp;
  text: string;
}

export interface BlockDiff {
  kind: 'same' | 'added' | 'removed' | 'changed';
  /** El bloque nuevo (o el viejo si se borró). */
  block: DocsBlock;
  /** Texto con lo agregado y lo quitado marcado (bloques cambiados). */
  segments: TextSegment[];
}

/** Texto que representa un bloque en el diff (también los que no son de texto). */
export function blockDiffText(b: DocsBlock): string {
  const parts: string[] = [];
  if (b.content) parts.push(flatText(b.content));
  if (b.rows?.length) parts.push(b.rows.map((r) => r.map((c) => flatText(c)).join(' | ')).join('\n'));
  if (b.db) parts.push(b.db.rows.map((r) => Object.values(r.values).filter((v) => typeof v === 'string').join(' | ')).join('\n'));
  if (b.name) parts.push(b.name);
  if (b.link?.url) parts.push(b.link.title ? `${b.link.title} (${b.link.url})` : b.link.url);
  if (b.caption) parts.push(flatText(b.caption));
  if (b.type === 'todo') parts.unshift(b.checked ? '[x]' : '[ ]');
  return parts.join('\n');
}

function tokens(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

/** Diff de palabras (LCS). Textos largos: se compara por líneas para no explotar. */
export function diffText(before: string, after: string): TextSegment[] {
  if (before === after) return before ? [{ op: 'eq', text: before }] : [];
  let a = tokens(before);
  let b = tokens(after);
  if (a.length * b.length > 400_000) {
    a = before.split(/(?<=\n)/);
    b = after.split(/(?<=\n)/);
  }
  if (a.length * b.length > 4_000_000) {
    return [
      ...(before ? [{ op: 'del' as const, text: before }] : []),
      ...(after ? [{ op: 'ins' as const, text: after }] : []),
    ];
  }
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: TextSegment[] = [];
  const push = (op: DiffOp, text: string) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('eq', a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('del', a[i++]);
    } else {
      push('ins', b[j++]);
    }
  }
  while (i < n) push('del', a[i++]);
  while (j < m) push('ins', b[j++]);
  return out;
}

const sameBlock = (a: DocsBlock, b: DocsBlock) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Diff de dos listas de bloques: alinea por id (LCS) y marca agregados,
 * quitados y cambiados; los bloques que no cambiaron vienen como 'same'.
 */
export function diffBlocks(before: DocsBlock[], after: DocsBlock[]): BlockDiff[] {
  const a = before.map((b) => b.id);
  const b = after.map((x) => x.id);
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: BlockDiff[] = [];
  let i = 0;
  let j = 0;
  const removed = (blk: DocsBlock): BlockDiff => ({ kind: 'removed', block: blk, segments: [{ op: 'del', text: blockDiffText(blk) }] });
  const added = (blk: DocsBlock): BlockDiff => ({ kind: 'added', block: blk, segments: [{ op: 'ins', text: blockDiffText(blk) }] });
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      const x = before[i];
      const y = after[j];
      if (sameBlock(x, y)) out.push({ kind: 'same', block: y, segments: [{ op: 'eq', text: blockDiffText(y) }] });
      else out.push({ kind: 'changed', block: y, segments: diffText(blockDiffText(x), blockDiffText(y)) });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push(removed(before[i++]));
    } else {
      out.push(added(after[j++]));
    }
  }
  while (i < n) out.push(removed(before[i++]));
  while (j < m) out.push(added(after[j++]));
  return out;
}

/** Resumen: cuántos bloques se agregaron, quitaron y cambiaron. */
export function diffStats(diff: BlockDiff[]): { added: number; removed: number; changed: number } {
  const s = { added: 0, removed: 0, changed: 0 };
  for (const d of diff) if (d.kind !== 'same') s[d.kind]++;
  return s;
}

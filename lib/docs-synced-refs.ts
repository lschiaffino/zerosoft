import { blockIndent, setIndent, subtreeEnd } from './docs-blocks';
import type { DocsBlock } from './docs-types';

/**
 * Bloques sincronizados en el content de una página: solo la referencia.
 * Los hijos viven en docs_synced_blocks y se agregan al leer según quién mira
 * (lib/docs-visible.ts). Así nada que lea el content crudo (búsqueda,
 * versiones, export, centro de ayuda, bots, agentes) ve lo de un bloque cuya
 * página de origen no puede abrir. Puro: lo usan el guardado y la migración.
 */

/** Saca los hijos de cada bloque sincronizado (queda el bloque con su `synced_id`). */
export function stripSyncedChildren(blocks: DocsBlock[]): DocsBlock[] {
  if (!blocks.some((b) => b.type === 'synced')) return blocks;
  const out: DocsBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    out.push(b);
    if (b.type === 'synced') i = subtreeEnd(blocks, i);
  }
  return out;
}

/** Hijos de blocks[i] con la sangría relativa al bloque (0 = hijo directo). */
export function childrenAt(blocks: DocsBlock[], i: number): DocsBlock[] {
  const end = subtreeEnd(blocks, i);
  const base = blockIndent(blocks[i]) + 1;
  return blocks.slice(i + 1, end + 1).map((b) => setIndent(b, blockIndent(b) - base));
}

/**
 * Hijos de cada bloque sincronizado de la lista (a cualquier profundidad, el
 * primero gana si un id se repite), con los sincronizados de adentro también
 * reducidos a su referencia.
 */
export function syncedChildren(blocks: DocsBlock[]): Map<string, DocsBlock[]> {
  const out = new Map<string, DocsBlock[]>();
  blocks.forEach((b, i) => {
    if (b.type !== 'synced' || !b.synced_id || out.has(b.synced_id)) return;
    out.set(b.synced_id, stripSyncedChildren(childrenAt(blocks, i)));
  });
  return out;
}

/** Ids de los sincronizados de la lista (incluidos los anidados). */
export function syncedIdsOf(blocks: DocsBlock[]): string[] {
  return [...new Set(blocks.filter((b) => b.type === 'synced' && b.synced_id).map((b) => b.synced_id!))];
}

/** Snapshot por página (docs_pages.synced_base): id → JSON de los hijos que guardó esa página. */
export function parseSyncedBase(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, s] of Object.entries(v as Record<string, unknown>)) if (typeof s === 'string') out[k] = s;
    return out;
  } catch {
    return {};
  }
}

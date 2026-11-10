/**
 * Sincronización con Notion: fusión por bloque y plan de envío. Puro.
 *
 * Cada bloque sincronizado tiene en el mapa su id de Notion y dos huellas de
 * la última sincronización: `hn` (lo de Notion, convertido) y `hl` (lo
 * guardado en Docs). Al traer una página:
 *   - cambió solo en Notion → se toma lo de Notion;
 *   - cambió solo en Docs → queda lo de Docs (sale en el envío);
 *   - cambió en los dos → gana el último en editar (hora del bloque en
 *     Notion contra la de la página en Docs); lo que pierde queda en el
 *     historial (lo guarda el motor antes de escribir);
 *   - borrado de un lado y editado del otro → gana la edición;
 *   - bloques nuevos de Notion entran después de su anterior en Notion; los
 *     nuevos de Docs quedan donde están.
 * Si el orden en Notion no cambió desde la última vez, manda el orden de
 * Docs (así un bloque movido acá se manda); si cambió, manda el de Notion.
 * Los bloques de solo lectura (`ro`: subpáginas, contenido de un bloque
 * sincronizado de Notion) siempre vienen de Notion y nunca se mandan.
 */
import type { DocsBlock } from './docs-types';
import { blockHash, canHaveChildren, isPushable, lcs, parentIndexes } from './notion-sync-convert';
import { normalizeIndents } from './docs-blocks';

export interface BlockState {
  /** Id del bloque en Notion. */
  n: string;
  /** Huella de Notion (convertido) en la última sincronización. */
  hn: string;
  /** Huella de Docs (guardado) en la última sincronización. */
  hl: string;
  /** Padre en Notion (id de Docs del bloque padre; null = la página). */
  p?: string | null;
  /** Solo lectura: subpágina, link a página o contenido sincronizado de Notion. */
  ro?: boolean;
  /** Tabla: ids de Notion de sus filas, en orden. */
  rows?: string[];
  /** Tipo del bloque en Notion. */
  t?: string;
}

export type BlockMap = Record<string, BlockState>;

export interface PageSyncState {
  blocks: BlockMap;
  /** Orden de los bloques sincronizados (ids de Docs) en la última sincronización. */
  seq: string[];
}

export interface Conflict {
  blockId: string;
  winner: 'notion' | 'docs';
  /** Texto (plano) de lo que perdió, para el registro. */
  lost: string;
}

export interface MergeInput {
  local: DocsBlock[];
  /** Bloques de Notion convertidos (ids de Docs ya asignados por el mapa). */
  remote: DocsBlock[];
  /** Huella de cada bloque de Notion (por id de Docs). */
  remoteHash: Record<string, string>;
  /** Última edición en Notion de cada bloque (ISO). */
  remoteEdited: Record<string, string>;
  /** Última edición del contenido en Docs (ISO). */
  localEdited: string;
  state: PageSyncState;
  /** Bloques de solo lectura (vienen de Notion siempre). */
  readOnly?: Set<string>;
}

export type Decision = 'remote' | 'local' | 'same' | 'drop' | 'new_remote' | 'local_only';

export interface MergeResult {
  blocks: DocsBlock[];
  /** Qué pasó con cada id (para actualizar el mapa después de guardar). */
  decisions: Record<string, Decision>;
  conflicts: Conflict[];
  /** El contenido de Docs cambia (hay que guardar). */
  changed: boolean;
}

const plain = (b: DocsBlock | undefined) => (b?.content ?? '').replace(/<[^>]*>/g, '').slice(0, 300);

export function mergeBlocks(input: MergeInput): MergeResult {
  const { local, remote, state } = input;
  const map = state.blocks;
  const ro = input.readOnly ?? new Set<string>();
  const localById = new Map(local.map((b) => [b.id, b]));
  const remoteById = new Map(remote.map((b) => [b.id, b]));
  const decisions: Record<string, Decision> = {};
  const conflicts: Conflict[] = [];
  const localTime = Date.parse(input.localEdited) || 0;

  // hn vacío: recién mandado y todavía sin leer de vuelta; lo que haya en Notion se adopta.
  const remoteChanged = (id: string) => Boolean(map[id]?.hn) && (input.remoteHash[id] ?? '') !== map[id]?.hn;
  const localChanged = (id: string) => {
    const b = localById.get(id);
    return b ? blockHash(b) !== map[id]?.hl : false;
  };

  /** Qué versión de cada bloque queda (o null si se borra). */
  const pick = new Map<string, DocsBlock | null>();
  for (const [id, entry] of Object.entries(map)) {
    const l = localById.get(id);
    const r = remoteById.get(id);
    if (!l && !r) {
      decisions[id] = 'drop';
      continue;
    }
    if (l && !r) {
      // Borrado en Notion. Editado acá: gana la edición (se vuelve a crear allá).
      if (localChanged(id) && !entry.ro) {
        decisions[id] = 'local_only';
        pick.set(id, l);
        conflicts.push({ blockId: id, winner: 'docs', lost: '' });
      } else {
        decisions[id] = 'drop';
        pick.set(id, null);
      }
      continue;
    }
    if (!l && r) {
      // Borrado acá. Editado en Notion (o solo lectura): vuelve.
      if (remoteChanged(id) || entry.ro) {
        decisions[id] = 'remote';
        pick.set(id, r);
        if (!entry.ro) conflicts.push({ blockId: id, winner: 'notion', lost: '' });
      } else {
        decisions[id] = 'local';
      }
      continue;
    }
    const rc = remoteChanged(id);
    const lc = localChanged(id);
    if (ro.has(id) || entry.ro) {
      decisions[id] = rc || lc ? 'remote' : 'same';
      pick.set(id, rc || lc ? r! : l!);
      continue;
    }
    if (rc && !lc) {
      decisions[id] = 'remote';
      pick.set(id, r!);
    } else if (!rc && lc) {
      decisions[id] = 'local';
      pick.set(id, l!);
    } else if (rc && lc) {
      const remoteTime = Date.parse(input.remoteEdited[id] ?? '') || 0;
      if (remoteTime > localTime) {
        decisions[id] = 'remote';
        pick.set(id, r!);
        conflicts.push({ blockId: id, winner: 'notion', lost: plain(l) });
      } else {
        decisions[id] = 'local';
        pick.set(id, l!);
        conflicts.push({ blockId: id, winner: 'docs', lost: plain(r) });
      }
    } else {
      decisions[id] = 'same';
      pick.set(id, l!);
    }
  }
  for (const r of remote) {
    if (map[r.id]) continue;
    decisions[r.id] = 'new_remote';
    // Un id que ya existe en Docs sin estar en el mapa (raro): gana Notion.
    pick.set(r.id, r);
  }

  // Orden: ¿cambió en Notion desde la última vez?
  const prevSeq = state.seq.filter((id) => remoteById.has(id));
  const remoteSeq = remote.map((b) => b.id).filter((id) => map[id]);
  const remoteReordered = prevSeq.join(',') !== remoteSeq.filter((id) => prevSeq.includes(id)).join(',');

  const out: DocsBlock[] = [];
  const placed = new Set<string>();
  const place = (b: DocsBlock) => {
    if (placed.has(b.id)) return;
    placed.add(b.id);
    out.push(b);
  };
  if (!remoteReordered) {
    // Orden de Docs; lo nuevo de Notion después de su anterior en Notion.
    const newRemoteAfter = new Map<string | null, DocsBlock[]>();
    remote.forEach((r, i) => {
      if (decisions[r.id] !== 'new_remote' && !(decisions[r.id] === 'remote' && !localById.has(r.id))) return;
      let prev: string | null = null;
      for (let k = i - 1; k >= 0; k--) {
        const id = remote[k].id;
        if (localById.has(id) || decisions[id] === 'new_remote' || decisions[id] === 'remote') {
          prev = id;
          break;
        }
      }
      const list = newRemoteAfter.get(prev) ?? [];
      list.push(r);
      newRemoteAfter.set(prev, list);
    });
    const flush = (after: string | null) => {
      for (const r of newRemoteAfter.get(after) ?? []) {
        place(r);
        flush(r.id);
      }
    };
    flush(null);
    for (const l of local) {
      const chosen = pick.has(l.id) ? pick.get(l.id) : l;
      if (chosen) place(chosen);
      flush(l.id);
    }
    // Lo que quedó sin lugar (su anterior se borró): al final.
    for (const list of newRemoteAfter.values()) for (const r of list) place(r);
  } else {
    // Orden de Notion; lo que solo está en Docs después de su anterior en Docs.
    const localOnlyAfter = new Map<string | null, DocsBlock[]>();
    local.forEach((l, i) => {
      if (remoteById.has(l.id)) return;
      if (pick.has(l.id) && pick.get(l.id) === null) return;
      let prev: string | null = null;
      for (let k = i - 1; k >= 0; k--) {
        const id = local[k].id;
        if (remoteById.has(id) || !(pick.has(id) && pick.get(id) === null)) {
          prev = id;
          break;
        }
      }
      const list = localOnlyAfter.get(prev) ?? [];
      list.push(pick.get(l.id) ?? l);
      localOnlyAfter.set(prev, list);
    });
    const flush = (after: string | null) => {
      for (const l of localOnlyAfter.get(after) ?? []) {
        place(l);
        flush(l.id);
      }
    };
    flush(null);
    for (const r of remote) {
      const chosen = pick.has(r.id) ? pick.get(r.id) : r;
      if (chosen === null) continue;
      if (decisions[r.id] === 'local' && !localById.has(r.id)) continue; // borrado acá, sin cambios allá
      place(chosen ?? r);
      flush(r.id);
    }
    for (const list of localOnlyAfter.values()) for (const l of list) place(l);
  }
  for (const l of local) if (!(l.id in decisions) && !map[l.id]) decisions[l.id] = 'local_only';

  const blocks = normalizeIndents(out);
  const changed = JSON.stringify(blocks) !== JSON.stringify(local);
  return { blocks, decisions, conflicts, changed };
}

/**
 * Mapa después de guardar lo fusionado: lo que vino de Notion queda con las
 * dos huellas al día; lo que cambió solo en Docs conserva su `hl` viejo
 * (así el envío lo ve como cambiado).
 */
export function stateAfterMerge(
  prev: PageSyncState,
  merge: Pick<MergeResult, 'decisions'>,
  saved: DocsBlock[],
  remoteHash: Record<string, string>,
  remoteInfo: Record<string, { n: string; ro?: boolean; rows?: string[]; p?: string | null; t?: string }>,
): PageSyncState {
  const savedById = new Map(saved.map((b) => [b.id, b]));
  const blocks: BlockMap = {};
  for (const [id, d] of Object.entries(merge.decisions)) {
    const info = remoteInfo[id];
    const old = prev.blocks[id];
    const s = savedById.get(id);
    if (d === 'drop' || d === 'local_only') continue;
    if (!info) {
      if (old && d === 'local') blocks[id] = old;
      continue;
    }
    const base = { n: info.n, hn: remoteHash[id] ?? '', p: info.p ?? null, ...(info.t ? { t: info.t } : {}), ...(info.ro ? { ro: true } : {}), ...(info.rows ? { rows: info.rows } : {}) };
    if (d === 'local') blocks[id] = { ...base, hl: old?.hl ?? '' };
    else blocks[id] = { ...base, hl: s ? blockHash(s) : (old?.hl ?? '') };
  }
  const seq = saved.map((b) => b.id).filter((id) => blocks[id]);
  return { blocks, seq };
}

// ---------- Envío (Docs → Notion) ----------

export interface PushPlan {
  /** Bloques a borrar en Notion (solo los de más arriba: los hijos se van con el padre). */
  deletes: Array<{ id: string; n: string }>;
  /** Bloques a volver a crear (cambiaron de padre, de tipo o de lugar). */
  recreate: Set<string>;
  /** Padre efectivo (id de Docs, null = página) de cada bloque que se manda. */
  parentOf: Map<string, string | null>;
  /** Bloques que se mandan, en orden. */
  order: string[];
}

/**
 * Qué hay que borrar y qué hay que recrear antes de mandar una página:
 *   - borrados en Docs (los que se mandaban), salvo los de solo lectura;
 *   - recreados: cambiaron de padre, de tipo, o de orden entre hermanos
 *     (Notion no mueve bloques por API: se borran y se crean de nuevo,
 *     con sus hijos), o un bloque nuevo tiene que ir primero en un padre
 *     que ya tiene hijos (Notion solo agrega "después de").
 */
export function planPush(local: DocsBlock[], state: PageSyncState): PushPlan {
  const map = state.blocks;
  // Lo que Notion no tiene queda afuera con su subárbol.
  const kept: DocsBlock[] = [];
  let skipBelow = -1;
  for (const b of local) {
    const d = b.indent ?? 0;
    if (skipBelow >= 0 && d > skipBelow) continue;
    skipBelow = -1;
    if (!isPushable(b) && !map[b.id]?.ro) {
      skipBelow = d;
      continue;
    }
    kept.push(b);
  }
  const parents = parentIndexes(kept, true);
  const parentOf = new Map<string, string | null>();
  kept.forEach((b, i) => parentOf.set(b.id, parents[i] >= 0 ? kept[parents[i]].id : null));

  const recreate = new Set<string>();
  const children = new Map<string | null, string[]>();
  for (const b of kept) {
    const p = parentOf.get(b.id) ?? null;
    const list = children.get(p) ?? [];
    list.push(b.id);
    children.set(p, list);
  }
  for (const b of kept) {
    const e = map[b.id];
    if (!e || e.ro) continue;
    const p = parentOf.get(b.id) ?? null;
    if ((e.p ?? null) !== p) recreate.add(b.id);
    if (e.t && e.t !== notionTypeOf(b)) recreate.add(b.id);
  }
  // Orden entre hermanos: lo que salió de la secuencia común se recrea.
  for (const [, ids] of children) {
    const existing = ids.filter((id) => map[id] && !recreate.has(id));
    const prev = state.seq.filter((id) => existing.includes(id));
    const keep = lcs(existing, prev);
    for (const id of existing) if (!keep.has(id) && !map[id].ro) recreate.add(id);
    // Bloque nuevo primero y hermanos ya en Notion: se recrean los hermanos.
    const first = ids[0];
    if (first && (!map[first] || recreate.has(first))) {
      for (const id of ids) if (map[id] && !map[id].ro) recreate.add(id);
    }
  }
  // Recrear un bloque recrea su subárbol (borrar en Notion se lleva a los hijos).
  const index = new Map(kept.map((b, i) => [b.id, i]));
  for (const id of [...recreate]) {
    const i = index.get(id)!;
    const d = kept[i].indent ?? 0;
    for (let j = i + 1; j < kept.length && (kept[j].indent ?? 0) > d; j++) if (map[kept[j].id]) recreate.add(kept[j].id);
  }
  const keptIds = new Set(kept.map((b) => b.id));
  const gone = Object.keys(map).filter((id) => (!keptIds.has(id) && !map[id].ro) || recreate.has(id));
  const goneSet = new Set(gone);
  // Solo los de más arriba (por el padre que tenían en Notion).
  const deletes = gone.filter((id) => !hasGoneAncestor(id, map, goneSet)).map((id) => ({ id, n: map[id].n }));
  return { deletes, recreate, parentOf, order: kept.map((b) => b.id) };
}

function hasGoneAncestor(id: string, map: BlockMap, gone: Set<string>): boolean {
  let p = map[id]?.p ?? null;
  for (let i = 0; p && i < 50; i++) {
    if (gone.has(p)) return true;
    p = map[p]?.p ?? null;
  }
  return false;
}

/** Tipo de Notion que le corresponde a un bloque de Docs (para detectar cambios de tipo). */
export function notionTypeOf(b: DocsBlock): string {
  switch (b.type) {
    case 'todo':
      return 'to_do';
    case 'heading':
      return `heading_${b.level ?? 1}`;
    case 'toc':
      return 'table_of_contents';
    case 'columns':
      return 'column_list';
    default:
      return b.type;
  }
}

/** Para los tests y el motor: ¿puede este bloque de Docs llevar hijos en Notion? */
export { canHaveChildren };

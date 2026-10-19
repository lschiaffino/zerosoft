/**
 * Board: lógica pura de sincronización del editor (sin React ni Excalidraw),
 * para poder testearla: merge por elemento ante un 409, borradores locales y
 * el último guardado al salir del editor.
 */
import type { BoardScene } from './boards-types';

export type SyncEl = { id: string; version?: number; versionNonce?: number; isDeleted?: boolean; type?: string; fileId?: string | null };

/** Firma de `reconcileElements` de Excalidraw (tipos laxos). */
export type Reconcile = (local: readonly unknown[], remote: readonly unknown[], appState: Record<string, unknown>) => unknown[];

/** Versión de cada elemento en la última escena que sabemos que el servidor tiene. */
export type BaseVersions = Map<string, number>;

export function baseFrom(elements: readonly unknown[]): BaseVersions {
  const map: BaseVersions = new Map();
  for (const e of elements as SyncEl[]) if (e && typeof e.id === 'string' && !e.isDeleted) map.set(e.id, e.version ?? 0);
  return map;
}

export interface MergeResult {
  /** Elementos combinados, con lo ambiguo resuelto a favor de lo local. */
  elements: unknown[];
  /** Ids donde un lado editó y el otro borró: no se puede decidir solo. */
  ambiguous: string[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

/**
 * Combina la escena local con la del servidor elemento por elemento.
 *
 * - Lo que solo cambió de un lado se toma de ese lado (reconcileElements decide
 *   por `version`, y empata por `versionNonce`).
 * - Lo que otro borró y acá no se tocó desaparece; lo nuevo de cada lado se suma.
 * - Si acá se editó algo que el otro borró, o se borró algo que el otro editó,
 *   queda en `ambiguous` (se resuelve a favor de lo local hasta que la persona elija).
 *
 * `base` son las versiones de la última escena sincronizada; sin base (p. ej. un
 * borrador viejo) lo que falta en el servidor se trata como nuevo y se conserva.
 */
export function mergeBoardScenes(opts: {
  local: readonly unknown[];
  localAppState: Record<string, unknown>;
  localFiles: Record<string, unknown>;
  server: BoardScene;
  base: BaseVersions | null;
  baseBackground?: unknown;
  reconcile: Reconcile;
}): MergeResult {
  const { local, server, base, reconcile } = opts;
  const serverEls = server.elements as SyncEl[];
  const serverById = new Map(serverEls.map((e) => [e.id, e]));
  const ambiguous: string[] = [];
  const kept: SyncEl[] = [];

  for (const el of local as SyncEl[]) {
    const remote = serverById.get(el.id);
    const baseVersion = base?.get(el.id);
    if (!remote) {
      if (el.isDeleted) {
        kept.push(el);
        continue;
      }
      if (baseVersion === undefined) {
        // Nuevo de este lado (o sin base para saberlo): se conserva.
        kept.push(el);
        continue;
      }
      if ((el.version ?? 0) <= baseVersion) continue; // lo borraron allá y acá no se tocó
      ambiguous.push(el.id); // lo editamos acá y lo borraron allá
      kept.push(el);
      continue;
    }
    if (el.isDeleted && baseVersion !== undefined && (remote.version ?? 0) > baseVersion) {
      // Lo borramos acá y lo editaron allá: reconcile elegiría por número de versión.
      ambiguous.push(el.id);
    }
    kept.push(el);
  }

  let elements = reconcile(kept, serverEls, opts.localAppState) as SyncEl[];
  if (ambiguous.length) {
    // Lo ambiguo queda con la versión local, gane quien gane por número.
    const localById = new Map((local as SyncEl[]).map((e) => [e.id, e]));
    const amb = new Set(ambiguous);
    elements = elements.map((e) => (amb.has(e.id) ? (localById.get(e.id) ?? e) : e));
  }

  const localBg = opts.localAppState.viewBackgroundColor;
  const bgChangedHere = opts.baseBackground === undefined || localBg !== opts.baseBackground;
  const appState = {
    ...server.appState,
    viewBackgroundColor: bgChangedHere && localBg !== undefined ? localBg : server.appState.viewBackgroundColor,
  };
  return { elements, ambiguous, appState, files: { ...server.files, ...opts.localFiles } };
}

// ---------------------------------------------------------------------------
// Borradores locales: lo que no llegó al servidor sobrevive a cerrar la pestaña.

export interface BoardDraft {
  /** Versión del servidor sobre la que se hicieron los cambios. */
  baseVersion: number;
  scene: BoardScene;
  savedAt: number;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const draftKey = (boardId: string) => `zs:board-draft:${boardId}`;
/** Un borrador de hace más de dos semanas ya no se ofrece. */
const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function writeDraft(storage: StorageLike | null | undefined, boardId: string, draft: BoardDraft): boolean {
  if (!storage) return false;
  try {
    storage.setItem(draftKey(boardId), JSON.stringify(draft));
    return true;
  } catch {
    return false; // cuota llena o storage bloqueado
  }
}

export function readDraft(storage: StorageLike | null | undefined, boardId: string, now = Date.now()): BoardDraft | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(draftKey(boardId));
    if (!raw) return null;
    const d = JSON.parse(raw) as BoardDraft;
    if (!d || typeof d.baseVersion !== 'number' || !d.scene || !Array.isArray(d.scene.elements)) return null;
    if (now - (d.savedAt ?? 0) > DRAFT_TTL_MS) {
      storage.removeItem(draftKey(boardId));
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

export function clearDraft(storage: StorageLike | null | undefined, boardId: string): void {
  try {
    storage?.removeItem(draftKey(boardId));
  } catch {
    /* sin storage */
  }
}

/** Firma barata: cambia con cualquier edición (cada edición sube `version`). */
export function sceneSignature(elements: readonly unknown[], bg: unknown, fileCount: number): string {
  let sum = 0;
  let live = 0;
  for (const e of elements as SyncEl[]) {
    if (e.isDeleted) continue;
    live++;
    sum += e.version ?? 0;
  }
  return `${live}:${sum}:${String(bg)}:${fileCount}`;
}

/** ¿El borrador trae algo distinto de lo que hay en el servidor? */
export function draftDiffers(draft: BoardDraft, server: BoardScene): boolean {
  return (
    sceneSignature(draft.scene.elements, draft.scene.appState.viewBackgroundColor, Object.keys(draft.scene.files).length) !==
    sceneSignature(server.elements, server.appState.viewBackgroundColor, Object.keys(server.files).length)
  );
}

// ---------------------------------------------------------------------------
// Último guardado al salir del editor.

export type PutResult = { ok: true; version: number } | { ok: false; status: number };

/**
 * Guarda lo pendiente al desmontar el editor. Si hay un guardado en vuelo lo
 * espera y usa la versión que devolvió: mandarlo en paralelo con la misma
 * versión base terminaba en un 409 que nadie veía y se perdía lo último.
 * El borrador local se escribe antes y solo se borra si el servidor aceptó.
 */
export async function flushOnLeave(opts: {
  inFlight: Promise<unknown> | null;
  getPending: () => BoardScene | null;
  isBlocked: () => boolean;
  getVersion: () => number;
  put: (scene: BoardScene, version: number) => Promise<PutResult>;
  saveDraft: (scene: BoardScene, baseVersion: number) => void;
  dropDraft: () => void;
}): Promise<'nothing' | 'saved' | 'kept_draft'> {
  if (opts.inFlight) await opts.inFlight.catch(() => {});
  const scene = opts.getPending();
  if (!scene) return 'nothing';
  const version = opts.getVersion();
  opts.saveDraft(scene, version);
  if (opts.isBlocked()) return 'kept_draft';
  try {
    const res = await opts.put(scene, version);
    if (res.ok) {
      opts.dropDraft();
      return 'saved';
    }
  } catch {
    /* sin red: queda el borrador */
  }
  return 'kept_draft';
}

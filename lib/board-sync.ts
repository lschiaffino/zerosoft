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
// Sondeo de cambios de otros (no hay tiempo real).

/** Cada cuánto el editor pregunta la versión de la pizarra (con la pestaña visible). */
export const REMOTE_POLL_MS = 12_000;

export type RemoteAction = 'none' | 'apply' | 'notify';

/**
 * Qué hacer cuando el sondeo trae la versión del servidor:
 * - igual o más vieja que la local: nada;
 * - con un guardado en vuelo o el aviso de conflicto abierto: nada (el 409 ya combina);
 * - con cambios locales que se van a guardar: nada, el guardado da 409 y combina;
 * - con cambios locales trabados (p. ej. pizarra muy grande): aviso para combinar o recargar;
 * - sin cambios locales: se aplica la escena del servidor sola.
 */
export function remoteAction(o: {
  remoteVersion: number;
  localVersion: number;
  pending: boolean;
  inFlight: boolean;
  /** Motivo por el que no se guarda ('conflict', 'too_large') o null. */
  blocked: string | null;
}): RemoteAction {
  if (o.remoteVersion <= o.localVersion) return 'none';
  if (o.inFlight || o.blocked === 'conflict') return 'none';
  if (o.blocked) return 'notify';
  if (o.pending) return 'none';
  return 'apply';
}

/**
 * Lo ambiguo de un merge, resuelto a favor del servidor: lo que allá se borró se
 * va y lo que allá se editó vuelve. Es para aplicar cambios de otro sin nada
 * local pendiente; ahí un "editado acá" solo puede ser Excalidraw normalizando
 * al cargar (p. ej. medir de nuevo un texto), que sube la versión sin edición real.
 */
export function ambiguousToServer(merge: Pick<MergeResult, 'elements' | 'ambiguous'>, serverElements: readonly unknown[]): unknown[] {
  if (!merge.ambiguous.length) return merge.elements;
  const amb = new Set(merge.ambiguous);
  const serverById = new Map((serverElements as SyncEl[]).map((e) => [e.id, e]));
  const out: unknown[] = [];
  for (const e of merge.elements as SyncEl[]) {
    if (!amb.has(e.id)) out.push(e);
    else if (serverById.has(e.id)) out.push(serverById.get(e.id));
  }
  return out;
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

/**
 * Qué hacer con un borrador al abrir: 'restore' si se hizo sobre la misma
 * versión que se abre (nadie guardó otra desde entonces: es lo último de esta
 * persona y vuelve solo), 'ask' si el servidor cambió (se ofrece recuperarlo),
 * 'drop' si no trae nada distinto.
 */
export function draftAction(draft: BoardDraft | null, server: BoardScene, serverVersion: number): 'none' | 'drop' | 'restore' | 'ask' {
  if (!draft) return 'none';
  if (!draftDiffers(draft, server)) return 'drop';
  return draft.baseVersion === serverVersion ? 'restore' : 'ask';
}

// ---------------------------------------------------------------------------
// Pizarras creadas sin red: viven en el dispositivo hasta que vuelve la red.

/** Pizarra nueva que todavía no existe en el servidor (su escena va en el borrador de su id). */
export interface LocalBoard {
  id: string;
  name: string;
  folderId: string | null;
  createdAt: number;
}

/** La versión con la que nace una pizarra en el servidor (lib/boards.ts, createBoard). */
export const NEW_BOARD_VERSION = 1;

const LOCAL_PREFIX = 'zs:board-new:';
export const localBoardKey = (id: string) => `${LOCAL_PREFIX}${id}`;

type ListableStorage = StorageLike & Pick<Storage, 'key' | 'length'>;

export function writeLocalBoard(storage: StorageLike | null | undefined, board: LocalBoard): boolean {
  if (!storage) return false;
  try {
    storage.setItem(localBoardKey(board.id), JSON.stringify(board));
    return true;
  } catch {
    return false;
  }
}

export function readLocalBoard(storage: StorageLike | null | undefined, id: string): LocalBoard | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(localBoardKey(id));
    if (!raw) return null;
    const b = JSON.parse(raw) as LocalBoard;
    return b && b.id === id && typeof b.name === 'string' ? { id, name: b.name, folderId: b.folderId ?? null, createdAt: Number(b.createdAt) || 0 } : null;
  } catch {
    return null;
  }
}

/** Las pizarras de este dispositivo que esperan la red, la más nueva primero. */
export function listLocalBoards(storage: ListableStorage | null | undefined): LocalBoard[] {
  if (!storage) return [];
  const out: LocalBoard[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(LOCAL_PREFIX)) continue;
      const b = readLocalBoard(storage, key.slice(LOCAL_PREFIX.length));
      if (b) out.push(b);
    }
  } catch {
    return out;
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export function clearLocalBoard(storage: StorageLike | null | undefined, id: string): void {
  try {
    storage?.removeItem(localBoardKey(id));
  } catch {
    /* sin storage */
  }
}

type DoFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Crea en el servidor una pizarra hecha sin red, con su id: si ya llegó, el
 * servidor responde la misma (un reintento no la duplica). Lo dibujado sigue
 * en el borrador de su id. 'offline' si no hubo red (todo queda como estaba);
 * 'failed' si el servidor la rechazó (queda en el dispositivo).
 */
export async function createLocalBoard(
  storage: StorageLike | null | undefined,
  id: string,
  doFetch: DoFetch = (url, init) => fetch(url, init),
): Promise<{ result: 'created'; version: number } | { result: 'offline' | 'failed' | 'missing' }> {
  const local = readLocalBoard(storage, id);
  if (!local) return { result: 'missing' };
  try {
    const res = await doFetch('/api/boards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, name: local.name, folderId: local.folderId }),
    });
    if (!res.ok) return { result: 'failed' };
    const created = (await res.json()) as { version?: number };
    clearLocalBoard(storage, id);
    return { result: 'created', version: created.version ?? NEW_BOARD_VERSION };
  } catch {
    return { result: 'offline' };
  }
}

/** Sube una pizarra creada sin red y lo dibujado en ella (desde la lista, sin el editor abierto). */
export async function syncLocalBoard(
  storage: StorageLike | null | undefined,
  id: string,
  doFetch: DoFetch = (url, init) => fetch(url, init),
): Promise<'synced' | 'offline' | 'failed' | 'missing'> {
  const created = await createLocalBoard(storage, id, doFetch);
  if (created.result !== 'created') return created.result;
  try {
    const draft = readDraft(storage, id);
    if (draft && draft.scene.elements.length > 0) {
      const put = await doFetch(`/api/boards/${encodeURIComponent(id)}/scene`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: created.version, scene: draft.scene }),
      });
      // Si no entró, el borrador queda: el editor lo ofrece (o lo vuelve a mandar) al abrirla.
      if (put.ok) clearDraft(storage, id);
    }
  } catch {
    /* sin red justo después de crearla: lo dibujado sigue en el borrador */
  }
  return 'synced';
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

import type { DocsBlock } from './docs-types';
import type { DocsFileKind } from './docs-files';
import { blockIndent, setIndent } from './docs-blocks';

/**
 * Subidas en curso del editor (Docs y Notes). Cada archivo tiene un lugar en
 * el documento desde que se elige, se pega o se suelta: ahí se dibuja un
 * esqueleto del tamaño final (imagen, video o la ficha del archivo) con el
 * progreso y Cancelar. Al terminar, el bloque real ocupa ese mismo lugar; si
 * falla, el esqueleto pasa a un error con Reintentar y Quitar.
 *
 * Las subidas no van al documento guardado: viven acá, afuera de los bloques
 * (no se guardan, no viajan a la coedición ni entran al deshacer). Cada una se
 * ubica por id de bloque, como el resto del editor, así la persona puede
 * seguir escribiendo mientras sube.
 */

export type UploadStatus = 'queued' | 'uploading' | 'error';

/** Motivo de un error (clave de i18n en docs.editor.upload.*). */
export type UploadErrorCode = 'tooLarge' | 'typeNotAllowed' | 'storageUnavailable' | 'rateLimited' | 'failed';

export interface PendingUpload {
  /** Id del bloque que va a quedar (el esqueleto usa el mismo). */
  id: string;
  /** Subidas de un mismo gesto (varios archivos a la vez) van una debajo de la otra. */
  group: string;
  /** Bloque después del cual va (null = al principio de la página). */
  anchorId: string | null;
  /**
   * Línea vacía sobre la que se pidió ("/imagen" o pegar en una línea vacía):
   * el bloque va justo arriba y la línea queda debajo, con el foco, para
   * seguir escribiendo. Así nada se esconde mientras sube.
   */
  beforeId: string | null;
  /** Nivel pedido (un drop adentro de una columna); sin él, el del ancla. */
  indent?: number;
  /** Lo que se va a ver (según el tipo del archivo local); al terminar manda el del servidor. */
  kind: DocsFileKind;
  /** Lo que se pidió ("/video", "/imagen"), si vino de un comando. */
  requested?: DocsFileKind;
  name: string;
  size: number;
  /** Medidas del archivo local (imagen o video), para reservar el lugar exacto. */
  width?: number;
  height?: number;
  status: UploadStatus;
  /** 0 a 100. */
  progress: number;
  error?: UploadErrorCode;
  /** Tope de tamaño de la ruta, para decirlo en el error "muy grande". */
  max?: number;
}

/** Reintentar tiene sentido salvo cuando el archivo en sí no entra. */
export function canRetry(u: PendingUpload): boolean {
  return u.status === 'error' && u.error !== 'tooLarge' && u.error !== 'typeNotAllowed';
}

export interface UploadQueue {
  get(): readonly PendingUpload[];
  find(id: string): PendingUpload | undefined;
  subscribe(fn: () => void): () => void;
  add(items: PendingUpload[]): void;
  start(id: string): void;
  progress(id: string, percent: number): void;
  /** Medidas del archivo local, cuando se conocen (el esqueleto toma esa forma). */
  measure(id: string, width: number, height: number): void;
  fail(id: string, error: UploadErrorCode, max?: number): void;
  retry(id: string): void;
  remove(id: string): void;
  /**
   * Subida terminada y bloque ya ubicado con `placedId`: sale de la cola y las
   * que esperan detrás en el mismo grupo pasan a ir debajo de ese bloque.
   */
  done(id: string, placedId: string): void;
}

export function createUploadQueue(): UploadQueue {
  let items: PendingUpload[] = [];
  const listeners = new Set<() => void>();
  const set = (next: PendingUpload[]) => {
    items = next;
    listeners.forEach((fn) => fn());
  };
  const patch = (id: string, p: Partial<PendingUpload>) => {
    if (!items.some((u) => u.id === id)) return;
    set(items.map((u) => (u.id === id ? { ...u, ...p } : u)));
  };
  return {
    get: () => items,
    find: (id) => items.find((u) => u.id === id),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    add(next) {
      if (next.length) set([...items, ...next]);
    },
    start: (id) => patch(id, { status: 'uploading', progress: 0, error: undefined }),
    progress(id, percent) {
      const u = items.find((x) => x.id === id);
      const p = Math.max(0, Math.min(100, Math.round(percent)));
      // El progreso no retrocede (las partes de Blob pueden informar fuera de orden).
      if (u && u.status === 'uploading' && p > u.progress) patch(id, { progress: p });
    },
    measure(id, width, height) {
      if (width > 0 && height > 0) patch(id, { width, height });
    },
    fail: (id, error, max) => patch(id, { status: 'error', error, ...(max ? { max } : {}) }),
    retry: (id) => patch(id, { status: 'queued', progress: 0, error: undefined }),
    remove(id) {
      if (items.some((u) => u.id === id)) set(items.filter((u) => u.id !== id));
    },
    done(id, placedId) {
      const u = items.find((x) => x.id === id);
      if (!u) return;
      const at = items.indexOf(u);
      set(
        items
          .filter((x) => x.id !== id)
          .map((x, i) =>
            // Solo las que siguen en el grupo y no fallaron: una con error de antes queda donde estaba.
            x.group === u.group && i >= at && x.status !== 'error' ? { ...x, anchorId: placedId } : x,
          ),
      );
    },
  };
}

/**
 * Ubica el bloque subido en el documento: justo arriba de la línea `beforeId`
 * si sigue ahí (con su nivel); si no, después de `anchorId` (al final si el
 * ancla se borró mientras subía, al principio si es null). Toma el nivel
 * pedido o el del ancla (adentro de una columna o un sincronizado si el ancla
 * es el contenedor).
 */
export function placeUploadedBlock(
  blocks: DocsBlock[],
  block: DocsBlock,
  at: { anchorId: string | null; beforeId: string | null; indent?: number },
): DocsBlock[] {
  const next = [...blocks];
  const bi = at.beforeId ? next.findIndex((b) => b.id === at.beforeId) : -1;
  if (bi !== -1) {
    next.splice(bi, 0, setIndent(block, blockIndent(next[bi])));
    return next;
  }
  const ai = at.anchorId ? next.findIndex((b) => b.id === at.anchorId) : -1;
  const anchor = ai === -1 ? null : next[ai];
  const level =
    at.indent ?? (anchor ? blockIndent(anchor) + (anchor.type === 'column' || anchor.type === 'synced' ? 1 : 0) : 0);
  const placed = ai === -1 && at.indent === undefined ? block : setIndent(block, level);
  next.splice(at.anchorId === null ? 0 : ai === -1 ? next.length : ai + 1, 0, placed);
  return next;
}

/**
 * Dónde se dibuja cada esqueleto: arriba de una línea (`before`), debajo de
 * un bloque (`after`), al principio de la página (`top`) o, si su ancla ya no
 * está, al final (`end`). En cada lugar, en el orden en que se eligieron.
 */
export function uploadSlots(blocks: readonly DocsBlock[], pending: readonly PendingUpload[]) {
  const ids = new Set(blocks.map((b) => b.id));
  const before = new Map<string, PendingUpload[]>();
  const after = new Map<string, PendingUpload[]>();
  const top: PendingUpload[] = [];
  const end: PendingUpload[] = [];
  const push = (m: Map<string, PendingUpload[]>, k: string, u: PendingUpload) => m.set(k, [...(m.get(k) ?? []), u]);
  for (const u of pending) {
    if (u.beforeId && ids.has(u.beforeId)) push(before, u.beforeId, u);
    else if (u.anchorId === null) top.push(u);
    else if (ids.has(u.anchorId)) push(after, u.anchorId, u);
    else end.push(u);
  }
  return { before, after, top, end };
}

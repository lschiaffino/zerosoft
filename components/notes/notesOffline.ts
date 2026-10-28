/**
 * Notes offline: copia de las notas en IndexedDB y cola de cambios hechos
 * sin red.
 *
 * - Una base por persona y workspace (`zs-notes:<persona>:<workspace>`).
 *   La app solo la abre con la identidad confirmada (confirmIdentity): con
 *   red, el servidor dice quién es la sesión; sin red, la cookie zs_who
 *   actual tiene que ser la que se guardó al confirmar. clearOfflineData
 *   (lib/offline-queue.ts) las borra al cerrar sesión.
 * - `notes`: resúmenes de todas las notas propias y, cuando ya bajaron, sus
 *   bloques (sync con /api/notes/sync), con `server_updated_at`: la versión
 *   del servidor sobre la que se edita sin red. Las bloqueadas guardan el
 *   sobre cifrado: se abren offline con la contraseña.
 * - `ops`: altas y cambios hechos sin red, cada uno con id propio (opId) y
 *   revisión (rev). Al volver la red se reenvían en orden (replayOutbox):
 *   un cambio que choca con otro (o sin versión conocida) no pisa nada y
 *   queda como copia; un error del servidor (5xx, 429) se reintenta; un
 *   403/404 queda apartado (stuck) para copiar o descartar.
 * - `files`: grabaciones de audio que todavía no se subieron.
 *
 * La lógica pura se testea en tests/unit/notes-parity.test.ts. Solo cliente.
 */
import { parseNoteQuery } from '@/lib/notes-query';
import type { DocsBlock } from '@/lib/docs-types';
import type { NoteDetail, NoteSummary, NotebookInfo, NotesSort, TagInfo } from '@/lib/notes-types';
import type { NotesFilter } from './notes-ui';

export const NOTES_DB_PREFIX = 'zs-notes';
/** Una identidad confirmada con red vale lo que dura la sesión (30 días). */
export const NOTES_IDENTITY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface OfflineOwner {
  userId: string;
  ws: string;
}

export function notesDbName(o: OfflineOwner): string {
  const safe = (x: string) => x.replace(/[^\w-]/g, '_').slice(0, 80);
  return `${NOTES_DB_PREFIX}:${safe(o.userId)}:${safe(o.ws)}`;
}

/** Nota guardada en el dispositivo: el resumen y, si ya bajó, los bloques. */
export type CachedNote = NoteSummary &
  Partial<Pick<NoteDetail, 'content' | 'lock' | 'share_token' | 'reminder'>> & {
    full?: boolean;
    /** updated_at del servidor sobre el que se apoya lo que se edite sin red. */
    server_updated_at?: string;
  };

interface OpBase {
  /** Id propio de la operación (estable aunque se fusionen cambios). */
  opId: string;
  /** Sube cada vez que la operación cambia: si cambió mientras se mandaba, no se borra. */
  rev: number;
  id: string;
  at: number;
}
export type OutboxOp =
  | (OpBase & { kind: 'create'; body: Record<string, unknown> })
  | (OpBase & { kind: 'patch'; patch: Record<string, unknown>; base: string | null });

/** Cambio que el servidor rechazó (403/404/400): se guarda para copiar o descartar. */
export interface StuckOp {
  opId: string;
  id: string;
  title: string;
  text: string;
  status: number;
  at: number;
}

/** Grabación que espera a subirse a su nota. */
export interface PendingFile {
  fileId: string;
  noteId: string;
  name: string;
  type: string;
  blob: Blob;
  at: number;
}

const newOpId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

// ---------- Identidad ----------

export interface IdentityRecord {
  who: string;
  at: number;
}

/**
 * ¿Se puede usar la copia sin red? Solo si la cookie de sesión actual
 * (zs_who) es la que se guardó cuando el servidor confirmó a esta persona,
 * y hace menos de lo que dura la sesión. Sin cookie (sesión vencida o
 * cerrada) o con la de otra persona: no.
 */
export function identityMatches(rec: IdentityRecord | null, who: string | null, now = Date.now()): boolean {
  if (!rec || !who || !rec.who) return false;
  if (now - rec.at > NOTES_IDENTITY_MAX_AGE_MS) return false;
  return rec.who === who;
}

// ---------- Lógica pura ----------

/** ¿La nota entra en el filtro de la lista? (la misma regla que el servidor). */
export function matchesFilter(n: CachedNote, f: NotesFilter, notebooks: NotebookInfo[]): boolean {
  if (f.kind === 'trash') return n.trashed;
  if (n.trashed) return false;
  if (f.kind === 'pinned') return n.pinned;
  if (f.kind === 'shared') return false;
  if (f.kind === 'notebook') return n.notebook_id === f.id;
  if (f.kind === 'stack') return notebooks.some((nb) => nb.id === n.notebook_id && nb.stack === f.stack);
  if (f.kind === 'tag') return n.tags.some((t) => t === f.tag || t.startsWith(`${f.tag}/`));
  return true;
}

function plainText(n: CachedNote): string {
  if (n.locked) return n.title;
  const body = (n.content ?? []).map((b) => (b.content ?? '').replace(/<[^>]*>/g, '')).join('\n');
  return `${n.title}\n${body || n.snippet}`;
}

/** Texto plano de bloques (para copiar un cambio rechazado). */
export function blocksPlain(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  return (blocks as DocsBlock[])
    .map((b) => (b.content ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''))
    .filter(Boolean)
    .join('\n');
}

/**
 * Lista offline: filtro, búsqueda simple (todas las palabras, más tag: e
 * intitle:) y orden, sobre la copia del dispositivo.
 */
export function offlineList(all: CachedNote[], f: NotesFilter, q: string, sort: NotesSort, notebooks: NotebookInfo[]): CachedNote[] {
  const query = q.trim() ? parseNoteQuery(q) : null;
  const terms = query?.terms ?? [];
  const rows = all.filter((n) => {
    if (!matchesFilter(n, f, notebooks)) return false;
    if (!query) return true;
    const hay = plainText(n).toLowerCase();
    if (!terms.every((t) => hay.includes(t.toLowerCase()))) return false;
    if (query.tags.some((t) => !n.tags.some((x) => (t.endsWith('*') ? x.startsWith(t.slice(0, -1)) : x === t)))) return false;
    if (query.notTags.some((t) => n.tags.includes(t))) return false;
    if (query.intitle.some((t) => !n.title.toLowerCase().includes(t.toLowerCase()))) return false;
    return true;
  });
  const pin = (a: CachedNote, b: CachedNote) => (f.kind === 'trash' ? 0 : Number(b.pinned) - Number(a.pinned));
  return rows.sort((a, b) => {
    const p = pin(a, b);
    if (p) return p;
    if (sort === 'created') return b.created_at.localeCompare(a.created_at);
    if (sort === 'title') return (a.title || '￿').localeCompare(b.title || '￿');
    return b.updated_at.localeCompare(a.updated_at);
  });
}

/** Operación nueva (con opId y rev 0). */
export function makeOp(
  op: { kind: 'create'; id: string; body: Record<string, unknown> } | { kind: 'patch'; id: string; patch: Record<string, unknown>; base: string | null },
  at = Date.now(),
): OutboxOp {
  return { ...op, opId: newOpId(), rev: 0, at } as OutboxOp;
}

/**
 * Suma un cambio a la cola: varios guardados seguidos de la misma nota
 * quedan en uno (con la base del primero, la que vio el servidor), y un
 * cambio sobre una nota creada offline se mete en el alta. Lo que cambia
 * conserva su opId y sube la revisión.
 */
export function mergeIntoOutbox(ops: OutboxOp[], next: OutboxOp): OutboxOp[] {
  if (next.kind === 'create') return [...ops.filter((o) => o.id !== next.id || o.kind !== 'create'), next];
  const create = ops.find((o) => o.kind === 'create' && o.id === next.id);
  if (create && create.kind === 'create') {
    const { trashed, ...rest } = next.patch;
    const merged: OutboxOp = { ...create, body: { ...create.body, ...rest }, rev: create.rev + 1 };
    const out = ops.map((o) => (o === create ? merged : o));
    // Mandar a la papelera algo creado offline: va después del alta.
    return trashed === undefined ? out : [...out, { ...next, patch: { trashed }, base: null }];
  }
  const prev = [...ops]
    .reverse()
    .find((o) => o.kind === 'patch' && o.id === next.id && !('trashed' in o.patch) && !('trashed' in next.patch));
  if (prev && prev.kind === 'patch') {
    const merged: OutboxOp = { ...prev, patch: { ...prev.patch, ...next.patch }, at: next.at, rev: prev.rev + 1 };
    return ops.map((o) => (o === prev ? merged : o));
  }
  return [...ops, next];
}

export interface ReplayResult {
  done: number;
  /** Cambios que chocaron con otra edición: se guardaron como copia. */
  copies: number;
  /** Rechazados por el servidor (403/404/400): apartados para copiar o descartar. */
  stuck: number;
  /** Quedan en la cola (sin red o el servidor falló): se reintenta. */
  remaining: number;
  /** El corte fue por el servidor (5xx/429), no por la red: reintentar con espera. */
  retry: boolean;
}

export interface ReplayDeps {
  fetch: (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
  /** La operación se resolvió; `serverUpdatedAt` es la versión nueva del servidor (si la hay). */
  complete: (op: OutboxOp, serverUpdatedAt: string | null) => Promise<void>;
  /** El servidor la rechazó: se aparta (con su texto) para copiar o descartar. */
  stuck: (op: OutboxOp, status: number) => Promise<void>;
  copyTitle: (title: string) => string;
}

const touchesText = (p: Record<string, unknown>) => p.content !== undefined || p.title !== undefined || p.lock !== undefined;

/**
 * Reenvía la cola en orden. Sin red, o con el servidor caído (5xx/429), se
 * detiene y lo que falta queda. Un cambio de texto sin versión conocida o
 * que choca (409) no pisa la del servidor: se guarda como nota nueva
 * ("<título> (copia offline)"); si es de una nota bloqueada, la copia va
 * bloqueada con el mismo sobre.
 */
export async function replayOutbox(ops: OutboxOp[], deps: ReplayDeps): Promise<ReplayResult> {
  const r: ReplayResult = { done: 0, copies: 0, stuck: 0, remaining: 0, retry: false };
  const json = (body: unknown): RequestInit => ({
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const updatedAt = async (res: { json: () => Promise<unknown> }) => {
    const d = (await res.json().catch(() => null)) as { updated_at?: string; note?: NoteDetail } | null;
    return d?.updated_at ?? null;
  };

  async function copyOf(op: Extract<OutboxOp, { kind: 'patch' }>, server: NoteDetail | null): Promise<boolean> {
    const title = deps.copyTitle(String(op.patch.title ?? server?.title ?? ''));
    const lock = op.patch.lock as Record<string, unknown> | undefined;
    const id = newOpId();
    const created = await deps.fetch('/api/notes', {
      method: 'POST',
      ...json({
        id,
        title,
        content: lock ? [] : (op.patch.content ?? server?.content ?? []),
        notebook_id: server?.notebook_id ?? null,
        tags: server?.tags ?? [],
      }),
    });
    if (!created.ok) return false;
    if (!lock) return true;
    // Bloqueada: la copia lleva el mismo sobre (se abre con la misma contraseña).
    const locked = await deps.fetch(`/api/notes/${encodeURIComponent(id)}/lock`, {
      method: 'POST',
      ...json({ action: 'lock', lock, content: op.patch.content ?? [] }),
    });
    return locked.ok;
  }

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    try {
      if (op.kind === 'create') {
        const res = await deps.fetch('/api/notes', { method: 'POST', ...json({ ...op.body, id: op.id }) });
        if (res.status >= 500 || res.status === 429) {
          r.remaining = ops.length - i;
          r.retry = true;
          return r;
        }
        if (res.ok || res.status === 409) {
          r.done++;
          await deps.complete(op, res.ok ? await updatedAt(res) : null);
        } else {
          r.stuck++;
          await deps.stuck(op, res.status);
        }
        continue;
      }
      // Texto sin versión conocida: no se manda a ciegas, queda como copia.
      if (!op.base && touchesText(op.patch)) {
        const res = await deps.fetch(`/api/notes/${encodeURIComponent(op.id)}`, { method: 'GET' });
        if (res.status >= 500 || res.status === 429) {
          r.remaining = ops.length - i;
          r.retry = true;
          return r;
        }
        const server = res.ok ? ((await res.json().catch(() => null)) as NoteDetail | null) : null;
        if (await copyOf(op, server)) {
          r.copies++;
          await deps.complete(op, null);
        } else {
          r.stuck++;
          await deps.stuck(op, res.status);
        }
        continue;
      }
      const body = op.base ? { ...op.patch, base_updated_at: op.base } : op.patch;
      const res = await deps.fetch(`/api/notes/${encodeURIComponent(op.id)}`, { method: 'PATCH', ...json(body) });
      if (res.ok) {
        r.done++;
        await deps.complete(op, await updatedAt(res));
      } else if (res.status >= 500 || res.status === 429) {
        r.remaining = ops.length - i;
        r.retry = true;
        return r;
      } else if (res.status === 409 && touchesText(op.patch)) {
        const data = (await res.json().catch(() => null)) as { note?: NoteDetail } | null;
        if (await copyOf(op, data?.note ?? null)) {
          r.copies++;
          await deps.complete(op, null);
        } else {
          r.stuck++;
          await deps.stuck(op, res.status);
        }
      } else if (res.status === 409) {
        // Metadatos (fijar, etiquetas) sobre una nota que cambió: se vuelve a mandar sin base.
        const again = await deps.fetch(`/api/notes/${encodeURIComponent(op.id)}`, { method: 'PATCH', ...json(op.patch) });
        if (again.ok) r.done++;
        await deps.complete(op, again.ok ? await updatedAt(again) : null);
      } else {
        r.stuck++;
        await deps.stuck(op, res.status);
      }
    } catch {
      r.remaining = ops.length - i;
      return r;
    }
  }
  return r;
}

/** Espera antes de reintentar (5 s, 15 s, 45 s… hasta 5 min). */
export function retryDelay(attempt: number): number {
  return Math.min(5_000 * 3 ** Math.max(0, attempt), 300_000);
}

/** Aplica un cambio local a la copia (lo que se ve offline después de guardar). */
export function applyPatchLocally(n: CachedNote, patch: Record<string, unknown>, now: string): CachedNote {
  const next: CachedNote = { ...n };
  if (typeof patch.title === 'string') next.title = patch.title;
  if (Array.isArray(patch.content)) {
    next.content = patch.content as CachedNote['content'];
    next.full = true;
  }
  if (patch.lock) next.lock = patch.lock as CachedNote['lock'];
  if (Array.isArray(patch.tags)) next.tags = patch.tags as string[];
  if (patch.notebook_id !== undefined) next.notebook_id = (patch.notebook_id as string | null) ?? null;
  if (typeof patch.pinned === 'boolean') next.pinned = patch.pinned;
  if (typeof patch.trashed === 'boolean') next.trashed = patch.trashed;
  if (patch.title !== undefined || patch.content !== undefined || patch.tags !== undefined) next.updated_at = now;
  return next;
}

/** Lo que se guarda de un rechazo: título y texto plano (nunca el sobre de una bloqueada). */
export function stuckFrom(op: OutboxOp, status: number): StuckOp {
  const data = op.kind === 'create' ? op.body : op.patch;
  const locked = Boolean(data.lock);
  return {
    opId: op.opId,
    id: op.id,
    title: String(data.title ?? ''),
    text: locked ? '' : blocksPlain(data.content),
    status,
    at: Date.now(),
  };
}

// ---------- IndexedDB ----------

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

const DB_VERSION = 2;

export class NotesOfflineStore {
  private db: Promise<IDBDatabase> | null = null;
  constructor(readonly owner: OfflineOwner) {}

  static available(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(notesDbName(this.owner), DB_VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
        // v1 tenía una cola con seq autoincremental: se reemplaza por ops con id propio.
        if (d.objectStoreNames.contains('outbox')) d.deleteObjectStore('outbox');
        if (!d.objectStoreNames.contains('ops')) d.createObjectStore('ops', { keyPath: 'opId' });
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'fileId' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('blocked'));
    }).catch((err) => {
      this.db = null;
      throw err;
    });
    return this.db;
  }

  close(): void {
    void this.db?.then((d) => d.close()).catch(() => undefined);
    this.db = null;
  }

  async all(): Promise<CachedNote[]> {
    const d = await this.open();
    return req(d.transaction('notes').objectStore('notes').getAll() as IDBRequest<CachedNote[]>);
  }

  async get(id: string): Promise<CachedNote | null> {
    const d = await this.open();
    return ((await req(d.transaction('notes').objectStore('notes').get(id))) as CachedNote | undefined) ?? null;
  }

  /** Resúmenes nuevos (lista o índice): conservan los bloques ya bajados si la nota no cambió. */
  async putSummaries(list: NoteSummary[], opts: { prune?: boolean; keep?: Set<string> } = {}): Promise<void> {
    const d = await this.open();
    const existing = new Map((await this.all()).map((n) => [n.id, n]));
    const tx = d.transaction('notes', 'readwrite');
    const store = tx.objectStore('notes');
    const seen = new Set<string>();
    for (const s of list) {
      if (s.access && s.access !== 'owner') continue;
      seen.add(s.id);
      const prev = existing.get(s.id);
      // Con cambios sin subir, la copia local manda (no se pisa con la del servidor).
      if (prev && opts.keep?.has(s.id)) continue;
      const keep = prev?.full && prev.server_updated_at === s.updated_at && !s.locked === !prev.locked;
      store.put(
        keep
          ? { ...prev, ...s, content: prev.content, lock: prev.lock, full: true, server_updated_at: s.updated_at }
          : { ...s, full: false, server_updated_at: s.updated_at },
      );
    }
    // Las creadas offline que todavía no subieron (keep) no se borran.
    if (opts.prune) for (const id of existing.keys()) if (!seen.has(id) && !opts.keep?.has(id)) store.delete(id);
    await done(tx);
  }

  async putDetails(notes: NoteDetail[], opts: { keep?: Set<string> } = {}): Promise<void> {
    if (!notes.length) return;
    const d = await this.open();
    const tx = d.transaction('notes', 'readwrite');
    for (const n of notes) {
      if (n.access && n.access !== 'owner') continue;
      if (opts.keep?.has(n.id)) continue;
      tx.objectStore('notes').put({ ...n, backlinks: undefined, full: true, server_updated_at: n.updated_at });
    }
    await done(tx);
  }

  async putNote(n: CachedNote): Promise<void> {
    const d = await this.open();
    const tx = d.transaction('notes', 'readwrite');
    tx.objectStore('notes').put(n);
    await done(tx);
  }

  async getMeta<T>(key: string): Promise<T | null> {
    const d = await this.open();
    return ((await req(d.transaction('meta').objectStore('meta').get(key))) as T | undefined) ?? null;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const d = await this.open();
    const tx = d.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(value, key);
    await done(tx);
  }

  async outbox(): Promise<OutboxOp[]> {
    const d = await this.open();
    const ops = (await req(d.transaction('ops').objectStore('ops').getAll())) as OutboxOp[];
    return ops.sort((a, b) => a.at - b.at || a.opId.localeCompare(b.opId));
  }

  /** Encola (fusionando con lo que ya estaba de esa nota): solo se escriben las operaciones que cambian. */
  async enqueue(op: OutboxOp): Promise<void> {
    const before = await this.outbox();
    const after = mergeIntoOutbox(before, op);
    const prev = new Map(before.map((o) => [o.opId, o]));
    const d = await this.open();
    const tx = d.transaction('ops', 'readwrite');
    const store = tx.objectStore('ops');
    const keep = new Set(after.map((o) => o.opId));
    for (const o of after) if (prev.get(o.opId) !== o) store.put(o);
    for (const o of before) if (!keep.has(o.opId)) store.delete(o.opId);
    await done(tx);
  }

  /**
   * La operación ya está en el servidor. Si mientras tanto cambió (otra
   * edición se fusionó, rev distinta), queda lo nuevo apoyado en la versión
   * nueva del servidor; si no, se borra.
   */
  async completeOp(op: OutboxOp, serverUpdatedAt: string | null): Promise<void> {
    const d = await this.open();
    const tx = d.transaction(['ops', 'notes'], 'readwrite');
    const ops = tx.objectStore('ops');
    const current = (await req(ops.get(op.opId))) as OutboxOp | undefined;
    if (current && current.rev !== op.rev) {
      if (current.kind === 'create') {
        const { id: _id, ...body } = current.body;
        void _id;
        ops.put({ opId: current.opId, rev: current.rev, id: current.id, at: current.at, kind: 'patch', patch: body, base: serverUpdatedAt } as OutboxOp);
      } else {
        ops.put({ ...current, base: serverUpdatedAt ?? current.base });
      }
    } else if (current) {
      ops.delete(op.opId);
    }
    if (serverUpdatedAt) {
      const notes = tx.objectStore('notes');
      const n = (await req(notes.get(op.id))) as CachedNote | undefined;
      if (n) notes.put({ ...n, server_updated_at: serverUpdatedAt });
    }
    await done(tx);
  }

  async stuckOps(): Promise<StuckOp[]> {
    return (await this.getMeta<StuckOp[]>('stuck')) ?? [];
  }

  /** Aparta una operación rechazada (con su texto) y la saca de la cola. */
  async stickOp(op: OutboxOp, status: number): Promise<void> {
    const list = await this.stuckOps();
    await this.setMeta('stuck', [...list.filter((s) => s.opId !== op.opId), stuckFrom(op, status)].slice(-50));
    const d = await this.open();
    const tx = d.transaction('ops', 'readwrite');
    tx.objectStore('ops').delete(op.opId);
    await done(tx);
  }

  async dropStuck(opId: string | null): Promise<void> {
    const list = await this.stuckOps();
    await this.setMeta('stuck', opId ? list.filter((s) => s.opId !== opId) : []);
  }

  /** Borra la copia en claro de una nota (al bloquearla): queda solo el resumen sin texto. */
  async scrubNote(note: NoteDetail): Promise<void> {
    const d = await this.open();
    const tx = d.transaction(['notes', 'ops'], 'readwrite');
    tx.objectStore('notes').put({ ...note, snippet: '', backlinks: undefined, full: true, server_updated_at: note.updated_at });
    const ops = tx.objectStore('ops');
    const all = (await req(ops.getAll())) as OutboxOp[];
    for (const o of all) if (o.id === note.id && o.kind === 'patch' && !o.patch.lock && (o.patch.content || o.patch.title)) ops.delete(o.opId);
    await done(tx);
  }

  async addFile(f: PendingFile): Promise<void> {
    const d = await this.open();
    const tx = d.transaction('files', 'readwrite');
    tx.objectStore('files').put(f);
    await done(tx);
  }

  async files(): Promise<PendingFile[]> {
    const d = await this.open();
    return ((await req(d.transaction('files').objectStore('files').getAll())) as PendingFile[]).sort((a, b) => a.at - b.at);
  }

  async removeFile(fileId: string): Promise<void> {
    const d = await this.open();
    const tx = d.transaction('files', 'readwrite');
    tx.objectStore('files').delete(fileId);
    await done(tx);
  }
}

/** ¿Hay cambios de Notes sin subir en este dispositivo? (para avisar al cerrar sesión). */
export async function pendingNotesChanges(owner: OfflineOwner): Promise<{ ops: OutboxOp[]; stuck: StuckOp[]; files: number }> {
  if (!NotesOfflineStore.available()) return { ops: [], stuck: [], files: 0 };
  // Sin crear una base nueva si no existe.
  const list = await indexedDB.databases?.().catch(() => []);
  if (list && !list.some((d) => d.name === notesDbName(owner))) return { ops: [], stuck: [], files: 0 };
  const store = new NotesOfflineStore(owner);
  try {
    const [ops, stuck, files] = await Promise.all([store.outbox(), store.stuckOps(), store.files()]);
    return { ops, stuck, files: files.length };
  } catch {
    return { ops: [], stuck: [], files: 0 };
  } finally {
    store.close();
  }
}

/** Texto de los cambios sin subir (para descargarlo antes de cerrar sesión). Las bloqueadas no van. */
export function pendingAsText(p: { ops: OutboxOp[]; stuck: StuckOp[] }): string {
  const parts: string[] = [];
  for (const op of p.ops) {
    const data = op.kind === 'create' ? op.body : op.patch;
    if (data.lock || (data.title === undefined && data.content === undefined)) continue;
    parts.push(`# ${String(data.title ?? '')}\n\n${blocksPlain(data.content)}`);
  }
  for (const s of p.stuck) if (s.text || s.title) parts.push(`# ${s.title}\n\n${s.text}`);
  return parts.join('\n\n---\n\n');
}

export type { NotebookInfo, TagInfo };

/**
 * Notes offline: copia de las notas en IndexedDB y cola de cambios hechos
 * sin red.
 *
 * - Una base por persona y workspace (`zs-notes:<persona>:<workspace>`):
 *   nadie que entre después en el mismo equipo ve otra copia, y
 *   clearOfflineData (lib/offline-queue.ts) las borra al cerrar sesión.
 * - `notes`: resúmenes de todas las notas propias y, cuando ya bajaron, sus
 *   bloques (sync con /api/notes/sync). Las bloqueadas guardan el sobre
 *   cifrado tal como está en el servidor: se abren offline con la contraseña.
 * - `outbox`: altas y cambios hechos sin red, en orden. Al volver la red se
 *   reenvían (replayOutbox); si la nota cambió en otro lado mientras tanto,
 *   lo de este dispositivo no pisa nada: queda en una copia nueva.
 *
 * La lógica pura (filtro, fusión de la cola, reenvío) se testea en
 * tests/unit/notes-parity.test.ts. Solo cliente.
 */
import { parseNoteQuery } from '@/lib/notes-query';
import type { NoteDetail, NoteSummary, NotebookInfo, NotesSort, TagInfo } from '@/lib/notes-types';
import type { NotesFilter } from './notes-ui';

export const NOTES_DB_PREFIX = 'zs-notes';

export interface OfflineOwner {
  userId: string;
  ws: string;
}

export function notesDbName(o: OfflineOwner): string {
  const safe = (x: string) => x.replace(/[^\w-]/g, '_').slice(0, 80);
  return `${NOTES_DB_PREFIX}:${safe(o.userId)}:${safe(o.ws)}`;
}

/** Nota guardada en el dispositivo: el resumen y, si ya bajó, los bloques. */
export type CachedNote = NoteSummary & Partial<Pick<NoteDetail, 'content' | 'lock' | 'share_token' | 'reminder'>> & { full?: boolean };

export type OutboxOp =
  | { seq?: number; kind: 'create'; id: string; body: Record<string, unknown>; at: number }
  | { seq?: number; kind: 'patch'; id: string; patch: Record<string, unknown>; base: string | null; at: number };

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
  const body = (n.content ?? [])
    .map((b) => (b.content ?? '').replace(/<[^>]*>/g, ''))
    .join('\n');
  return `${n.title}\n${body || n.snippet}`;
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

/**
 * Suma un cambio a la cola: varios guardados seguidos de la misma nota
 * quedan en uno (con la base del primero, la que vio el servidor), y un
 * cambio sobre una nota creada offline se mete en el alta.
 */
export function mergeIntoOutbox(ops: OutboxOp[], next: OutboxOp): OutboxOp[] {
  if (next.kind === 'create') return [...ops.filter((o) => o.id !== next.id || o.kind !== 'create'), next];
  const create = ops.find((o) => o.kind === 'create' && o.id === next.id);
  if (create && create.kind === 'create') {
    const { trashed, ...rest } = next.patch;
    const merged: OutboxOp = { ...create, body: { ...create.body, ...rest } };
    const out = ops.map((o) => (o === create ? merged : o));
    // Mandar a la papelera algo creado offline: va después del alta.
    return trashed === undefined ? out : [...out, { kind: 'patch', id: next.id, patch: { trashed }, base: null, at: next.at }];
  }
  const prev = [...ops].reverse().find((o) => o.kind === 'patch' && o.id === next.id && !('trashed' in o.patch) && !('trashed' in next.patch));
  if (prev && prev.kind === 'patch') {
    const merged: OutboxOp = { ...prev, patch: { ...prev.patch, ...next.patch }, at: next.at };
    return ops.map((o) => (o === prev ? merged : o));
  }
  return [...ops, next];
}

export interface ReplayResult {
  done: number;
  /** Cambios que chocaron con otra edición: se guardaron como copia. */
  copies: number;
  failed: number;
  remaining: number;
}

export interface ReplayDeps {
  fetch: (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
  remove: (op: OutboxOp) => Promise<void>;
  copyTitle: (title: string) => string;
}

/**
 * Reenvía la cola en orden. Sin red se detiene (lo que falta queda). Un
 * 409 por conflicto no pisa la versión del servidor: el contenido de este
 * dispositivo se guarda como nota nueva ("<título> (copia offline)").
 */
export async function replayOutbox(ops: OutboxOp[], deps: ReplayDeps): Promise<ReplayResult> {
  const r: ReplayResult = { done: 0, copies: 0, failed: 0, remaining: 0 };
  const json = (body: unknown): RequestInit => ({
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    try {
      if (op.kind === 'create') {
        const res = await deps.fetch('/api/notes', { method: 'POST', ...json({ ...op.body, id: op.id }) });
        if (res.ok || res.status === 409) r.done++;
        else r.failed++;
      } else {
        const body = op.base ? { ...op.patch, base_updated_at: op.base } : op.patch;
        const res = await deps.fetch(`/api/notes/${encodeURIComponent(op.id)}`, { method: 'PATCH', ...json(body) });
        if (res.ok) r.done++;
        else if (res.status === 409 && (op.patch.content !== undefined || op.patch.title !== undefined) && !op.patch.lock) {
          const data = (await res.json().catch(() => null)) as { note?: NoteDetail } | null;
          const title = String(op.patch.title ?? data?.note?.title ?? '');
          const copy = await deps.fetch('/api/notes', {
            method: 'POST',
            ...json({
              title: deps.copyTitle(title),
              content: op.patch.content ?? data?.note?.content ?? [],
              notebook_id: data?.note?.notebook_id ?? null,
              tags: data?.note?.tags ?? [],
            }),
          });
          if (copy.ok) r.copies++;
          else r.failed++;
        } else r.failed++;
      }
    } catch {
      r.remaining = ops.length - i;
      return r;
    }
    await deps.remove(op);
  }
  return r;
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

export class NotesOfflineStore {
  private db: Promise<IDBDatabase> | null = null;
  constructor(readonly owner: OfflineOwner) {}

  static available(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(notesDbName(this.owner), 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
        if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
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
      const keep = prev?.full && prev.updated_at === s.updated_at;
      store.put(keep ? { ...prev, ...s, content: prev.content, lock: prev.lock, full: true } : { ...s, full: false });
    }
    // Las creadas offline que todavía no subieron (keep) no se borran.
    if (opts.prune) for (const id of existing.keys()) if (!seen.has(id) && !opts.keep?.has(id)) store.delete(id);
    await done(tx);
  }

  async putDetails(notes: NoteDetail[]): Promise<void> {
    if (!notes.length) return;
    const d = await this.open();
    const tx = d.transaction('notes', 'readwrite');
    for (const n of notes) {
      if (n.access && n.access !== 'owner') continue;
      tx.objectStore('notes').put({ ...n, backlinks: undefined, full: true });
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
    const ops = (await req(d.transaction('outbox').objectStore('outbox').getAll())) as OutboxOp[];
    return ops.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  }

  /** Encola (fusionando con lo que ya estaba de esa nota). */
  async enqueue(op: OutboxOp): Promise<void> {
    const before = await this.outbox();
    const after = mergeIntoOutbox(before, op);
    const d = await this.open();
    const tx = d.transaction('outbox', 'readwrite');
    const store = tx.objectStore('outbox');
    store.clear();
    // Se reescribe en orden (seq nuevos, mismo orden).
    for (const o of after) {
      const { seq: _seq, ...rest } = o;
      void _seq;
      store.add(rest);
    }
    await done(tx);
  }

  async removeOp(op: OutboxOp): Promise<void> {
    if (op.seq === undefined) return;
    const d = await this.open();
    const tx = d.transaction('outbox', 'readwrite');
    tx.objectStore('outbox').delete(op.seq);
    await done(tx);
  }
}

export type { NotebookInfo, TagInfo };

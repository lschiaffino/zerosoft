/**
 * Docs: edición simultánea tecla por tecla, como Notion (servidor).
 *
 * - El texto de cada bloque de texto tiene un número de versión
 *   (docs_block_text). El navegador manda sus cambios como operaciones
 *   (lib/docs-ot.ts) sobre la versión que vio; acá se transforman contra
 *   las que entraron en el medio, se aplican a la página (compare-and-set
 *   sobre updated_at, la misma marca que usa el guardado) y quedan en el
 *   feed. Nadie pisa a nadie: dos personas escribiendo en el mismo bloque, o
 *   en la misma palabra, terminan con las dos cosas.
 * - Si el texto cambió por otro camino (una restauración, la IA, un
 *   guardado sin operaciones), primero se registra ese cambio como una
 *   operación más (reconciliación), así todos los editores lo reciben.
 * - El feed (docs_live_events) también lleva cursores, avisos de guardado y
 *   cambios de acceso. Cada página abierta tiene un stream SSE (lib/realtime.ts)
 *   que lo lee una vez por instancia y filtra por página; el acceso se
 *   revalida en cada cambio de permisos y cada pocos segundos, y si se
 *   pierde la conexión se corta en el acto (`bye` revoked), como en Talk.
 *
 * Funciona en Vercel (sin sockets) y en un servidor propio. Server-only.
 */
import { getDb, type DocsPageRow } from './db';
import { DOC_INTERNAL_READ, parseBlocks, resolveDocAccess, type DocsActor } from './docs';
import { stringifyBlocks, type DocsAccess, type DocsBlock } from './docs-types';
import { sanitizeBlocks } from './docs-sanitize';
import { DOCS_BLOCK_MAX } from './docs-schema';
import { nextUpdatedAt, recordRevisions } from './docs-revisions';
import { apply, baseLength, diff, isNoop, isTextOp, OpError, textHash, transform, type TextOp } from './docs-ot';
import { hasPageLink, hasUnsafeMarkup, isCoeditBlock, type CoeditEvent, type CoeditOpItem, type CoeditOpResult } from './docs-coedit-shared';
import { sharedFeed, sseLiveResponse, type SharedFeed } from './realtime';

export const COEDIT_FEED_INTERVAL_MS = 300;
/** Las operaciones se guardan una hora (base de la transformación al reconectar); el resto, dos minutos. */
const OP_TTL_MS = 60 * 60_000;
const EVENT_TTL_MS = 2 * 60_000;
const BACKLOG_LIMIT = 300;
export const MAX_ITEMS = 50;

type OpEvent = Extract<CoeditEvent, { kind: 'op' }>;

interface RawEvent {
  id: number;
  workspaceId: string;
  pageId: string | null;
  userId: string | null;
  kind: string;
  blockId: string | null;
  rev: number | null;
  session: string | null;
  seq: string | null;
  payload: Record<string, unknown>;
}

function parseJson(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ---------- Feed ----------

let feed: SharedFeed<RawEvent> | null = null;

const SELECT_EVENTS = 'SELECT id, workspace_id, page_id, user_id, kind, block_id, rev, session_id, seq, payload FROM docs_live_events';

function toRaw(r: Record<string, unknown>): RawEvent {
  return {
    id: Number(r.id),
    workspaceId: String(r.workspace_id),
    pageId: (r.page_id as string | null) ?? null,
    userId: (r.user_id as string | null) ?? null,
    kind: String(r.kind),
    blockId: (r.block_id as string | null) ?? null,
    rev: r.rev == null ? null : Number(r.rev),
    session: (r.session_id as string | null) ?? null,
    seq: (r.seq as string | null) ?? null,
    payload: parseJson(r.payload),
  };
}

export function coeditFeed(): SharedFeed<RawEvent> {
  feed ??= sharedFeed<RawEvent>('docs-coedit', {
    intervalMs: COEDIT_FEED_INTERVAL_MS,
    start: async () => {
      const row = (await getDb().prepare('SELECT MAX(id) AS id FROM docs_live_events').get()) as { id: number | null } | undefined;
      return Number(row?.id ?? 0);
    },
    fetchSince: async (cursor) => ((await getDb().prepare(`${SELECT_EVENTS} WHERE id > ? ORDER BY id LIMIT 500`).all(cursor)) as Array<Record<string, unknown>>).map(toRaw),
  });
  return feed;
}

/** Evento como lo ve el navegador (sin workspace ni ids internos). */
export function publicEvent(e: RawEvent): CoeditEvent | null {
  const p = e.payload;
  switch (e.kind) {
    case 'op': {
      // Red de seguridad: nunca sale por el feed algo que el sanitizador no deja ni el título de un link a página.
      const op = p.op as TextOp;
      const inserted = Array.isArray(op) ? op.filter((c): c is string => typeof c === 'string').join('') : '';
      if (hasUnsafeMarkup(inserted) || hasPageLink(inserted)) return null;
      return { id: e.id, kind: 'op', block: e.blockId ?? '', rev: e.rev ?? 0, session: e.session, seq: e.seq, user: e.userId, op, hb: String(p.hb ?? ''), ha: String(p.ha ?? '') };
    }
    case 'cursor':
      return {
        id: e.id,
        kind: 'cursor',
        session: e.session ?? '',
        user: e.userId ?? '',
        name: String(p.name ?? ''),
        image: (p.image as string | null) ?? null,
        block: (p.block as string | null) ?? null,
        start: typeof p.start === 'number' ? p.start : null,
        end: typeof p.end === 'number' ? p.end : null,
        mode: String(p.mode ?? 'edit'),
        at: typeof p.at === 'string' ? p.at : null,
      };
    case 'leave':
      return { id: e.id, kind: 'leave', session: e.session ?? '', user: e.userId };
    case 'save':
      return { id: e.id, kind: 'save', at: String(p.at ?? ''), by: (p.by as string | null) ?? null };
    default:
      return null;
  }
}

async function insertEvent(e: {
  workspaceId: string;
  pageId: string | null;
  userId?: string | null;
  kind: string;
  blockId?: string | null;
  rev?: number | null;
  session?: string | null;
  seq?: string | null;
  payload?: Record<string, unknown>;
  now?: string;
}): Promise<number | null> {
  const now = e.now ?? new Date().toISOString();
  const res = await getDb()
    .prepare(
      `INSERT OR IGNORE INTO docs_live_events (workspace_id, page_id, user_id, kind, block_id, rev, session_id, seq, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(e.workspaceId, e.pageId, e.userId ?? null, e.kind, e.blockId ?? null, e.rev ?? null, e.session ?? null, e.seq ?? null, JSON.stringify(e.payload ?? {}), now);
  return res.changes ? (res.lastInsertRowid ?? null) : null;
}

export async function pruneEvents(now = Date.now()): Promise<void> {
  await getDb()
    .prepare("DELETE FROM docs_live_events WHERE created_at < ? OR (kind != 'op' AND created_at < ?)")
    .run(new Date(now - OP_TTL_MS).toISOString(), new Date(now - EVENT_TTL_MS).toISOString());
}

/** Avisa que se guardó la página (los editores abiertos piden la versión nueva ya). */
export async function coeditSaved(page: Pick<DocsPageRow, 'id' | 'user_id'>, at: string, by: string | null): Promise<void> {
  await insertEvent({ workspaceId: page.user_id, pageId: page.id, userId: by, kind: 'save', payload: { at, by } }).catch(() => undefined);
  coeditFeed().poke();
}

/**
 * Cambiaron permisos (compartir, roles, teamspaces, apps o membresía): los
 * streams del workspace revalidan el acceso ya. `pageId` null = todo el workspace.
 */
export async function docsAccessChanged(workspaceId: string, opts: { pageId?: string | null; userId?: string | null } = {}): Promise<void> {
  try {
    await insertEvent({ workspaceId, pageId: opts.pageId ?? null, userId: opts.userId ?? null, kind: 'access' });
    coeditFeed().poke();
  } catch {
    /* sin la tabla (migración pendiente): los streams igual revalidan solos */
  }
}

const CURSOR_MIN_MS = 100;
const lastCursorAt = new Map<string, number>();

/** Cursor de una sesión (y presencia): lo reciben las demás al instante. */
export async function coeditCursor(args: {
  page: Pick<DocsPageRow, 'id' | 'user_id'>;
  session: string;
  userId: string;
  name: string;
  image: string | null;
  block: string | null;
  start: number | null;
  end: number | null;
  mode: string;
}): Promise<void> {
  // Una por sesión cada 100 ms como mucho (el navegador ya manda una cada 200 ms).
  const now = Date.now();
  if (now - (lastCursorAt.get(args.session) ?? 0) < CURSOR_MIN_MS) return;
  lastCursorAt.set(args.session, now);
  if (lastCursorAt.size > 5000) lastCursorAt.clear();
  await insertEvent({
    workspaceId: args.page.user_id,
    pageId: args.page.id,
    userId: args.userId,
    kind: 'cursor',
    session: args.session,
    payload: { name: args.name, image: args.image, block: args.block, start: args.start, end: args.end, mode: args.mode, at: new Date(now).toISOString() },
  });
  coeditFeed().poke();
}

export async function coeditLeave(page: Pick<DocsPageRow, 'id' | 'user_id'>, session: string, userId: string): Promise<void> {
  await insertEvent({ workspaceId: page.user_id, pageId: page.id, userId, kind: 'leave', session });
  coeditFeed().poke();
}

// ---------- Texto de los bloques ----------

interface BlockState {
  rev: number;
  text: string;
  baseHash: string;
  exists: boolean;
}

async function loadStates(pageId: string, ids: string[]): Promise<Map<string, BlockState>> {
  const out = new Map<string, BlockState>();
  if (!ids.length) return out;
  const rows = (await getDb()
    .prepare(`SELECT block_id, rev, text, base_hash FROM docs_block_text WHERE page_id = ? AND block_id IN (${ids.map(() => '?').join(',')})`)
    .all(pageId, ...ids)) as Array<{ block_id: string; rev: number; text: string; base_hash: string }>;
  for (const r of rows) out.set(r.block_id, { rev: Number(r.rev), text: r.text, baseHash: r.base_hash, exists: true });
  return out;
}

async function saveState(pageId: string, blockId: string, st: BlockState, now: string): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO docs_block_text (page_id, block_id, rev, text, base_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(page_id, block_id) DO UPDATE SET rev = excluded.rev, text = excluded.text, updated_at = excluded.updated_at`,
    )
    .run(pageId, blockId, st.rev, st.text, st.baseHash, now);
}

/** Operaciones guardadas de un bloque con versión en (from, to]. */
async function opsBetween(pageId: string, blockId: string, from: number, to: number): Promise<Array<{ rev: number; op: TextOp; hb: string; ha: string }>> {
  if (to <= from) return [];
  const rows = (await getDb()
    .prepare("SELECT rev, payload FROM docs_live_events WHERE kind = 'op' AND page_id = ? AND block_id = ? AND rev > ? AND rev <= ? ORDER BY rev")
    .all(pageId, blockId, from, to)) as Array<{ rev: number; payload: string }>;
  return rows.map((r) => {
    const p = parseJson(r.payload);
    return { rev: Number(r.rev), op: p.op as TextOp, hb: String(p.hb ?? ''), ha: String(p.ha ?? '') };
  });
}

/** Versión del bloque cuyo texto tiene esa huella (la más nueva), o null. */
async function revForHash(pageId: string, blockId: string, st: BlockState, hash: string): Promise<number | null> {
  if (textHash(st.text) === hash) return st.rev;
  const rows = (await getDb()
    .prepare("SELECT rev, payload FROM docs_live_events WHERE kind = 'op' AND page_id = ? AND block_id = ? ORDER BY rev DESC LIMIT 500")
    .all(pageId, blockId)) as Array<{ rev: number; payload: string }>;
  for (const r of rows) if (parseJson(r.payload).ha === hash) return Number(r.rev);
  if (st.baseHash === hash) return 0;
  return null;
}

/** El texto como queda guardado (el mismo sanitizador del guardado), o null si no se pudo sanear (no se guarda). */
function sanitizeText(block: DocsBlock, raw: string): string | null {
  try {
    const out = sanitizeBlocks([{ ...block, content: raw }])[0];
    return typeof out?.content === 'string' ? out.content : null;
  } catch {
    return null;
  }
}

interface PendingOp {
  blockId: string;
  rev: number;
  op: TextOp;
  hb: string;
  ha: string;
  session: string | null;
  seq: string | null;
  userId: string | null;
}

const toEvent = (p: PendingOp, id?: number): OpEvent => ({ id, kind: 'op', block: p.blockId, rev: p.rev, session: p.session, seq: p.seq, user: p.userId, op: p.op, hb: p.hb, ha: p.ha });

/** Registra como operación lo que cambió el texto por otro camino. */
function reconcile(st: BlockState, blockId: string, pageText: string, out: PendingOp[]): BlockState {
  if (st.text === pageText) return st;
  const next = { ...st, rev: st.rev + 1, text: pageText };
  out.push({ blockId, rev: next.rev, op: diff(st.text, pageText), hb: textHash(st.text), ha: textHash(pageText), session: null, seq: null, userId: null });
  return next;
}

const REVISION_EVERY_MS = 30_000;
const lastRevision = new Map<string, number>();
function shouldRecordRevision(pageId: string, now: number): boolean {
  const last = lastRevision.get(pageId) ?? 0;
  if (now - last < REVISION_EVERY_MS) return false;
  lastRevision.set(pageId, now);
  if (lastRevision.size > 5000) lastRevision.clear();
  return true;
}

export class CoeditAccessError extends Error {
  constructor(public code: 'locked' | 'not_found') {
    super(code);
  }
}

/**
 * Aplica las operaciones de una sesión sobre una página. Quien llama ya
 * chequeó que puede editar (y que no está bloqueada). Reintenta si otro
 * guardado se cuela (compare-and-set de la página).
 */
export async function applyTextOps(args: {
  pageId: string;
  actorId: string;
  session: string;
  items: CoeditOpItem[];
  /** Se guardó la página (versiones, recordatorios, eventos de Flow y webhooks: lo mismo que un guardado). */
  onSaved?: (before: DocsPageRow, blocks: DocsBlock[]) => void;
}): Promise<CoeditOpResult[]> {
  const items = args.items.slice(0, MAX_ITEMS);
  for (let attempt = 0; attempt < 6; attempt++) {
    const row = (await getDb().prepare('SELECT * FROM docs_pages WHERE id = ?').get(args.pageId)) as DocsPageRow | undefined;
    if (!row) throw new CoeditAccessError('not_found');
    const blocks = parseBlocks(row.content);
    const index = new Map(blocks.map((b, i) => [b.id, i]));
    const ids = [...new Set(items.map((i) => i.block))].filter((id) => index.has(id));
    const loaded = await loadStates(args.pageId, ids);
    const states = new Map<string, BlockState>();
    const pending: PendingOp[] = [];
    const results: Array<CoeditOpResult & { _ops?: PendingOp[] }> = [];
    const touched = new Set<string>();

    for (const item of items) {
      const res: CoeditOpResult & { _ops?: PendingOp[] } = { block: item.block, seq: item.seq, status: 'ok' };
      results.push(res);
      const dup = (await getDb()
        .prepare("SELECT rev FROM docs_live_events WHERE kind = 'op' AND page_id = ? AND session_id = ? AND seq = ? LIMIT 1")
        .get(args.pageId, args.session, item.seq)) as { rev: number } | undefined;
      if (dup) {
        res.status = 'dup';
        res.rev = Number(dup.rev);
        continue;
      }
      const i = index.get(item.block);
      if (i === undefined) {
        res.status = 'gone';
        continue;
      }
      const block = blocks[i];
      if (!isCoeditBlock(block) || !isTextOp(item.op)) {
        res.status = 'unsupported';
        continue;
      }
      const pageText = block.content;
      let st = states.get(item.block) ?? loaded.get(item.block) ?? { rev: 0, text: pageText, baseHash: textHash(pageText), exists: false };
      const ops: PendingOp[] = [];
      st = reconcile(st, item.block, pageText, ops);
      // Base: la versión que dice el navegador (si su huella coincide) o la que tenga esa huella.
      let op = item.op;
      let based = false;
      try {
        let baseRev: number | null = null;
        if (item.rev !== null && item.rev >= 0 && item.rev <= st.rev) {
          const h = item.rev === st.rev ? textHash(st.text) : item.rev === 0 ? st.baseHash : null;
          if (h === item.hash) baseRev = item.rev;
          else if (h === null) {
            const stored = (await opsBetween(args.pageId, item.block, item.rev - 1, item.rev))[0];
            const fromPending = [...pending, ...ops].find((p) => p.blockId === item.block && p.rev === item.rev);
            if ((fromPending?.ha ?? stored?.ha) === item.hash) baseRev = item.rev;
          }
        }
        if (baseRev === null && item.rev === null) baseRev = await revForHash(args.pageId, item.block, st, item.hash);
        if (baseRev !== null) {
          const stored = await opsBetween(args.pageId, item.block, baseRev, st.rev);
          const local = [...pending, ...ops].filter((p) => p.blockId === item.block && p.rev > baseRev!);
          const between = [...stored.filter((s) => !local.some((l) => l.rev === s.rev)), ...local].sort((a, b) => a.rev - b.rev);
          if (between.length === st.rev - baseRev && baseLength(op) === (between.length ? baseLength(between[0].op) : st.text.length)) {
            for (const c of between) op = transform(op, c.op)[0];
            based = true;
          }
        }
        if (!based && typeof item.base === 'string' && textHash(item.base) === item.hash && baseLength(op) === item.base.length) {
          // Muy atrasado (offline largo): se fusiona contra el texto base que mandó.
          op = transform(op, diff(item.base, st.text))[0];
          based = true;
        }
      } catch (err) {
        if (!(err instanceof OpError)) throw err;
        based = false;
      }
      if (!based || baseLength(op) !== st.text.length) {
        res.status = 'resync';
        res.rev = st.rev;
        res.text = st.text;
        // La reconciliación igual vale: queda registrada si hay algo que escribir.
        if (ops.length) {
          states.set(item.block, st);
          pending.push(...ops);
          blocks[i] = { ...block, content: st.text };
          touched.add(item.block);
        }
        continue;
      }
      const raw = isNoop(op) ? st.text : apply(st.text, op);
      // Se sanea ANTES de guardar: lo que queda en la página, en el feed y en la
      // respuesta es una sola operación hasta el texto limpio. Lo que mandó el
      // navegador tal cual no se guarda ni se reparte nunca.
      const clean = sanitizeText(block, raw);
      const refuse = clean === null ? 'resync' : clean.length > DOCS_BLOCK_MAX ? 'too_large' : hasPageLink(clean) ? 'unsupported' : null;
      if (refuse || clean === null) {
        res.status = refuse ?? 'resync';
        res.rev = st.rev;
        if (res.status === 'resync') res.text = st.text;
        if (ops.length) {
          states.set(item.block, st);
          pending.push(...ops);
          blocks[i] = { ...block, content: st.text };
          touched.add(item.block);
        }
        continue;
      }
      const stored = clean === raw ? op : diff(st.text, clean);
      ops.push({ blockId: item.block, rev: st.rev + 1, op: stored, hb: textHash(st.text), ha: textHash(clean), session: args.session, seq: item.seq, userId: args.actorId });
      st = { ...st, rev: st.rev + 1, text: clean };
      states.set(item.block, st);
      pending.push(...ops);
      res._ops = ops;
      blocks[i] = { ...block, content: st.text };
      touched.add(item.block);
    }

    const finish = async (eventIds: Map<string, number>) =>
      Promise.all(
        results.map(async (r) => {
          const { _ops, ...rest } = r;
          if (_ops) rest.events = _ops.map((p) => toEvent(p, eventIds.get(`${p.blockId}:${p.rev}`)));
          else if (r.status === 'dup' && r.rev !== undefined) {
            const stored = await opsBetween(args.pageId, r.block, r.rev - 1, r.rev);
            rest.events = stored.map((s) => ({ kind: 'op' as const, block: r.block, rev: s.rev, session: args.session, seq: r.seq, user: args.actorId, op: s.op, hb: s.hb, ha: s.ha }));
          }
          return rest;
        }),
      );

    if (!touched.size) return finish(new Map());
    const now = new Date();
    const updatedAt = nextUpdatedAt(row.updated_at, now);
    const content = stringifyBlocks(blocks);
    const result = await getDb()
      .prepare('UPDATE docs_pages SET content = ?, content_by = ?, updated_at = ? WHERE id = ? AND updated_at = ?')
      .run(content, args.actorId, updatedAt, args.pageId, row.updated_at);
    if (result.changes === 0) continue;
    const iso = now.toISOString();
    // Versión guardada como mucho cada 30 s por página: las del medio se arman con las operaciones (lib/docs-revisions.ts).
    if (shouldRecordRevision(args.pageId, now.getTime())) {
      await recordRevisions(row, { updated_at: updatedAt, title: row.title, icon: row.icon, cover_url: row.cover_url, content }).catch(() => undefined);
    }
    for (const id of touched) await saveState(args.pageId, id, states.get(id)!, iso);
    const eventIds = new Map<string, number>();
    for (const p of pending) {
      const id = await insertEvent({
        workspaceId: row.user_id,
        pageId: args.pageId,
        userId: p.userId,
        kind: 'op',
        blockId: p.blockId,
        rev: p.rev,
        session: p.session,
        seq: p.seq,
        payload: { op: p.op, hb: p.hb, ha: p.ha, at: updatedAt },
        now: iso,
      });
      if (id) eventIds.set(`${p.blockId}:${p.rev}`, id);
    }
    coeditFeed().poke();
    args.onSaved?.(row, blocks);
    return finish(eventIds);
  }
  // Demasiados guardados a la vez: el navegador reintenta con la misma seq.
  throw new Error('coedit_busy');
}

/**
 * Después de un guardado de la página (lib/docs.ts updateDocPage): el texto
 * que cambió por ese camino queda como operación, así los editores abiertos
 * lo reciben por el feed (su fusión de página no toca esos textos). Compara
 * contra la página como está ahora (si entró una operación después del
 * guardado, ya está registrada y no se deshace). `prev` = los bloques de
 * antes del guardado (base de los bloques que todavía no tenían versión).
 */
export async function coeditAfterSave(pageId: string, prev: DocsBlock[]): Promise<void> {
  const row = (await getDb().prepare('SELECT id, user_id, content FROM docs_pages WHERE id = ?').get(pageId)) as Pick<DocsPageRow, 'id' | 'user_id' | 'content'> | undefined;
  if (!row) return;
  const current = parseBlocks(row.content).filter((b) => isCoeditBlock(b));
  if (!current.length) return;
  const before = new Map(prev.map((b) => [b.id, b]));
  const states = await loadStates(pageId, current.map((b) => b.id));
  const now = new Date().toISOString();
  let wrote = false;
  for (const b of current) {
    const known = states.get(b.id);
    const prevBlock = before.get(b.id);
    const prevText = known ? known.text : isCoeditBlock(prevBlock) ? prevBlock!.content : b.content;
    if (prevText === b.content) continue;
    const st0: BlockState = known ?? { rev: 0, text: prevText, baseHash: textHash(prevText), exists: false };
    const ops: PendingOp[] = [];
    const st = reconcile(st0, b.id, b.content, ops);
    // Si otra operación ganó la versión en el medio, la próxima reconciliación lo resuelve.
    const claimed = known
      ? await getDb()
          .prepare('UPDATE docs_block_text SET rev = ?, text = ?, updated_at = ? WHERE page_id = ? AND block_id = ? AND rev = ?')
          .run(st.rev, st.text, now, pageId, b.id, st0.rev)
      : await getDb()
          .prepare('INSERT OR IGNORE INTO docs_block_text (page_id, block_id, rev, text, base_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(pageId, b.id, st.rev, st.text, st.baseHash, now);
    if (!claimed.changes) continue;
    for (const p of ops) {
      await insertEvent({ workspaceId: row.user_id, pageId, kind: 'op', blockId: p.blockId, rev: p.rev, payload: { op: p.op, hb: p.hb, ha: p.ha }, now });
    }
    wrote = true;
  }
  if (wrote) coeditFeed().poke();
}

/** Texto y versión actuales de bloques (para volver a sincronizar un editor desfasado). */
export async function blockSnapshots(row: DocsPageRow, ids: string[]): Promise<Record<string, { rev: number; text: string } | null>> {
  const blocks = new Map(parseBlocks(row.content).map((b) => [b.id, b]));
  const wanted = ids.slice(0, MAX_ITEMS);
  const states = await loadStates(row.id, wanted.filter((id) => blocks.has(id)));
  const out: Record<string, { rev: number; text: string } | null> = {};
  for (const id of wanted) {
    const b = blocks.get(id);
    if (!b || !isCoeditBlock(b)) {
      out[id] = null;
      continue;
    }
    const st = states.get(id);
    if (!st) out[id] = { rev: 0, text: b.content };
    else if (st.text === b.content) out[id] = { rev: st.rev, text: st.text };
    else {
      // Cambió por otro camino y nadie lo registró todavía: se registra ahora.
      await coeditAfterSave(row.id, []);
      const again = (await loadStates(row.id, [id])).get(id);
      out[id] = again && again.text === b.content ? { rev: again.rev, text: again.text } : { rev: st.rev, text: st.text };
    }
  }
  return out;
}

// ---------- Acceso y stream ----------

export interface CoeditViewer {
  /** Workspace activo de la sesión (dueño de los datos). */
  ownerId: string;
  /** La persona. */
  realId: string;
  actor: DocsActor;
  /** Workspace dueño de la página (un invitado mira páginas de otro workspace). */
  pageWorkspace?: string;
}

/** Acceso actual a la página, revalidado sin la sesión (membresía, apps del workspace y permisos de la página). */
export async function currentAccess(viewer: CoeditViewer, pageId: string): Promise<DocsAccess | null> {
  if (viewer.actor.actingUser) {
    const { personAppAccess } = await import('./api-auth');
    const { canUseApp } = await import('./workspace');
    const a = await personAppAccess(viewer.ownerId, viewer.realId);
    if (!a || !canUseApp({ role: a.role, apps: a.apps === '*' ? '*' : JSON.stringify(a.apps) }, 'docs')) return null;
    viewer.actor = { ...viewer.actor, role: a.role };
  }
  const res = await resolveDocAccess(viewer.actor, pageId, DOC_INTERNAL_READ);
  return res?.access ?? null;
}

async function backlog(pageId: string, cursor: number): Promise<{ events: RawEvent[]; cursor: number; gap?: boolean }> {
  const latest = async () => Number(((await getDb().prepare('SELECT MAX(id) AS id FROM docs_live_events').get()) as { id: number | null } | undefined)?.id ?? 0);
  if (!cursor) return { events: [], cursor: await latest() };
  // Cursores y avisos viejos no se repiten al reconectar (las operaciones sí: son el texto).
  const fresh = new Date(Date.now() - EVENT_TTL_MS).toISOString();
  const rows = ((await getDb()
    .prepare(`${SELECT_EVENTS} WHERE page_id = ? AND id > ? AND (kind = 'op' OR created_at >= ?) ORDER BY id LIMIT ${BACKLOG_LIMIT}`)
    .all(pageId, cursor, fresh)) as Array<Record<string, unknown>>).map(toRaw);
  if (rows.length >= BACKLOG_LIMIT) return { events: [], cursor: await latest(), gap: true };
  return { events: rows, cursor: rows.length ? rows[rows.length - 1].id : cursor };
}

/**
 * Filtro de una conexión: los eventos de su página y, ante un cambio de
 * acceso del workspace o de la página, revalida (si cambió el rol avisa; si
 * ya no puede abrirla, corta).
 */
export function coeditFilter(viewer: CoeditViewer, pageId: string, initial: DocsAccess, onRevoked: () => void, onCheckError?: () => void) {
  let access: DocsAccess | null = initial;
  let revoked = false;
  const filter = async (events: RawEvent[]): Promise<CoeditEvent[]> => {
    if (revoked) return [];
    const mine = events.filter((e) => e.pageId === pageId || (e.kind === 'access' && e.pageId === null));
    if (!mine.length) return [];
    const out: CoeditEvent[] = [];
    if (mine.some((e) => e.kind === 'access' && (e.pageId === pageId || e.workspaceId === viewer.ownerId || e.workspaceId === viewer.pageWorkspace || e.userId === viewer.realId))) {
      let now: DocsAccess | null;
      try {
        now = await currentAccess(viewer, pageId);
        filter.checkedAt = Date.now();
      } catch {
        // No se pudo revalidar (base caída): falla cerrado. No se manda nada más por
        // esta conexión; el navegador se reconecta y la conexión nueva vuelve a chequear.
        revoked = true;
        onCheckError?.();
        return [];
      }
      if (!now) {
        revoked = true;
        onRevoked();
        return [];
      }
      if (now !== access) out.push({ kind: 'access', access: now });
      access = now;
    }
    for (const e of mine) {
      const pub = publicEvent(e);
      if (pub) out.push(pub);
    }
    return out;
  };
  /** Última revalidación (la periódica del stream no repite si fue hace poco). */
  filter.checkedAt = Date.now();
  return filter;
}

const CHECK_MS = 5_000;

/** Stream SSE de una página para esta persona (ya chequeado su acceso). */
export function coeditStream(viewer: CoeditViewer, pageId: string, access: DocsAccess, cursor: number, signal?: AbortSignal): Response {
  let revoke: ((reason?: string) => void) | null = null;
  const filter = coeditFilter(
    viewer,
    pageId,
    access,
    () => revoke?.('revoked'),
    () => revoke?.(),
  );
  return sseLiveResponse<CoeditEvent>({
    cursor,
    backlog: async (c) => {
      const back = await backlog(pageId, c);
      return { events: (await filter(back.events)).map((e) => e), cursor: back.cursor, gap: back.gap };
    },
    subscribe: (push, close) => {
      revoke = close;
      return coeditFeed().subscribe(async (events) => {
        const visible = await filter(events);
        push({ events: visible, cursor: events[events.length - 1]?.id ?? 0 });
      });
    },
    // Red de seguridad: además de los avisos de cambio de acceso, cada 5 s.
    // Falla cerrado: si no se puede revalidar se corta (sin `revoked`: el navegador reconecta y se vuelve a chequear).
    check: async () => {
      // Recién revalidado por un aviso de cambio de acceso: no hace falta otra consulta.
      if (Date.now() - filter.checkedAt < CHECK_MS) return true;
      try {
        filter.checkedAt = Date.now();
        return (await currentAccess(viewer, pageId)) !== null;
      } catch {
        revoke?.();
        return true;
      }
    },
    checkMs: CHECK_MS,
    heartbeatMs: 15_000,
    maxMs: 240_000,
    signal,
  });
}

/** Polling (fallback del stream): lo nuevo de la página desde `cursor`. */
export async function coeditPoll(viewer: CoeditViewer, pageId: string, access: DocsAccess, cursor: number): Promise<{ events: CoeditEvent[]; cursor: number }> {
  const back = await backlog(pageId, cursor);
  if (back.gap) return { events: [], cursor: back.cursor };
  const filter = coeditFilter(viewer, pageId, access, () => undefined);
  return { events: await filter(back.events), cursor: back.cursor };
}

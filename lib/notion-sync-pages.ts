/**
 * Sincronización Docs ↔ Notion de una página, una base o el cuerpo de una
 * fila. Cada vez: se lee Notion, se fusiona con Docs bloque por bloque
 * (lib/notion-sync-merge.ts) y se manda a Notion solo lo que cambió acá.
 * Server-only.
 *
 * - Lo que se escribe en Docs pasa por updateDocPage (fusión con editores
 *   abiertos, historial, eventos) marcado como "viene de Notion": no vuelve
 *   a la cola de envíos. Las huellas de cada bloque cortan el eco.
 * - Si en un choque gana Notion, antes de escribir queda una versión de la
 *   página en el historial con lo que había en Docs.
 * - Notion no mueve bloques por API: lo movido en Docs se borra y se crea de
 *   nuevo. Las subpáginas y bases hijas (child_page / child_database) nunca
 *   se borran desde acá: son de solo lectura en el cuerpo.
 */
import { readFile } from 'fs/promises';
import { getDb, type DocsPageRow } from './db';
import { ImportError, setExternalId } from './import-jobs';
import {
  convertBlocks,
  convertDatabase,
  databaseBlockId,
  iconEmoji,
  normalizeNotionId,
  pageTitle,
  plainText,
  richTextToHtml,
  stableId,
  type DatabaseConvertContext,
  type NBlock,
  type NBlockNode,
  type NDatabase,
  type NList,
  type NPage,
  type NRichText,
  type NotionRowInput,
} from './notion-api';
import { downloadNotionFile, fetchBlockTree, NOTION_API_SOURCE, readCapped, resolveNotionMedia } from './docs-notion-api-import';
import { stringifyBlocks, type DbFile, type DbProperty, type DbRow, type DocsBlock, type DocsDatabase } from './docs-types';
import { blockIndent } from './docs-blocks';
import {
  blockHash,
  dbSchemaToNotion,
  dbValueToNotion,
  docsBlockToNotion,
  hashOf,
  htmlToRichText,
  MEDIA,
  READ_ONLY_PROPS,
  tableRow,
  updatePayload,
  type NotionBlockReq,
  type NotionFileRef,
} from './notion-sync-convert';
import { mergeBlocks, planPush, stateAfterMerge, type BlockMap, type PageSyncState } from './notion-sync-merge';
import {
  asNotionSync,
  forwardContext,
  getItem,
  indexItem,
  insertItem,
  isGoneError,
  logSync,
  reverseContext,
  saveItem,
  type ItemRow,
  type Run,
} from './notion-sync-core';

// ---------- Estado guardado ----------

interface PageState extends PageSyncState {
  title?: { n: string; l: string };
  icon?: { n: string | null; l: string | null };
  /** Sin permiso de comentarios en la integración: no se vuelve a pedir. */
  noComments?: boolean;
}

interface DbRowState {
  /** Huellas [Notion, Docs] por propiedad. */
  p: Record<string, [string, string]>;
}

interface DbState {
  title?: { n: string; l: string };
  /** Propiedad local → id de la propiedad en Notion y su nombre en la última sincronización. */
  props: Record<string, { n: string; name: string }>;
  rows: Record<string, DbRowState>;
}

function parseState<T>(raw: string | null, empty: T): T {
  if (!raw) return empty;
  try {
    return { ...empty, ...(JSON.parse(raw) as T) };
  } catch {
    return empty;
  }
}

const emptyPage = (): PageState => ({ blocks: {}, seq: [] });

// ---------- Docs ----------

async function localPage(run: Run, pageId: string | null): Promise<DocsPageRow | null> {
  if (!pageId) return null;
  return ((await getDb().prepare('SELECT * FROM docs_pages WHERE id = ? AND user_id = ?').get(pageId, run.ws)) as DocsPageRow | undefined) ?? null;
}

async function parse(content: string): Promise<DocsBlock[]> {
  const { parseBlocks } = await import('./docs');
  return parseBlocks(content);
}

/** Guarda en Docs como "viene de Notion" (sin volver a la cola). */
async function saveLocal(run: Run, row: DocsPageRow, input: { content?: DocsBlock[]; title?: string; icon?: string | null; archived?: boolean }): Promise<DocsPageRow> {
  const { updateDocPage } = await import('./docs');
  await asNotionSync(() => updateDocPage(run.ws, row.id, { ...input, base_updated_at: row.updated_at }, { actorId: null }));
  return (await localPage(run, row.id)) ?? row;
}

/** Página de Docs nueva para algo que llegó de Notion (debajo de su padre si ya está acá). */
async function createLocal(run: Run, item: ItemRow, title: string, icon: string | null, content: DocsBlock[], created: string): Promise<DocsPageRow> {
  const db = getDb();
  let parentId: string | null = null;
  let teamspaceId: string | null = null;
  const parentItem = item.parent_notion_id ? await getItem(run.ws, item.parent_notion_id) : null;
  let parentLocal = parentItem?.local_page_id ?? null;
  if (parentItem?.kind === 'row') {
    // Página dentro de una fila: va debajo de la página de la base.
    const dbItem = parentItem.parent_notion_id ? await getItem(run.ws, parentItem.parent_notion_id) : null;
    parentLocal = dbItem?.local_page_id ?? null;
  }
  if (parentLocal) {
    const p = (await db.prepare('SELECT teamspace_id FROM docs_pages WHERE id = ? AND user_id = ? AND archived = 0').get(parentLocal, run.ws)) as
      | { teamspace_id: string | null }
      | undefined;
    if (p) {
      parentId = parentLocal;
      teamspaceId = p.teamspace_id ?? null;
    }
  }
  if (!parentId && run.conn.teamspace_id) {
    const ts = (await db.prepare('SELECT workspace_id, deleted_at FROM docs_teamspaces WHERE id = ?').get(run.conn.teamspace_id)) as
      | { workspace_id: string; deleted_at: string | null }
      | undefined;
    if (ts && ts.workspace_id === run.ws && !ts.deleted_at) teamspaceId = run.conn.teamspace_id;
  }
  const { cleanContent } = await import('./docs');
  const body = stringifyBlocks(cleanContent(content.length ? content : [{ id: crypto.randomUUID(), type: 'paragraph', content: '' }]));
  const now = new Date().toISOString();
  await db
    .prepare('INSERT INTO docs_pages (id, user_id, parent_id, title, icon, content, teamspace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(item.local_page_id, run.ws, parentId, title.slice(0, 500), icon, body, teamspaceId, created || now, now);
  // El import de una vez (Docs › Importar › Notion) la reconoce y no la duplica.
  await setExternalId(run.ws, NOTION_API_SOURCE, 'page', item.notion_id, item.local_page_id!).catch(() => undefined);
  await logSync(run.ws, 'in', 'created', title, item.local_page_id);
  return (await localPage(run, item.local_page_id))!;
}

// ---------- Notion → bloques de Docs ----------

interface RemoteBody {
  blocks: DocsBlock[];
  hash: Record<string, string>;
  edited: Record<string, string>;
  info: Record<string, { n: string; ro?: boolean; rows?: string[]; p?: string | null; t?: string }>;
  readOnly: Set<string>;
  truncated: boolean;
}

/**
 * Cuerpo de una página (o fila) en Notion convertido a bloques de Docs con
 * los ids del mapa: lo ya sincronizado conserva su id; lo nuevo recibe uno
 * estable derivado del id de Notion.
 */
async function readRemoteBody(run: Run, notionId: string, state: PageSyncState): Promise<RemoteBody> {
  const tree = await fetchBlockTree(run.client, notionId);
  const reverse = new Map<string, string>();
  for (const [docsId, e] of Object.entries(state.blocks)) reverse.set(normalizeNotionId(e.n), docsId);
  const used = new Set<string>();
  const idToNid = new Map<string, string>();
  const nidToId = new Map<string, string>();
  const ctx = {
    ...forwardContext(run),
    blockId(nid: string) {
      const k = normalizeNotionId(nid);
      let id = reverse.get(k) ?? stableId(k, 'blk');
      if (used.has(id)) id = stableId(k, 'blk', String(used.size));
      used.add(id);
      idToNid.set(id, k);
      if (!nidToId.has(k)) nidToId.set(k, id);
      return id;
    },
  };
  const conv = convertBlocks(tree.nodes, ctx);
  const blocks = await resolveNotionMedia(run.client, run.ws, conv, true);

  // Lo que sabemos de cada bloque de Notion (tipo, padre, hora, solo lectura, filas).
  const nodeInfo = new Map<string, { type: string; parent: string | null; edited: string; ro: boolean; rows?: string[] }>();
  const walk = (nodes: NBlockNode[], parent: string | null, ro: boolean) => {
    for (const node of nodes) {
      const b = node.block;
      const k = normalizeNotionId(b.id);
      const selfRo = ro || b.type === 'child_page' || b.type === 'child_database' || b.type === 'link_to_page';
      const rows = b.type === 'table' ? node.children.filter((c) => c.block.type === 'table_row').map((c) => normalizeNotionId(c.block.id)) : undefined;
      nodeInfo.set(k, { type: b.type, parent, edited: String((b as { last_edited_time?: string }).last_edited_time ?? ''), ro: selfRo, ...(rows ? { rows } : {}) });
      if (b.type === 'table') continue;
      // Contenido de un sincronizado de Notion: queda al mismo nivel y de solo lectura.
      if (b.type === 'synced_block') walk(node.children, parent, true);
      else walk(node.children, k, selfRo);
    }
  };
  walk(tree.nodes, null, false);

  const out: RemoteBody = { blocks, hash: {}, edited: {}, info: {}, readOnly: new Set(), truncated: tree.truncated };
  for (const b of blocks) {
    const nid = idToNid.get(b.id);
    if (!nid) continue;
    const info = nodeInfo.get(nid);
    const dup = nidToId.get(nid) !== b.id;
    out.hash[b.id] = blockHash(b);
    out.edited[b.id] = info?.edited ?? '';
    const ro = Boolean(info?.ro) || dup;
    if (ro) out.readOnly.add(b.id);
    out.info[b.id] = {
      n: nid,
      t: info?.type,
      p: info?.parent ? (nidToId.get(info.parent) ?? null) : null,
      ...(ro ? { ro: true } : {}),
      ...(info?.rows ? { rows: info.rows } : {}),
    };
  }
  return out;
}

// ---------- Docs → Notion: cuerpo ----------

const MAX_PUSH_FILE = 20 * 1024 * 1024;

async function readStoredFile(url: string): Promise<Buffer | null> {
  const { isDocsUploadUrl } = await import('./docs-files');
  if (!isDocsUploadUrl(url)) return null;
  if (url.startsWith('/uploads/')) {
    const { localUploadPath } = await import('./uploads');
    const file = localUploadPath(url, 'docs');
    return file ? readFile(file).catch(() => null) : null;
  }
  // Solo el storage de Docs (isDocsUploadUrl), sin hosts privados ni redirects, y con tope de tamaño leyendo.
  const { safeFetch } = await import('./safe-fetch');
  const res = await safeFetch(url, {}, 20_000, { maxRedirects: 0 }).catch(() => null);
  if (!res?.ok) return null;
  return readCapped(res, MAX_PUSH_FILE);
}

/** Sube un archivo de Docs a Notion (File Upload API) y devuelve la referencia para el bloque. */
async function uploadFile(run: Run, b: DocsBlock): Promise<NotionFileRef | null> {
  if (!b.url) return null;
  const buf = await readStoredFile(b.url);
  if (!buf || buf.length > MAX_PUSH_FILE) return null;
  const name = (b.name || 'file').slice(0, 200);
  const mime = b.mime || 'application/octet-stream';
  try {
    const up: { id: string } = await run.client.post('/file_uploads', { mode: 'single_part', filename: name, content_type: mime });
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buf)], { type: mime }), name);
    await run.client.send(`/file_uploads/${encodeURIComponent(up.id)}/send`, form);
    run.writes += 2;
    return { type: 'file_upload', file_upload: { id: up.id } };
  } catch (e) {
    if (e instanceof ImportError && e.code === 'unauthorized') throw e;
    return null;
  }
}

/** Payload de un bloque con los hijos que Notion pide en el mismo pedido (columnas, tabla). */
async function buildPayload(run: Run, b: DocsBlock, all: DocsBlock[], index: number, files: Map<string, NotionFileRef | null>): Promise<{ req: NotionBlockReq; nested: string[][] } | null> {
  const ctx = { ...reverseContext(run), fileFor: (x: DocsBlock) => files.get(x.id) ?? null };
  if (MEDIA.has(b.type) && !files.has(b.id)) files.set(b.id, await uploadFile(run, b));
  const req = docsBlockToNotion(b, ctx);
  if (!req) return null;
  if (b.type !== 'columns') return { req, nested: [] };
  // Columnas: cada columna con sus hijos directos (Notion las crea juntas).
  const d = blockIndent(b);
  const columns: NotionBlockReq[] = [];
  const nested: string[][] = [];
  for (let j = index + 1; j < all.length && blockIndent(all[j]) > d; j++) {
    if (all[j].type !== 'column' || blockIndent(all[j]) !== d + 1) continue;
    const kids: NotionBlockReq[] = [];
    const ids: string[] = [];
    for (let k = j + 1; k < all.length && blockIndent(all[k]) > d + 1; k++) {
      if (blockIndent(all[k]) !== d + 2) continue;
      const kid = all[k];
      if (MEDIA.has(kid.type) && !files.has(kid.id)) files.set(kid.id, await uploadFile(run, kid));
      const kr = docsBlockToNotion(kid, ctx);
      if (!kr || kid.type === 'columns' || kid.type === 'column') continue;
      kids.push(kr);
      ids.push(kid.id);
    }
    if (!kids.length) kids.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [] } });
    columns.push({ ...(docsBlockToNotion(all[j], ctx) ?? { object: 'block', type: 'column', column: {} }), column: { children: kids } });
    nested.push([all[j].id, ...ids]);
  }
  if (columns.length < 2) return null;
  return { req: { ...req, column_list: { children: columns } }, nested };
}

/** Hijos de un bloque en Notion (todas las páginas). */
async function listChildren(run: Run, id: string): Promise<NBlock[]> {
  const out: NBlock[] = [];
  let next: string | null = null;
  for (let i = 0; i < 20; i++) {
    const res: NList<NBlock> = await run.client.get(`/blocks/${encodeURIComponent(id)}/children?page_size=100${next ? `&start_cursor=${encodeURIComponent(next)}` : ''}`);
    out.push(...(res.results ?? []));
    next = res.has_more ? res.next_cursor : null;
    if (!next) break;
  }
  return out;
}

/**
 * Manda a Notion lo que cambió en Docs desde la última sincronización:
 * borra, recrea lo movido, edita lo cambiado y crea lo nuevo en su lugar.
 * Devuelve el mapa al día (lo guarda el que llama aunque se corte a la mitad).
 */
async function pushBody(run: Run, parentNotionId: string, local: DocsBlock[], state: PageSyncState): Promise<{ state: PageSyncState; ops: number }> {
  const plan = planPush(local, state);
  const blocks: BlockMap = { ...state.blocks };
  let ops = 0;
  const byId = new Map(local.map((b) => [b.id, b]));
  const ctx = reverseContext(run);
  const files = new Map<string, NotionFileRef | null>();

  const dropTree = (id: string) => {
    delete blocks[id];
    for (const [k, e] of Object.entries(blocks)) if (e.p === id) dropTree(k);
  };
  for (const d of plan.deletes) {
    try {
      await run.client.del(`/blocks/${encodeURIComponent(d.n)}`);
      ops++;
    } catch (e) {
      if (!(e instanceof ImportError) || (e.code !== 'not_found' && e.code !== 'invalid_request' && e.code !== 'restricted')) throw e;
    }
    dropTree(d.id);
  }
  for (const id of plan.recreate) dropTree(id);

  const lastPlaced = new Map<string, string>();
  const key = (p: string | null) => p ?? '';
  const order = plan.order;
  const index = new Map(local.map((b, i) => [b.id, i]));
  let i = 0;
  while (i < order.length) {
    const id = order[i];
    const b = byId.get(id)!;
    const parent = plan.parentOf.get(id) ?? null;
    const e = blocks[id];
    if (e) {
      if (!e.ro && !(b.type === 'column' || b.type === 'columns')) {
        const h = blockHash(b);
        if (h !== e.hl) {
          const done = await updateBlock(run, b, e, files, ctx);
          if (done === 'recreate') {
            try {
              await run.client.del(`/blocks/${encodeURIComponent(e.n)}`);
            } catch {
              /* ya no está */
            }
            dropTree(id);
            continue; // vuelve a pasar por este bloque, ahora como nuevo
          }
          blocks[id] = { ...e, hl: h, hn: '' };
          ops++;
        }
      }
      lastPlaced.set(key(parent), id);
      i++;
      continue;
    }
    const parentN = parent ? blocks[parent]?.n : parentNotionId;
    if (!parentN) {
      i++;
      continue;
    }
    // Tanda de hermanos nuevos seguidos.
    const run_: string[] = [id];
    let j = i + 1;
    while (
      j < order.length &&
      run_.length < 50 &&
      !blocks[order[j]] &&
      (plan.parentOf.get(order[j]) ?? null) === parent &&
      byId.get(order[j])!.type !== 'columns' &&
      b.type !== 'columns'
    ) {
      run_.push(order[j]);
      j++;
    }
    const payloads: Array<{ id: string; req: NotionBlockReq; nested: string[][] }> = [];
    for (const x of run_) {
      const built = await buildPayload(run, byId.get(x)!, local, index.get(x)!, files);
      if (built) payloads.push({ id: x, ...built });
    }
    if (payloads.length) {
      const after = lastPlaced.get(key(parent));
      let res: NList<NBlock>;
      try {
        res = await run.client.patch(`/blocks/${encodeURIComponent(parentN)}/children`, {
          children: payloads.map((p) => p.req),
          ...(after && blocks[after] ? { after: blocks[after].n } : {}),
        });
      } catch (e) {
        // Notion no acepta esa forma (p. ej. una columna suelta): queda solo en Docs y sigue el resto.
        if (e instanceof ImportError && e.code === 'invalid_request') {
          await logSync(run.ws, 'sys', 'error', '', null, 'invalid_request');
          i = j;
          continue;
        }
        throw e;
      }
      run.writes++;
      ops++;
      const created = res.results ?? [];
      for (let k = 0; k < payloads.length && k < created.length; k++) {
        const p = payloads[k];
        const nb = created[k];
        const lb = byId.get(p.id)!;
        blocks[p.id] = { n: normalizeNotionId(nb.id), hn: '', hl: blockHash(lb), p: parent, t: nb.type };
        if (nb.type === 'table') {
          const rows = await listChildren(run, nb.id);
          blocks[p.id].rows = rows.map((r) => normalizeNotionId(r.id));
        }
        if (nb.type === 'column_list' && p.nested.length) {
          const cols = await listChildren(run, nb.id);
          for (let c = 0; c < p.nested.length && c < cols.length; c++) {
            const [colId, ...kidIds] = p.nested[c];
            blocks[colId] = { n: normalizeNotionId(cols[c].id), hn: '', hl: blockHash(byId.get(colId)!), p: p.id, t: 'column' };
            const kids = await listChildren(run, cols[c].id);
            for (let q = 0; q < kidIds.length && q < kids.length; q++) {
              blocks[kidIds[q]] = { n: normalizeNotionId(kids[q].id), hn: '', hl: blockHash(byId.get(kidIds[q])!), p: colId, t: kids[q].type };
            }
          }
        }
      }
      lastPlaced.set(key(parent), payloads[payloads.length - 1].id);
    }
    i = j;
  }
  const seq = local.map((b) => b.id).filter((x) => blocks[x]);
  return { state: { ...state, blocks, seq }, ops };
}

/** Edita un bloque existente. 'recreate' si Notion no lo deja editar así (otro ancho de tabla, otro archivo). */
async function updateBlock(
  run: Run,
  b: DocsBlock,
  e: BlockMap[string],
  files: Map<string, NotionFileRef | null>,
  ctx: ReturnType<typeof reverseContext>,
): Promise<'ok' | 'recreate'> {
  if (MEDIA.has(b.type)) return 'recreate';
  const req = docsBlockToNotion(b, { ...ctx, fileFor: (x) => files.get(x.id) ?? null });
  if (!req) return 'ok';
  try {
    if (b.type === 'table') {
      const rows = (b.rows?.length ? b.rows : [['']]).slice(0, 100);
      const width = Math.max(1, Math.min(20, Math.max(...rows.map((r) => r.length))));
      const existing = e.rows ?? [];
      const header = { table: { has_column_header: b.header_row === true } };
      await run.client.patch(`/blocks/${encodeURIComponent(e.n)}`, header);
      for (let r = 0; r < rows.length && r < existing.length; r++) {
        await run.client.patch(`/blocks/${encodeURIComponent(existing[r])}`, { table_row: { cells: tableRow(rows[r], width, ctx).table_row ? (tableRow(rows[r], width, ctx).table_row as { cells: unknown }).cells : [] } });
      }
      const extra = rows.slice(existing.length);
      let rowIds = existing.slice(0, rows.length);
      if (extra.length) {
        const res: NList<NBlock> = await run.client.patch(`/blocks/${encodeURIComponent(e.n)}/children`, {
          children: extra.map((r) => tableRow(r, width, ctx)),
          ...(existing.length ? { after: existing[existing.length - 1] } : {}),
        });
        rowIds = [...rowIds, ...(res.results ?? []).map((x) => normalizeNotionId(x.id))];
      }
      for (const gone of existing.slice(rows.length)) await run.client.del(`/blocks/${encodeURIComponent(gone)}`).catch(() => undefined);
      e.rows = rowIds;
      run.writes++;
      return 'ok';
    }
    await run.client.patch(`/blocks/${encodeURIComponent(e.n)}`, updatePayload(req));
    run.writes++;
    return 'ok';
  } catch (err) {
    if (err instanceof ImportError && (err.code === 'invalid_request' || err.code === 'not_found')) return 'recreate';
    throw err;
  }
}

/**
 * Después de mandar: se vuelve a leer el cuerpo y se toman las huellas de
 * Notion de lo mandado (así una edición posterior en Notion se detecta y
 * lo mandado no vuelve como "cambio de Notion").
 */
async function adoptRemote(run: Run, notionId: string, state: PageSyncState): Promise<PageSyncState> {
  const remote = await readRemoteBody(run, notionId, state);
  const blocks: BlockMap = {};
  for (const [id, e] of Object.entries(state.blocks)) {
    const info = remote.info[id];
    if (!info) continue;
    blocks[id] = { ...e, n: info.n, hn: remote.hash[id] ?? e.hn, ...(info.t ? { t: info.t } : {}), ...(info.rows ? { rows: info.rows } : {}) };
  }
  return { ...state, blocks };
}

// ---------- Comentarios ----------

interface NComment {
  id: string;
  discussion_id: string;
  created_by: { id: string };
  rich_text: NRichText[];
  created_time: string;
}

async function syncComments(run: Run, item: ItemRow, pageId: string, state: PageState): Promise<void> {
  if (state.noComments || !timeLeft(run)) return;
  const db = getDb();
  const mapped = (await db.prepare('SELECT notion_id, local_id, discussion_id FROM notion_sync_comments WHERE workspace_id = ?').all(run.ws)) as Array<{
    notion_id: string;
    local_id: string;
    discussion_id: string | null;
  }>;
  const byNotion = new Map(mapped.map((m) => [m.notion_id, m]));
  const byLocal = new Map(mapped.map((m) => [m.local_id, m]));
  const { createDocComment, listDocComments } = await import('./docs');
  try {
    if (run.dirIn) {
      const res: NList<NComment> = await run.client.get(`/comments?block_id=${encodeURIComponent(item.notion_id)}&page_size=100`);
      const roots = new Map<string, string>();
      for (const m of mapped) if (m.discussion_id) roots.set(m.discussion_id, m.local_id);
      for (const c of res.results ?? []) {
        const nid = normalizeNotionId(c.id);
        if (byNotion.has(nid)) {
          if (!roots.has(c.discussion_id)) roots.set(c.discussion_id, byNotion.get(nid)!.local_id);
          continue;
        }
        // Lo que mandó esta integración ya está mapeado al crearlo.
        if (run.conn.bot_id && normalizeNotionId(c.created_by?.id ?? '') === normalizeNotionId(run.conn.bot_id)) continue;
        const author = run.notionUsers.find((u) => u.id === normalizeNotionId(c.created_by?.id ?? ''));
        const person = author?.email ? run.people.get(author.email) : undefined;
        const userId = person ?? run.conn.created_by ?? run.ws;
        // Los comentarios de Docs son texto plano.
        const text = plainText(c.rich_text).trim();
        const body = person ? text : `${author?.name || 'Notion'}: ${text}`;
        const parent = roots.get(c.discussion_id) ?? null;
        const created = await createDocComment(pageId, userId, { body: body.slice(0, 8000), parent_id: parent });
        await db
          .prepare('INSERT OR IGNORE INTO notion_sync_comments (workspace_id, notion_id, local_id, discussion_id, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(run.ws, nid, created.id, parent ? null : c.discussion_id, new Date().toISOString());
        if (!parent) roots.set(c.discussion_id, created.id);
        byLocal.set(created.id, { notion_id: nid, local_id: created.id, discussion_id: c.discussion_id });
        await logSync(run.ws, 'in', 'comment', item.title, pageId);
      }
    }
    if (run.dirOut) {
      const local = await listDocComments(pageId);
      for (const c of local) {
        if (byLocal.has(c.id) || !timeLeft(run)) continue;
        const rootMap = c.parent_id ? byLocal.get(c.parent_id) : undefined;
        const discussion = rootMap?.discussion_id ?? (rootMap ? mapped.find((m) => m.local_id === c.parent_id)?.discussion_id : undefined);
        // Autor por nombre (nunca el email) y el cuerpo como texto.
        const name = (c.user_name || '').trim();
        const rt = htmlToRichText(escapeHtml(`${name ? `${name}: ` : ''}${c.quote ? `“${c.quote}” ` : ''}${c.body}`), reverseContext(run));
        const res: NComment = await run.client.post('/comments', discussion ? { discussion_id: discussion, rich_text: rt } : { parent: { page_id: item.notion_id }, rich_text: rt });
        run.writes++;
        await db
          .prepare('INSERT OR IGNORE INTO notion_sync_comments (workspace_id, notion_id, local_id, discussion_id, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(run.ws, normalizeNotionId(res.id), c.id, c.parent_id ? null : res.discussion_id, new Date().toISOString());
        byLocal.set(c.id, { notion_id: normalizeNotionId(res.id), local_id: c.id, discussion_id: c.parent_id ? null : res.discussion_id });
        await logSync(run.ws, 'out', 'comment', item.title, pageId);
      }
    }
  } catch (e) {
    // Integración sin "leer/insertar comentarios": se deja de pedir para esta página.
    if (e instanceof ImportError && (e.code === 'restricted' || e.code === 'invalid_request')) {
      state.noComments = true;
      return;
    }
    throw e;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function timeLeft(run: Run): boolean {
  return Date.now() < run.deadline;
}

// ---------- Página ----------

export type SyncOutcome = 'synced' | 'gone' | 'skipped' | 'later';

/** Una página de Notion ↔ su página de Docs (título, ícono, cuerpo y comentarios). */
export async function syncPage(run: Run, item: ItemRow): Promise<SyncOutcome> {
  let page: NPage;
  try {
    page = await run.client.get(`/pages/${encodeURIComponent(item.notion_id)}`);
  } catch (e) {
    if (isGoneError(e)) return remoteGone(run, item);
    throw e;
  }
  let row = await localPage(run, item.local_page_id);
  const st = parseState<PageState>(item.state, emptyPage());
  const remoteArchived = Boolean(page.archived || page.in_trash);
  const remoteTitle = pageTitle(page);
  const remoteIcon = iconEmoji(page.icon ?? null);

  if (!row) {
    if (item.state) {
      // Borrada para siempre en Docs.
      if (run.dirOut && !remoteArchived) {
        await run.client.patch(`/pages/${encodeURIComponent(item.notion_id)}`, { archived: true });
        run.writes++;
        await logSync(run.ws, 'out', 'archived', item.title, null);
      }
      return 'gone';
    }
    if (!run.dirIn || remoteArchived) return 'skipped';
    row = await createLocal(run, item, remoteTitle, remoteIcon, [], page.created_time);
  }

  if (remoteArchived !== (row.archived === 1)) {
    // Papelera de un lado: gana quien la movió por último.
    const remoteNewer = Date.parse(page.last_edited_time) >= Date.parse(row.updated_at);
    if (remoteArchived && run.dirIn && (remoteNewer || !run.dirOut)) {
      await saveLocal(run, row, { archived: true });
      await logSync(run.ws, 'in', 'archived', row.title, row.id);
    } else if (!remoteArchived && run.dirOut) {
      await run.client.patch(`/pages/${encodeURIComponent(item.notion_id)}`, { archived: true });
      run.writes++;
      await logSync(run.ws, 'out', 'archived', row.title, row.id);
    } else if (remoteArchived && run.dirOut) {
      await run.client.patch(`/pages/${encodeURIComponent(item.notion_id)}`, { archived: false });
      run.writes++;
      await logSync(run.ws, 'out', 'restored', row.title, row.id);
    } else if (!remoteArchived && run.dirIn) {
      await saveLocal(run, row, { archived: false });
      await logSync(run.ws, 'in', 'restored', row.title, row.id);
    }
    await saveItem(run.ws, item.notion_id, { state: JSON.stringify(st), synced_edited: page.last_edited_time, notion_edited: page.last_edited_time });
    return 'synced';
  }
  if (remoteArchived) return 'synced';

  const result = await syncBody(run, item, st, {
    title: remoteTitle,
    icon: remoteIcon,
    edited: page.last_edited_time,
    local: async () => {
      const r = (await localPage(run, row!.id))!;
      return { blocks: await parse(r.content), edited: r.updated_at, title: r.title, icon: r.icon, row: r };
    },
    save: async (r, blocks, title, icon) => saveLocal(run, r, { content: blocks, title, icon }),
    pushMeta: async (title, icon) => {
      await run.client.patch(`/pages/${encodeURIComponent(item.notion_id)}`, {
        properties: { title: { title: htmlToRichText(escapeHtml(title), reverseContext(run)) } },
        ...(icon ? { icon: { type: 'emoji', emoji: icon } } : {}),
      });
      run.writes++;
    },
  });
  if (result === 'later') return 'later';
  if (row) await syncComments(run, item, row.id, st).catch((e) => {
    if (e instanceof ImportError && e.code === 'unauthorized') throw e;
  });
  await saveItem(run.ws, item.notion_id, { state: JSON.stringify(st) });
  return 'synced';
}

interface LocalSide {
  blocks: DocsBlock[];
  edited: string;
  title: string;
  icon: string | null;
  row: DocsPageRow;
}

/**
 * Cuerpo (y título e ícono) de una página o fila: leer Notion, fusionar,
 * guardar en Docs, mandar a Notion. Deja el estado en `st` y en la fila del mapa.
 */
async function syncBody(
  run: Run,
  item: ItemRow,
  st: PageState,
  side: {
    title: string | null;
    icon: string | null;
    edited: string;
    local(): Promise<LocalSide>;
    save(row: DocsPageRow, blocks: DocsBlock[], title: string | undefined, icon: string | null | undefined): Promise<DocsPageRow>;
    pushMeta?(title: string, icon: string | null): Promise<void>;
  },
): Promise<'ok' | 'later'> {
  const remote = await readRemoteBody(run, item.notion_id, st);
  if (remote.truncated) {
    await logSync(run.ws, 'sys', 'too_large', item.title, item.local_page_id);
    await saveItem(run.ws, item.notion_id, { error: 'content_truncated' });
    return 'ok';
  }
  let l = await side.local();
  const first = !item.state;

  // Título e ícono: cambió de un lado o del otro desde la última vez.
  let title: string | undefined;
  let icon: string | null | undefined;
  let pushTitle = false;
  if (side.title !== null) {
    const prevT = st.title;
    const rc = first || (prevT ? side.title !== prevT.n : true);
    const lc = !first && prevT ? l.title !== prevT.l : false;
    if (run.dirIn && rc && (!lc || Date.parse(side.edited) > Date.parse(l.edited)) && side.title !== l.title) title = side.title;
    else if (run.dirOut && lc && l.title !== side.title) pushTitle = true;
    const prevI = st.icon;
    const ric = first || (prevI ? side.icon !== prevI.n : true);
    const lic = !first && prevI ? l.icon !== prevI.l : false;
    if (run.dirIn && ric && (!lic || Date.parse(side.edited) > Date.parse(l.edited)) && side.icon !== l.icon) icon = side.icon;
    else if (run.dirOut && lic && l.icon !== side.icon) pushTitle = true;
  }

  let decisions: Record<string, 'remote' | 'local' | 'same' | 'drop' | 'new_remote' | 'local_only'>;
  if (run.dirIn) {
    const merge = mergeBlocks({
      local: first ? [] : l.blocks,
      remote: remote.blocks,
      remoteHash: remote.hash,
      remoteEdited: remote.edited,
      localEdited: l.edited,
      state: st,
      readOnly: remote.readOnly,
    });
    // La primera vez la página de Docs es la de Notion (si estaba vacía o se creó recién).
    let blocks = merge.blocks;
    if (first && l.blocks.some((b) => b.content || b.type !== 'paragraph')) {
      // Ya había contenido en Docs (reconectar o import de una vez): lo de Notion manda y lo de Docs queda en el historial.
      const { saveDocVersion } = await import('./docs-versions');
      await saveDocVersion(run.ws, l.row.id, null, 'auto').catch(() => null);
      blocks = merge.blocks;
    }
    decisions = merge.decisions;
    const winsNotion = merge.conflicts.filter((c) => c.winner === 'notion');
    if (winsNotion.length) {
      // Lo que pierde Docs queda como versión antes de escribir.
      const { saveDocVersion } = await import('./docs-versions');
      await saveDocVersion(run.ws, l.row.id, null, 'auto').catch(() => null);
    }
    for (const c of merge.conflicts) await logSync(run.ws, 'sys', c.winner === 'notion' ? 'conflict_notion' : 'conflict_docs', item.title, item.local_page_id, c.lost || null);
    if (merge.changed || title !== undefined || icon !== undefined) {
      try {
        const saved = await side.save(l.row, blocks, title, icon);
        l = { ...(await side.local()), row: saved };
      } catch (e) {
        if (e instanceof Error && e.name === 'DocsConflictError') return 'later';
        if (e instanceof Error && e.message === 'conflict') return 'later';
        throw e;
      }
      if (merge.changed && !first) await logSync(run.ws, 'in', 'updated', item.title, item.local_page_id);
    }
  } else {
    // Docs → Notion: lo de Notion no entra; lo que ya no está allá se vuelve a crear.
    decisions = {};
    for (const id of Object.keys(st.blocks)) decisions[id] = remote.info[id] ? 'local' : 'local_only';
  }
  let next: PageSyncState = stateAfterMerge(st, { decisions }, l.blocks, remote.hash, remote.info);

  if (run.dirOut && timeLeft(run)) {
    const pushed = await pushBody(run, item.notion_id, l.blocks, next);
    next = pushed.state;
    if (pushTitle && side.pushMeta) {
      await side.pushMeta(l.title, l.icon);
      pushed.ops++;
    }
    if (pushed.ops) {
      next = await adoptRemote(run, item.notion_id, next);
      await logSync(run.ws, 'out', 'updated', l.title || item.title, item.local_page_id);
    }
  }
  st.blocks = next.blocks;
  st.seq = next.seq;
  if (side.title !== null) {
    st.title = { n: pushTitle ? l.title : (title ?? side.title), l: l.title };
    st.icon = { n: pushTitle ? l.icon : icon !== undefined ? icon : side.icon, l: l.icon };
  }
  // Hora de Notion después de lo mandado: el sondeo no lo vuelve a traer.
  let edited = side.edited;
  if (run.dirOut && run.writes) {
    try {
      const p: { last_edited_time: string } = await run.client.get(`/pages/${encodeURIComponent(item.notion_id)}`);
      edited = p.last_edited_time;
    } catch {
      /* queda la anterior: a lo sumo se vuelve a sincronizar sin cambios */
    }
  }
  await saveItem(run.ws, item.notion_id, {
    state: JSON.stringify(st),
    title: (l.title || item.title).slice(0, 500),
    synced_edited: edited,
    notion_edited: edited,
    local_synced_at: l.edited,
    error: null,
  });
  return 'ok';
}

async function remoteGone(run: Run, item: ItemRow): Promise<SyncOutcome> {
  // Ya no está o se dejó de compartir: la página de Docs queda (se avisa) y el par se suelta.
  await logSync(run.ws, 'in', 'unshared', item.title, item.local_page_id);
  return 'gone';
}

// ---------- Docs → Notion: páginas nuevas ----------

/** Página creada en Docs debajo de una sincronizada: se crea en Notion y queda en el mapa. */
export async function createRemotePage(run: Run, row: DocsPageRow, parent: ItemRow): Promise<ItemRow | null> {
  if (parent.kind !== 'page') return null;
  const blocks = await parse(row.content);
  const dbBlock = blocks.find((b) => b.type === 'database' && b.db && !b.db.sync && !b.linked);
  const onlyDb = dbBlock && blocks.every((b) => b === dbBlock || (b.type === 'paragraph' && !b.content));
  const now = new Date().toISOString();
  if (onlyDb) {
    // Página que es una base: base de Notion con las propiedades que Notion tiene.
    const properties: Record<string, unknown> = {};
    for (const p of dbBlock.db!.properties) {
      const schema = dbSchemaToNotion(p);
      if (schema) properties[p.type === 'title' ? p.name || 'Name' : p.name] = schema;
    }
    if (!Object.values(properties).some((v) => (v as Record<string, unknown>).title)) properties.Name = { title: {} };
    const res: NDatabase = await run.client.post('/databases', {
      parent: { type: 'page_id', page_id: parent.notion_id },
      title: htmlToRichText(escapeHtml(row.title || dbBlock.db!.title || 'Untitled'), reverseContext(run)),
      properties,
    });
    run.writes++;
    const nid = normalizeNotionId(res.id);
    // Ids de las propiedades de Docs ↔ Notion (por nombre).
    const props: DbState['props'] = {};
    for (const p of dbBlock.db!.properties) {
      const np = Object.values(res.properties ?? {}).find((x) => x.name === p.name || (p.type === 'title' && x.type === 'title'));
      if (np) props[p.id] = { n: np.id, name: np.name };
    }
    const state: DbState = { props, rows: {}, title: { n: row.title, l: row.title } };
    const it = await newItem(run, nid, 'database', row.title, parent, row.id, null, JSON.stringify({ ...state, block: dbBlock.id }));
    await logSync(run.ws, 'out', 'created', row.title, row.id);
    return it;
  }
  const res: NPage = await run.client.post('/pages', {
    parent: { page_id: parent.notion_id },
    properties: { title: { title: htmlToRichText(escapeHtml(row.title), reverseContext(run)) } },
    ...(row.icon ? { icon: { type: 'emoji', emoji: row.icon } } : {}),
  });
  run.writes++;
  const nid = normalizeNotionId(res.id);
  const state: PageState = { blocks: {}, seq: [], title: { n: row.title, l: row.title }, icon: { n: row.icon, l: row.icon } };
  const it = await newItem(run, nid, 'page', row.title, parent, row.id, null, JSON.stringify(state), now);
  await logSync(run.ws, 'out', 'created', row.title, row.id);
  return it;
}

async function newItem(
  run: Run,
  nid: string,
  kind: ItemRow['kind'],
  title: string,
  parent: ItemRow,
  localPageId: string | null,
  rowId: string | null,
  state: string | null,
  edited: string | null = null,
): Promise<ItemRow> {
  await insertItem({
    workspace_id: run.ws,
    notion_id: nid,
    kind,
    title: title.slice(0, 500),
    parent_notion_id: parent.notion_id,
    parent_kind: parent.kind,
    root_id: parent.root_id ?? parent.notion_id,
    depth: parent.depth + 1,
    local_page_id: localPageId,
    row_id: rowId,
    notion_edited: edited,
    synced_edited: null,
    local_synced_at: null,
    state,
    status: 'pending',
  });
  const it = (await getItem(run.ws, nid))!;
  indexItem(run.ids, it);
  return it;
}

// ---------- Bases ----------

async function queryRows(run: Run, notionId: string): Promise<NPage[]> {
  const out: NPage[] = [];
  let next: string | null = null;
  for (let i = 0; i < 50; i++) {
    const res: NList<NPage> = await run.client.post(`/databases/${encodeURIComponent(notionId)}/query`, { page_size: 100, ...(next ? { start_cursor: next } : {}) });
    out.push(...(res.results ?? []).filter((p) => !p.archived && !p.in_trash));
    next = res.has_more ? res.next_cursor : null;
    if (!next) break;
  }
  return out;
}

const vHash = (v: unknown) => hashOf(v === undefined || v === '' || (Array.isArray(v) && !v.length) ? null : v);

/**
 * Base de Notion ↔ bloque database de Docs: esquema, filas y valores. Por
 * propiedad gana el último que la editó; fórmulas, rollups y fechas de
 * creación vienen siempre de Notion. Los cuerpos de las filas van aparte
 * (un ítem `row` por fila).
 */
export async function syncDatabase(run: Run, item: ItemRow): Promise<SyncOutcome> {
  let ndb: NDatabase;
  try {
    ndb = await run.client.get(`/databases/${encodeURIComponent(item.notion_id)}`);
  } catch (e) {
    if (isGoneError(e)) return remoteGone(run, item);
    throw e;
  }
  const remoteRows = await queryRows(run, item.notion_id);
  const st = parseState<DbState & { block?: string }>(item.state, { props: {}, rows: {} });
  let row = await localPage(run, item.local_page_id);
  const remoteArchived = Boolean(ndb.archived || ndb.in_trash);
  if (!row) {
    if (item.state) {
      if (run.dirOut && !remoteArchived) {
        await run.client.patch(`/databases/${encodeURIComponent(item.notion_id)}`, { archived: true });
        run.writes++;
      }
      return 'gone';
    }
    if (!run.dirIn || remoteArchived) return 'skipped';
    row = await createLocal(run, item, pageTitle(ndb) || 'Untitled', iconEmoji(ndb.icon ?? null), [], ndb.created_time);
  }
  if (remoteArchived) {
    if (run.dirIn && row.archived === 0) {
      await saveLocal(run, row, { archived: true });
      await logSync(run.ws, 'in', 'archived', row.title, row.id);
    }
    return 'synced';
  }

  // Filas: id local (el del mapa, o uno estable).
  const rowIds = new Map<string, string>();
  for (const r of remoteRows) {
    const nid = normalizeNotionId(r.id);
    const known = run.ids.byNotion.get(nid);
    rowIds.set(nid, known?.row_id ?? stableId(nid, 'row'));
  }
  const inputs: NotionRowInput[] = remoteRows.map((r) => ({
    notionId: normalizeNotionId(r.id),
    rowId: rowIds.get(normalizeNotionId(r.id))!,
    created: r.created_time,
    edited: r.last_edited_time,
    properties: r.properties,
  }));
  const fwd = forwardContext(run);
  const ctx: DatabaseConvertContext = {
    ...fwd,
    personFor: (email) => (email ? (run.people.get(email.toLowerCase()) ?? null) : null),
    user: (id) => run.notionUsers.find((u) => u.id === normalizeNotionId(id)) ?? null,
    databaseFor(dbId) {
      const it = run.ids.byNotion.get(dbId);
      if (!it || it.kind !== 'database' || !it.local_page_id) return null;
      return { pageId: it.local_page_id, blockId: it.notion_id === item.notion_id ? (st.block ?? databaseBlockId(dbId)) : databaseBlockId(dbId) };
    },
    rowFor: (pageId) => run.ids.byNotion.get(pageId)?.row_id ?? rowIds.get(pageId) ?? null,
  };
  const conv = convertDatabase(ndb, inputs, ctx);
  const remoteDb = conv.block.db!;

  // Ids de propiedades y opciones de Notion → los de Docs (lo creado en Docs tiene los suyos).
  const localBlocks = await parse(row.content);
  const blockId = st.block ?? databaseBlockId(item.notion_id);
  const localBlock = localBlocks.find((b) => b.id === blockId && b.type === 'database' && b.db);
  const localDb = localBlock?.db;
  alignRemote(remoteDb, localDb, st, ndb);

  // Archivos de propiedades files: se bajan solo para filas nuevas o sin archivos.
  const filesByRow = new Map<string, Record<string, DbFile[]>>();
  for (const f of conv.files) {
    const lr = localDb?.rows.find((r) => r.id === f.rowId);
    const propId = st.props && Object.entries(st.props).find(([, v]) => stableId(normalizeNotionId(ndb.id), v.n) === f.propId)?.[0];
    const pid = propId ?? f.propId;
    if (lr?.files?.[pid]?.length) continue;
    if (!f.hosted) continue;
    const saved = await downloadNotionFile(run.client, run.ws, f.url, f.name);
    if (!saved) continue;
    const cur = filesByRow.get(f.rowId) ?? {};
    cur[pid] = [...(cur[pid] ?? []), { id: crypto.randomUUID(), url: saved.url, name: saved.name, size: saved.size, mime: saved.mime }];
    filesByRow.set(f.rowId, cur);
  }

  const merged = mergeDatabase(run, localDb, remoteDb, st, remoteRows, rowIds);
  for (const [rid, files] of filesByRow) {
    const r = merged.db.rows.find((x) => x.id === rid);
    if (r) r.files = { ...(r.files ?? {}), ...files };
  }
  // Título de la base (y de su página).
  const remoteTitle = pageTitle(ndb);
  const titleLc = st.title ? row.title !== st.title.l : false;
  const titleRc = st.title ? remoteTitle !== st.title.n : true;
  let newTitle: string | undefined;
  let pushTitle = false;
  if (run.dirIn && titleRc && !titleLc && remoteTitle !== row.title) newTitle = remoteTitle;
  else if (run.dirOut && titleLc && row.title !== remoteTitle) pushTitle = true;

  if (run.dirIn) {
    const content = localBlock
      ? localBlocks.map((b) => (b.id === blockId ? { ...b, db: merged.db } : b))
      : [
          ...(plainText(ndb.description ?? []).trim() ? [{ id: stableId(item.notion_id, 'desc'), type: 'paragraph' as const, content: richTextToHtml(ndb.description ?? [], fwd) }] : []),
          { ...conv.block, id: blockId, db: merged.db },
          ...localBlocks.filter((b) => b.content || b.type !== 'paragraph'),
        ];
    if (JSON.stringify(content) !== JSON.stringify(localBlocks) || newTitle !== undefined) {
      if (merged.conflicts.some((c) => c === 'notion')) {
        const { saveDocVersion } = await import('./docs-versions');
        await saveDocVersion(run.ws, row.id, null, 'auto').catch(() => null);
      }
      try {
        row = await saveLocal(run, row, { content, ...(newTitle !== undefined ? { title: newTitle } : {}) });
      } catch (e) {
        if (e instanceof Error && e.name === 'DocsConflictError') return 'later';
        throw e;
      }
      if (item.state) await logSync(run.ws, 'in', 'updated', row.title, row.id);
    }
    for (const c of merged.conflicts) await logSync(run.ws, 'sys', c === 'notion' ? 'conflict_notion' : 'conflict_docs', row.title, row.id);
  }
  st.block = blockId;

  // Estado de cada fila después de guardar.
  const saved = (await parse(row.content)).find((b) => b.id === blockId)?.db ?? merged.db;
  const savedById = new Map(saved.rows.map((r) => [r.id, r]));
  const remoteById = new Map(remoteDb.rows.map((r) => [r.id, r]));
  const rowsState: DbState['rows'] = {};
  for (const r of saved.rows) {
    const rr = remoteById.get(r.id);
    if (!rr) continue;
    const prev = st.rows[r.id]?.p ?? {};
    const p: Record<string, [string, string]> = {};
    for (const prop of saved.properties) {
      const hn = vHash(rr.values[prop.id]);
      const hl = vHash(r.values[prop.id]);
      const localWon = merged.localWins.has(`${r.id}:${prop.id}`);
      p[prop.id] = [hn, localWon ? (prev[prop.id]?.[1] ?? '') : hl];
    }
    rowsState[r.id] = { p };
  }
  // Filas borradas en Docs que siguen en Notion: el estado se queda hasta archivarlas.
  for (const [rid, s] of Object.entries(st.rows)) if (!savedById.has(rid) && remoteById.has(rid)) rowsState[rid] = s;
  st.rows = rowsState;

  // Ítems de las filas (para sus cuerpos y para links a filas).
  for (const r of remoteRows) {
    const nid = normalizeNotionId(r.id);
    const rid = rowIds.get(nid)!;
    const known = await getItem(run.ws, nid);
    if (!known) {
      await newItem(run, nid, 'row', pageTitle(r), { ...item, local_page_id: row.id }, row.id, rid, null, r.last_edited_time);
    } else {
      const fields: Partial<ItemRow> = {};
      if (known.local_page_id !== row.id) fields.local_page_id = row.id;
      if (known.row_id !== rid) fields.row_id = rid;
      if (known.synced_edited !== r.last_edited_time && known.status !== 'pending') {
        fields.status = 'pending';
        fields.notion_edited = r.last_edited_time;
      }
      if (Object.keys(fields).length) await saveItem(run.ws, nid, fields);
    }
  }

  if (run.dirOut && timeLeft(run)) {
    const pushedRows = await pushDatabase(run, item, ndb, saved, st, remoteById);
    if (pushTitle) {
      await run.client.patch(`/databases/${encodeURIComponent(item.notion_id)}`, { title: htmlToRichText(escapeHtml(row.title), reverseContext(run)) });
      run.writes++;
    }
    if (pushedRows || pushTitle) await logSync(run.ws, 'out', 'updated', row.title, row.id);
  }
  // Cuerpos de filas editados en Docs: su ítem vuelve a la cola.
  for (const r of saved.rows) {
    const nid = run.ids.byRow.get(r.id);
    if (!nid) continue;
    const it = await getItem(run.ws, nid);
    if (!it || it.status === 'pending') continue;
    const bodyHash = hashOf((r.body ?? []).map((b) => blockHash(b)));
    const prev = it.state ? (JSON.parse(it.state) as { lb?: string }).lb : undefined;
    if (prev !== undefined && prev !== bodyHash && run.dirOut) await saveItem(run.ws, nid, { status: 'pending' });
  }
  st.title = { n: pushTitle ? row.title : remoteTitle, l: row.title };
  let edited = ndb.last_edited_time;
  if (run.writes) {
    try {
      const d: { last_edited_time: string } = await run.client.get(`/databases/${encodeURIComponent(item.notion_id)}`);
      edited = d.last_edited_time;
    } catch {
      /* queda la anterior */
    }
  }
  await saveItem(run.ws, item.notion_id, {
    state: JSON.stringify(st),
    title: row.title.slice(0, 500),
    local_page_id: row.id,
    synced_edited: edited,
    notion_edited: edited,
    local_synced_at: row.updated_at,
    error: null,
  });
  indexItem(run.ids, { ...item, local_page_id: row.id });
  return 'synced';
}

/** Propiedades y opciones de Notion con los ids que ya tienen en Docs (por id de Notion o por nombre). */
function alignRemote(remote: DocsDatabase, local: DocsDatabase | undefined, st: DbState, ndb: NDatabase): void {
  const dbKey = normalizeNotionId(ndb.id);
  const propMap = new Map<string, string>();
  // Por el mapa guardado (propiedad local ↔ id en Notion).
  for (const [localId, v] of Object.entries(st.props)) propMap.set(stableId(dbKey, v.n), localId);
  // Por nombre, para las que no están en el mapa (primera vez o import anterior).
  for (const p of remote.properties) {
    if (propMap.has(p.id)) continue;
    const same = local?.properties.find((lp) => lp.id === p.id) ?? local?.properties.find((lp) => lp.name === p.name && lp.type === p.type);
    if (same) propMap.set(p.id, same.id);
  }
  const notionIdOf = new Map<string, string>();
  for (const [name, s] of Object.entries(ndb.properties ?? {})) notionIdOf.set(stableId(dbKey, s.id || name), s.id || name);
  const nextProps: Record<string, { n: string; name: string }> = {};
  for (const p of remote.properties) {
    const nId = notionIdOf.get(p.id);
    const localId = propMap.get(p.id) ?? p.id;
    if (nId) nextProps[localId] = { n: nId, name: p.name };
    const lp = local?.properties.find((x) => x.id === localId);
    // Opciones: las de Docs con el mismo nombre conservan su id.
    const optMap = new Map<string, string>();
    if (p.options && lp?.options) {
      for (const o of p.options) {
        const same = lp.options.find((x) => x.name === o.name);
        if (same) optMap.set(o.id, same.id);
      }
      p.options = p.options.map((o) => ({ ...o, id: optMap.get(o.id) ?? o.id }));
    }
    for (const r of remote.rows) {
      if (!(p.id in r.values)) continue;
      let v = r.values[p.id];
      if (optMap.size) v = Array.isArray(v) ? v.map((x) => optMap.get(x) ?? x) : typeof v === 'string' ? (optMap.get(v) ?? v) : v;
      delete r.values[p.id];
      r.values[localId] = v;
    }
    p.id = localId;
  }
  st.props = nextProps;
}

function mergeDatabase(
  run: Run,
  local: DocsDatabase | undefined,
  remote: DocsDatabase,
  st: DbState,
  remoteRows: NPage[],
  rowIds: Map<string, string>,
): { db: DocsDatabase; conflicts: Array<'notion' | 'docs'>; localWins: Set<string> } {
  const conflicts: Array<'notion' | 'docs'> = [];
  const localWins = new Set<string>();
  if (!local) return { db: remote, conflicts, localWins };
  const remoteEdited = new Map<string, string>();
  for (const r of remoteRows) remoteEdited.set(rowIds.get(normalizeNotionId(r.id))!, r.last_edited_time);
  // Esquema: el de Notion para lo que está allá; lo creado en Docs se suma (y se manda).
  const props: DbProperty[] = remote.properties.map((rp) => {
    const lp = local.properties.find((p) => p.id === rp.id);
    if (!lp) return rp;
    const nameLc = st.props[rp.id] ? lp.name !== st.props[rp.id].name : false;
    const options = [...(rp.options ?? [])];
    for (const o of lp.options ?? []) if (!options.some((x) => x.name === o.name)) options.push(o);
    return { ...lp, ...rp, name: nameLc ? lp.name : rp.name, ...(rp.options || lp.options ? { options } : {}) };
  });
  for (const lp of local.properties) {
    if (props.some((p) => p.id === lp.id)) continue;
    // Borrada en Notion (estaba en el mapa): se va; si no, es nueva de Docs.
    if (st.props[lp.id] && !run.dirOut) continue;
    if (st.props[lp.id]) continue;
    props.push(lp);
  }
  const remoteById = new Map(remote.rows.map((r) => [r.id, r]));
  const localById = new Map(local.rows.map((r) => [r.id, r]));
  const rows: DbRow[] = [];
  const readOnly = new Set(props.filter((p) => READ_ONLY_PROPS.has(p.type) && p.type !== 'files').map((p) => p.id));
  for (const lr of local.rows) {
    const rr = remoteById.get(lr.id);
    const s = st.rows[lr.id];
    if (!rr) {
      if (s) {
        // Borrada en Notion. Editada acá: gana la edición (se vuelve a crear allá).
        const changed = Object.entries(lr.values).some(([pid, v]) => vHash(v) !== (s.p[pid]?.[1] ?? vHash(null)));
        if (changed && run.dirOut) {
          delete st.rows[lr.id];
          rows.push(lr);
        }
        continue;
      }
      rows.push(lr); // nueva en Docs
      continue;
    }
    const values: Record<string, DbValue> = { ...lr.values };
    for (const p of props) {
      const rv = rr.values[p.id];
      const lv = lr.values[p.id];
      if (readOnly.has(p.id)) {
        if (rv === undefined) delete values[p.id];
        else values[p.id] = rv;
        continue;
      }
      if (p.type === 'files') continue;
      const sp = s?.p[p.id];
      const rc = sp ? vHash(rv) !== sp[0] : vHash(rv) !== vHash(lv);
      const lc = sp ? vHash(lv) !== sp[1] : false;
      let take: 'remote' | 'local' = 'local';
      if (rc && !lc) take = 'remote';
      else if (rc && lc) {
        const rt = Date.parse(remoteEdited.get(lr.id) ?? '') || 0;
        const lt = Date.parse(lr.updated_at) || 0;
        take = rt > lt ? 'remote' : 'local';
        conflicts.push(take === 'remote' ? 'notion' : 'docs');
      }
      if (!s && run.dirIn) take = 'remote';
      if (!run.dirIn) take = 'local';
      if (take === 'remote') {
        if (rv === undefined || rv === null) delete values[p.id];
        else values[p.id] = rv;
      } else if (lc || (!s && !run.dirIn)) localWins.add(`${lr.id}:${p.id}`);
    }
    rows.push({ ...lr, values, created_at: lr.created_at || rr.created_at });
  }
  for (const rr of remote.rows) {
    if (localById.has(rr.id)) continue;
    const s = st.rows[rr.id];
    // Borrada en Docs (estaba sincronizada): se archiva allá salvo que la hayan editado en Notion.
    if (s && run.dirOut) {
      const changed = Object.entries(rr.values).some(([pid, v]) => !readOnly.has(pid) && vHash(v) !== s.p[pid]?.[0]);
      if (!changed) continue;
    }
    if (!run.dirIn && !s) continue;
    rows.push(rr);
  }
  return { db: { ...local, properties: props, rows, ...(remote.title ? { title: local.title ?? remote.title } : {}) }, conflicts, localWins };
}

type DbValue = DbRow['values'][string];

/** Docs → Notion de una base: propiedades nuevas o renombradas, filas nuevas, valores cambiados y filas borradas. */
async function pushDatabase(run: Run, item: ItemRow, ndb: NDatabase, saved: DocsDatabase, st: DbState, remoteById: Map<string, DbRow>): Promise<number> {
  let ops = 0;
  const ctx = reverseContext(run);
  // Esquema.
  const schemaPatch: Record<string, unknown> = {};
  for (const p of saved.properties) {
    const known = st.props[p.id];
    if (!known) {
      const schema = dbSchemaToNotion(p);
      if (schema && p.type !== 'title') schemaPatch[p.name] = schema;
    } else if (known.name !== p.name) {
      schemaPatch[known.n] = { name: p.name };
    }
  }
  for (const [localId, v] of Object.entries(st.props)) {
    if (!saved.properties.some((p) => p.id === localId) && v.n !== 'title') schemaPatch[v.n] = null;
  }
  if (Object.keys(schemaPatch).length) {
    const res: NDatabase = await run.client.patch(`/databases/${encodeURIComponent(item.notion_id)}`, { properties: schemaPatch });
    run.writes++;
    ops++;
    for (const p of saved.properties) {
      const np = Object.values(res.properties ?? {}).find((x) => x.name === p.name);
      if (np) st.props[p.id] = { n: np.id, name: np.name };
    }
    for (const localId of Object.keys(st.props)) if (!saved.properties.some((p) => p.id === localId)) delete st.props[localId];
  }
  const propsFor = (r: DbRow, only?: Set<string>) => {
    const out: Record<string, unknown> = {};
    for (const p of saved.properties) {
      if (only && !only.has(p.id)) continue;
      const known = st.props[p.id];
      if (!known) continue;
      const v = dbValueToNotion(p, r.values[p.id] ?? null, ctx);
      if (v !== undefined) out[known.n] = v;
    }
    return out;
  };
  for (const r of saved.rows) {
    if (!timeLeft(run)) break;
    const nid = run.ids.byRow.get(r.id);
    const s = st.rows[r.id];
    if (!nid || !remoteById.has(r.id)) {
      if (nid && s) continue; // borrada en Notion y sin cambios acá: ya salió
      // Fila nueva en Docs.
      const res: NPage = await run.client.post('/pages', { parent: { database_id: item.notion_id }, properties: propsFor(r) });
      run.writes++;
      ops++;
      const rowNid = normalizeNotionId(res.id);
      await newItem(run, rowNid, 'row', String(r.values[saved.properties.find((p) => p.type === 'title')?.id ?? ''] ?? ''), item, item.local_page_id, r.id, null, res.last_edited_time);
      const p: Record<string, [string, string]> = {};
      for (const prop of saved.properties) p[prop.id] = ['', vHash(r.values[prop.id])];
      st.rows[r.id] = { p };
      if (r.body?.length) await saveItem(run.ws, rowNid, { status: 'pending' });
      continue;
    }
    if (!s) continue;
    const changed = new Set<string>();
    for (const p of saved.properties) {
      if (READ_ONLY_PROPS.has(p.type)) continue;
      if (vHash(r.values[p.id]) !== (s.p[p.id]?.[1] ?? '')) changed.add(p.id);
    }
    if (!changed.size) continue;
    const props = propsFor(r, changed);
    if (Object.keys(props).length) {
      await run.client.patch(`/pages/${encodeURIComponent(nid)}`, { properties: props });
      run.writes++;
      ops++;
    }
    for (const pid of changed) s.p[pid] = ['', vHash(r.values[pid])];
  }
  // Filas borradas en Docs.
  for (const [rid] of Object.entries(st.rows)) {
    if (saved.rows.some((r) => r.id === rid)) continue;
    const nid = run.ids.byRow.get(rid);
    if (!nid) continue;
    await run.client.patch(`/pages/${encodeURIComponent(nid)}`, { archived: true }).catch((e) => {
      if (!isGoneError(e)) throw e;
    });
    run.writes++;
    ops++;
    delete st.rows[rid];
    await saveItem(run.ws, nid, { status: 'gone' });
    run.ids.byRow.delete(rid);
  }
  return ops;
}

// ---------- Cuerpo de una fila ----------

/** Cuerpo de una fila de una base (las propiedades las sincroniza la base). */
export async function syncRowBody(run: Run, item: ItemRow): Promise<SyncOutcome> {
  const dbItem = item.parent_notion_id ? await getItem(run.ws, item.parent_notion_id) : null;
  if (!dbItem?.local_page_id || !item.row_id) return 'later';
  let page: NPage;
  try {
    page = await run.client.get(`/pages/${encodeURIComponent(item.notion_id)}`);
  } catch (e) {
    if (isGoneError(e)) return 'gone';
    throw e;
  }
  if (page.archived || page.in_trash) return 'gone';
  const dbBlockId = dbItem.state ? ((JSON.parse(dbItem.state) as { block?: string }).block ?? databaseBlockId(dbItem.notion_id)) : databaseBlockId(dbItem.notion_id);
  const st = parseState<PageState & { lb?: string }>(item.state, emptyPage());
  const findRow = (blocks: DocsBlock[]) => blocks.find((b) => b.id === dbBlockId)?.db?.rows.find((r) => r.id === item.row_id);
  const pageRow = await localPage(run, dbItem.local_page_id);
  if (!pageRow) return 'later';
  if (!findRow(await parse(pageRow.content))) return 'later';
  const res = await syncBody(run, item, st, {
    title: null,
    icon: null,
    edited: page.last_edited_time,
    local: async () => {
      const r = (await localPage(run, dbItem.local_page_id))!;
      const blocks = await parse(r.content);
      const dbRow = findRow(blocks);
      return { blocks: dbRow?.body ?? [], edited: dbRow?.updated_at || r.updated_at, title: '', icon: null, row: r };
    },
    save: async (r, body) => {
      const blocks = await parse(r.content);
      const clean = body.filter((b) => !(b.type === 'paragraph' && !b.content && body.length === 1));
      const next = blocks.map((b) =>
        b.id === dbBlockId && b.db
          ? { ...b, db: { ...b.db, rows: b.db.rows.map((x) => (x.id === item.row_id ? { ...x, ...(clean.length ? { body: clean } : { body: undefined }) } : x)) } }
          : b,
      );
      return saveLocal(run, r, { content: next });
    },
  });
  if (res === 'later') return 'later';
  // Huella del cuerpo guardado (la base la mira para saber si se editó acá).
  const after = await localPage(run, dbItem.local_page_id);
  const body = after ? (findRow(await parse(after.content))?.body ?? []) : [];
  st.lb = hashOf(body.map((b) => blockHash(b)));
  await saveItem(run.ws, item.notion_id, { state: JSON.stringify(st) });
  return 'synced';
}

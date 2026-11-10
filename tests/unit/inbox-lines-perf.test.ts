import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { conditionalJson, etagOf } from '@/lib/etag';
import { ListCache, reuseRows } from '@/lib/conditional-fetch';
import {
  addMessage,
  applyThreadAction,
  createAccount,
  createFolder,
  decodeListCursor,
  inboxCounts,
  listFolders,
  listMessages,
  listThreads,
  listThreadsPage,
  upsertThread,
  type AccountRow,
} from '@/lib/inbox/core';
import { inboxSortKey, linesSortKey } from '@/lib/schema/inbox-lines-perf-migration';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { chatSearchMatch, connectNumber, createNumber, decodeChatCursor, getNumberRowById, ingestEvents, listChats, listMessages as listLineMessages, updateChat } from '@/lib/groups';
import { groupsViewer } from '@/lib/groups-access';
import { createFolder as createLineFolder, listFolders as listLineFolders, moveChatsToFolder, setLineAccess } from '@/lib/groups-lines';
import { parseInboxPath, inboxUrl } from '@/components/inbox/nav';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('GROUPS_PUSH_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

async function inboxOwner(label: string) {
  const u = await makeUser(label);
  const account = (await createAccount(u.id, { kind: 'whatsapp', provider: 'fake', label: 'WA' })) as AccountRow;
  return { u, account };
}

/** Un chat con un mensaje entrante a `minutesAgo` minutos. */
async function chat(account: AccountRow, n: number, minutesAgo: number, opts: { unread?: boolean; kind?: 'dm' | 'group' } = {}) {
  const t = await upsertThread(account, { externalId: `54911${String(n).padStart(8, '0')}@s.whatsapp.net`, kind: opts.kind ?? 'dm', title: `Chat ${n}`, handle: `54911${String(n).padStart(8, '0')}` });
  await addMessage(t, { externalId: `m-${n}-0`, fromMe: false, senderName: `Chat ${n}`, body: `hola ${n}`, sentAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(), history: !opts.unread });
  return t;
}

async function allPages(owner: string, opts: Parameters<typeof listThreadsPage>[1], between?: (page: number) => Promise<void>) {
  const pages: string[][] = [];
  let cursor: string | null = '';
  for (let i = 0; i < 50 && cursor !== null; i++) {
    const p = await listThreadsPage(owner, { ...opts, cursor });
    pages.push(p.threads.map((t) => t.id));
    cursor = p.next;
    if (cursor !== null && between) await between(i);
  }
  return pages;
}

describe('Inbox: la lista por páginas (cursor)', () => {
  it('recorre todos los chats sin repetir ni saltear, aunque lleguen mensajes entre página y página', async () => {
    const { u, account } = await inboxOwner('perf-ib-pages');
    const threads: Awaited<ReturnType<typeof chat>>[] = [];
    for (let i = 0; i < 23; i++) threads.push(await chat(account, i, 100 + i));
    const before = new Set(threads.map((t) => t.id));
    let extra = 0;
    const pages = await allPages(u.id, { view: 'inbox', limit: 5 }, async (page) => {
      // Entre páginas: un chat nuevo y un mensaje nuevo en un chat que ya se vio (sube al principio).
      await chat(account, 1000 + extra++, 0);
      await addMessage(threads[page], { externalId: `late-${page}`, fromMe: false, body: 'otro', sentAt: new Date().toISOString(), history: true });
    });
    const seen = pages.flat();
    expect(new Set(seen).size).toBe(seen.length);
    // Todo lo que había al empezar aparece exactamente una vez.
    for (const id of before) expect(seen.filter((x) => x === id)).toHaveLength(1);
    expect(pages.length).toBeGreaterThanOrEqual(5);
    expect(pages.slice(0, -1).every((p) => p.length === 5)).toBe(true);
  });

  it('el orden es el de siempre: fijados primero, después por último mensaje; los fijados vienen solo en la primera página', async () => {
    const { u, account } = await inboxOwner('perf-ib-order');
    const ts: Awaited<ReturnType<typeof chat>>[] = [];
    for (let i = 0; i < 9; i++) ts.push(await chat(account, i, 10 + i));
    // Un chat sin mensajes (lo trae el historial antes que sus mensajes) va al final.
    const empty = await upsertThread(account, { externalId: '5491199999999@s.whatsapp.net', kind: 'dm', title: 'Vacío' });
    await applyThreadAction(u.id, [ts[7].id], { action: 'pin' });
    const all = await listThreads(u.id, { view: 'inbox' });
    expect(all.map((t) => t.id)).toEqual([ts[7].id, ...ts.filter((_, i) => i !== 7).map((t) => t.id), empty.id]);
    const pages = await allPages(u.id, { view: 'inbox', limit: 4 });
    expect(pages[0][0]).toBe(ts[7].id);
    expect(pages.slice(1).flat()).not.toContain(ts[7].id);
    expect(pages.flat()).toEqual(all.map((t) => t.id));
    // Un cursor roto es la primera página.
    expect(decodeListCursor('no-es-un-cursor')).toBeNull();
    expect((await listThreadsPage(u.id, { view: 'inbox', limit: 4, cursor: '%%%' })).threads.map((t) => t.id)).toEqual(pages[0]);
  });

  it('cada vista pagina con su orden: pospuestos por fecha, hechos por cuándo se hicieron, no leídos y carpetas', async () => {
    const { u, account } = await inboxOwner('perf-ib-views');
    const ts: Awaited<ReturnType<typeof chat>>[] = [];
    for (let i = 0; i < 12; i++) ts.push(await chat(account, i, 10 + i, { unread: i % 2 === 0 }));
    const folder = await createFolder(u.id, { name: 'Clientes' });
    const sub = await createFolder(u.id, { name: 'VIP', parentId: folder.id });
    await applyThreadAction(u.id, ts.slice(0, 3).map((t) => t.id), { action: 'addFolder', folderId: folder.id });
    await applyThreadAction(u.id, ts.slice(3, 6).map((t) => t.id), { action: 'addFolder', folderId: sub.id });
    expect((await allPages(u.id, { view: 'unread', limit: 4 })).flat()).toEqual(ts.filter((_, i) => i % 2 === 0).map((t) => t.id));
    // La carpeta trae lo suyo y lo de sus subcarpetas, paginado igual.
    expect((await allPages(u.id, { folderId: folder.id, limit: 4 })).flat()).toEqual(ts.slice(0, 6).map((t) => t.id));
    expect((await allPages(u.id, { folderId: sub.id, limit: 2 })).flat()).toEqual(ts.slice(3, 6).map((t) => t.id));
    for (let i = 6; i < 12; i++) await applyThreadAction(u.id, [ts[i].id], { action: 'snooze', until: new Date(Date.now() + (20 - i) * 3600_000).toISOString() });
    expect((await allPages(u.id, { view: 'snoozed', limit: 4 })).flat()).toEqual([...ts.slice(6, 12)].reverse().map((t) => t.id));
    await applyThreadAction(u.id, ts.slice(0, 5).map((t) => t.id), { action: 'done' });
    const done = (await allPages(u.id, { view: 'done', limit: 2 })).flat();
    expect([...done].sort()).toEqual(ts.slice(0, 5).map((t) => t.id).sort());
    expect(new Set(done).size).toBe(5);
  });

  it('las consultas nuevas siguen filtrando por dueño: páginas, búsqueda, contadores y carpetas', async () => {
    const a = await inboxOwner('perf-ib-own-a');
    const b = await inboxOwner('perf-ib-own-b');
    for (let i = 0; i < 6; i++) await chat(a.account, i, 10 + i, { unread: true });
    const mine: Awaited<ReturnType<typeof chat>>[] = [];
    for (let i = 0; i < 4; i++) mine.push(await chat(b.account, 100 + i, 5 + i, { unread: i < 2 }));
    const bFolder = await createFolder(b.u.id, { name: 'De B' });
    await applyThreadAction(b.u.id, [mine[0].id], { action: 'addFolder', folderId: bFolder.id });
    const ruled = await createFolder(b.u.id, { name: 'Regla', rule: { kind: 'dm' } });
    expect((await allPages(b.u.id, { view: 'inbox', limit: 3 })).flat().sort()).toEqual(mine.map((t) => t.id).sort());
    expect((await allPages(b.u.id, { q: 'hola', limit: 3 })).flat().sort()).toEqual(mine.map((t) => t.id).sort());
    expect(await inboxCounts(b.u.id)).toMatchObject({ inbox: 2, reply: 4, snoozed: 0, archived: 0, scheduled: 0 });
    expect(await inboxCounts(a.u.id)).toMatchObject({ inbox: 6, reply: 6 });
    const folders = await listFolders(b.u.id);
    expect(folders.find((f) => f.id === bFolder.id)).toMatchObject({ count: 1, ownCount: 1 });
    // La carpeta por regla cuenta lo mismo que muestra su lista.
    expect(folders.find((f) => f.id === ruled.id)?.count).toBe((await listThreads(b.u.id, { folderId: ruled.id })).filter((t) => t.unread > 0).length);
    // La carpeta de otra persona no se puede listar.
    await expect(listThreadsPage(a.u.id, { folderId: bFolder.id, cursor: '' })).rejects.toMatchObject({ status: 404 });
    // Un cursor de otra persona no abre nada ajeno: sigue filtrando por dueño.
    const bPage = await listThreadsPage(b.u.id, { view: 'inbox', limit: 1, cursor: '' });
    const crossed = await listThreadsPage(a.u.id, { view: 'inbox', limit: 50, cursor: bPage.next });
    expect(crossed.threads.every((t) => !mine.some((m) => m.id === t.id))).toBe(true);
  });

  it('los contadores coinciden con lo que muestran las vistas', async () => {
    const { u, account } = await inboxOwner('perf-ib-counts');
    const ts: Awaited<ReturnType<typeof chat>>[] = [];
    for (let i = 0; i < 10; i++) ts.push(await chat(account, i, 10 + i, { unread: i < 4, kind: i === 9 ? 'group' : 'dm' }));
    await applyThreadAction(u.id, [ts[0].id], { action: 'archive' });
    await applyThreadAction(u.id, [ts[1].id], { action: 'snooze', until: new Date(Date.now() + 3600_000).toISOString() });
    await applyThreadAction(u.id, [ts[2].id], { action: 'done' });
    const counts = await inboxCounts(u.id);
    expect(counts.inbox).toBe((await listThreads(u.id, { view: 'unread' })).length);
    expect(counts.reply).toBe((await listThreads(u.id, { view: 'reply' })).length);
    expect(counts.snoozed).toBe((await listThreads(u.id, { view: 'snoozed' })).length);
    expect(counts.archived).toBe((await listThreads(u.id, { view: 'archived' })).length);
  });

  it('los índices de la lista existen y la bandeja los usa (sin ordenar todos los chats en cada consulta)', async () => {
    const { u } = await inboxOwner('perf-ib-plan');
    const names = (await getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_inbox_threads_%'").all()) as Array<{ name: string }>;
    expect(names.map((n) => n.name)).toEqual(expect.arrayContaining(['idx_inbox_threads_list', 'idx_inbox_threads_unread', 'idx_inbox_threads_reply', 'idx_inbox_threads_snoozed', 'idx_inbox_threads_pinned']));
    const key = inboxSortKey('t');
    const plan = (await getDb()
      .prepare(
        `EXPLAIN QUERY PLAN SELECT t.id FROM inbox_threads t WHERE t.owner_id = ? AND (t.done_at IS NULL AND t.archived_at IS NULL AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?))
         AND t.pinned_at IS NULL AND ${key} <= ? AND (${key} < ? OR t.id < ?) ORDER BY ${key} DESC, t.id DESC LIMIT 61`,
      )
      .all(u.id, 'z', 'z', 'z', 'z')) as Array<{ detail: string }>;
    const detail = plan.map((p) => p.detail).join(' | ');
    expect(detail).toContain('idx_inbox_threads_list');
    expect(detail).not.toContain('TEMP B-TREE');
  });
});

describe('Inbox: mensajes de un chat por páginas', () => {
  it('sube por la conversación sin saltear ni repetir mensajes de la misma hora, aunque lleguen nuevos', async () => {
    const { u, account } = await inboxOwner('perf-ib-msgs');
    const t = await upsertThread(account, { externalId: '5491100000001@s.whatsapp.net', kind: 'dm', title: 'Ráfaga' });
    // WhatsApp da la hora en segundos: una ráfaga comparte la misma.
    const same = '2026-11-01T10:00:00.000Z';
    for (let i = 0; i < 10; i++) await addMessage(t, { externalId: `r-${i}`, fromMe: false, body: `ráfaga ${i}`, sentAt: same, history: true });
    for (let i = 0; i < 5; i++) await addMessage(t, { externalId: `n-${i}`, fromMe: false, body: `después ${i}`, sentAt: `2026-11-01T10:0${i + 1}:00.000Z`, history: true });
    const got: string[] = [];
    let page = await listMessages(u.id, t.id, { limit: 4 });
    got.unshift(...page.messages.map((m) => m.body));
    for (let i = 0; i < 10 && page.more; i++) {
      // Mientras se sube, llega uno nuevo: no mueve las páginas viejas.
      await addMessage(t, { externalId: `live-${i}`, fromMe: false, body: `en vivo ${i}`, sentAt: new Date().toISOString(), history: true });
      page = await listMessages(u.id, t.id, { limit: 4, before: page.cursor ?? undefined });
      got.unshift(...page.messages.map((m) => m.body));
    }
    expect(got).toEqual([...Array.from({ length: 10 }, (_, i) => `ráfaga ${i}`), ...Array.from({ length: 5 }, (_, i) => `después ${i}`)]);
    expect(page.more).toBe(false);
    // Solo con la fecha (como antes) sigue andando: lo estrictamente anterior.
    expect((await listMessages(u.id, t.id, { before: '2026-11-01T10:01:00.000Z' })).messages).toHaveLength(10);
    // El chat de otra persona no se puede leer.
    const other = await makeUser('perf-ib-msgs-other');
    await expect(listMessages(other.id, t.id)).rejects.toMatchObject({ status: 404 });
  });
});

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

const lineMsg = (chatId: string, id: string, body: string, senderName: string, timestamp?: string) => ({
  type: 'message' as const,
  chatId,
  isGroup: false,
  fromMe: false,
  senderPhone: chatId.split('@')[0],
  senderName,
  providerMessageId: id,
  body,
  ...(timestamp ? { timestamp } : {}),
});

async function line(ws: string, label: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name: label });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return (await getNumberRowById(n.id))!;
}

async function linesWorld(label: string, chats = 17) {
  const owner = await makeUser(`${label}-ws`);
  const pablo = await makeUser(`${label}-pablo`);
  const ruth = await makeUser(`${label}-ruth`);
  const team = (await createTeam(owner.id, 'Workspace')).id;
  for (const p of [pablo, ruth]) await addMember(team, p.id, 'member');
  const pub = await line(owner.id, 'Pública');
  const priv = await line(owner.id, 'Privada');
  for (let i = 0; i < chats; i++) {
    const at = new Date(Date.now() - (i + 1) * 60_000).toISOString();
    await ingestEvents(i % 3 === 0 ? priv : pub, [lineMsg(`54911000${String(i).padStart(5, '0')}@c.us`, `${label}-${i}`, i % 4 === 0 ? `necesito la factura ${i}` : `hola ${i}`, `Cliente ${i}`, at)]);
  }
  await setLineAccess(owner.id, priv.id, { ownerId: null, visibility: 'restricted', personIds: [pablo.id], teamIds: [] });
  return { owner, pablo, ruth, pub, priv, admin: await groupsViewer(owner.id, owner.id, 'owner'), vPablo: await groupsViewer(owner.id, pablo.id, 'member'), vRuth: await groupsViewer(owner.id, ruth.id, 'member') };
}

async function linePages(ws: string, me: string, query: Parameters<typeof listChats>[2], between?: (page: number) => Promise<void>) {
  const pages: string[][] = [];
  let cursor: string | null = '';
  for (let i = 0; i < 50 && cursor !== null; i++) {
    const p = await listChats(ws, me, { ...query, cursor, count: false });
    pages.push(p.rows.map((c) => c.name));
    cursor = p.next ?? null;
    if (cursor !== null && between) await between(i);
  }
  return pages;
}

describe('Lines: la bandeja por páginas (cursor)', () => {
  it('recorre toda la historia sin repetir ni saltear chats, aunque lleguen mensajes entre páginas; los fijados van primero', async () => {
    const w = await linesWorld('perf-ln-pages');
    const all = (await listChats(w.owner.id, w.owner.id, { viewer: w.admin, limit: 500 })).rows;
    expect(all).toHaveLength(17);
    await updateChat(w.owner.id, all[10].id, { pinned: true });
    let extra = 0;
    const pages = await linePages(w.owner.id, w.owner.id, { viewer: w.admin, limit: 4 }, async (page) => {
      await ingestEvents(w.pub, [lineMsg(`5491199${String(extra).padStart(6, '0')}@c.us`, `new-${extra}`, 'recién llegado', `Nuevo ${extra++}`)]);
      await ingestEvents(w.pub, [lineMsg(`54911000${String(page === 0 ? 1 : 2).padStart(5, '0')}@c.us`, `again-${page}`, 'otra vez', 'x')]);
    });
    const seen = pages.flat();
    expect(new Set(seen).size).toBe(seen.length);
    for (const c of all) expect(seen.filter((x) => x === c.name)).toHaveLength(1);
    expect(pages[0][0]).toBe(all[10].name);
    // Mismo orden que la lista sin paginar.
    const ordered = (await listChats(w.owner.id, w.owner.id, { viewer: w.admin, limit: 500 })).rows.map((c) => c.name);
    expect((await linePages(w.owner.id, w.owner.id, { viewer: w.admin, limit: 5 })).flat()).toEqual(ordered);
    expect(decodeChatCursor('roto')).toBeNull();
    // Sin cursor sigue como siempre: limit, offset y total.
    const legacy = await listChats(w.owner.id, w.owner.id, { viewer: w.admin, limit: 5, offset: 5 });
    expect(legacy.total).toBe(ordered.length);
    expect(legacy.rows.map((c) => c.name)).toEqual(ordered.slice(5, 10));
    expect(legacy.next).toBeUndefined();
  });

  it('la visibilidad por línea se aplica en cada página, en la búsqueda y en los contadores de carpetas', async () => {
    const w = await linesWorld('perf-ln-access');
    const privNames = (await listChats(w.owner.id, w.owner.id, { viewer: w.admin, numberId: w.priv.id, limit: 500 })).rows.map((c) => c.name);
    expect(privNames).toHaveLength(6);
    // Ruth no tiene la línea privada: no ve ninguno de sus chats en ninguna página.
    const ruth = (await linePages(w.owner.id, w.ruth.id, { viewer: w.vRuth, limit: 3 })).flat();
    expect(ruth).toHaveLength(11);
    expect(ruth.some((n) => privNames.includes(n))).toBe(false);
    // Pablo sí: las ve todas.
    expect((await linePages(w.owner.id, w.pablo.id, { viewer: w.vPablo, limit: 3 })).flat()).toHaveLength(17);
    // Búsqueda en el texto de los mensajes (índice de texto completo): "factura" está en los chats 0, 4, 8, 12, 16.
    const hitsAdmin = (await linePages(w.owner.id, w.owner.id, { viewer: w.admin, q: 'factura', limit: 2 })).flat();
    expect(hitsAdmin.sort()).toEqual(['Cliente 0', 'Cliente 12', 'Cliente 16', 'Cliente 4', 'Cliente 8']);
    const hitsRuth = (await linePages(w.owner.id, w.ruth.id, { viewer: w.vRuth, q: 'factura', limit: 2 })).flat();
    // 0 y 12 están en la línea privada.
    expect(hitsRuth.sort()).toEqual(['Cliente 16', 'Cliente 4', 'Cliente 8']);
    const withSnippet = (await listChats(w.owner.id, w.owner.id, { viewer: w.admin, q: 'fact', cursor: '', count: false })).rows;
    expect(withSnippet.every((c) => (c.match ?? '').includes('factura'))).toBe(true);
    // Otro workspace no encuentra nada.
    const stranger = await makeUser('perf-ln-stranger');
    expect((await listChats(stranger.id, stranger.id, { q: 'factura', cursor: '' })).rows).toHaveLength(0);

    // Carpetas: los contadores salen agrupados y respetan lo que ve cada persona.
    const folder = await createLineFolder(w.owner.id, w.owner.id, { name: 'Clientes' });
    const sub = await createLineFolder(w.owner.id, w.owner.id, { name: 'VIP', parentId: folder.id });
    const rows = (await listChats(w.owner.id, w.owner.id, { viewer: w.admin, limit: 500 })).rows;
    const inPriv = rows.filter((c) => c.numberId === w.priv.id);
    const inPub = rows.filter((c) => c.numberId === w.pub.id);
    await moveChatsToFolder(w.owner.id, w.admin, [inPub[0].id, inPub[1].id, inPriv[0].id], folder.id);
    await moveChatsToFolder(w.owner.id, w.admin, [inPub[2].id, inPriv[1].id], sub.id);
    const forAdmin = await listLineFolders(w.owner.id, w.admin);
    expect(forAdmin.folders.find((f) => f.id === folder.id)).toMatchObject({ chats: 3, unread: 5 });
    expect(forAdmin.folders.find((f) => f.id === sub.id)).toMatchObject({ chats: 2, unread: 2 });
    expect(forAdmin.unfiled).toEqual({ chats: 12, unread: 12 });
    const forRuth = await listLineFolders(w.owner.id, w.vRuth);
    expect(forRuth.folders.find((f) => f.id === folder.id)).toMatchObject({ chats: 2, unread: 3 });
    expect(forRuth.folders.find((f) => f.id === sub.id)).toMatchObject({ chats: 1, unread: 1 });
    expect(forRuth.unfiled).toEqual({ chats: 8, unread: 8 });
    // La carpeta (con sus subcarpetas) paginada, para cada quien.
    expect((await linePages(w.owner.id, w.owner.id, { viewer: w.admin, folderId: folder.id, limit: 2 })).flat()).toHaveLength(5);
    expect((await linePages(w.owner.id, w.ruth.id, { viewer: w.vRuth, folderId: folder.id, limit: 2 })).flat()).toHaveLength(3);
  });

  it('la búsqueda arma la expresión con palabras como prefijo y sin sintaxis del motor', () => {
    expect(chatSearchMatch('fact pend')).toBe('"fact"* "pend"*');
    expect(chatSearchMatch('"comillas" AND (x) *')).toBe('"comillas"* "AND"* "x"*');
    expect(chatSearchMatch('   ')).toBe('');
  });

  it('los índices de la lista existen y la bandeja los usa', async () => {
    const names = (await getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_groups_chats_%'").all()) as Array<{ name: string }>;
    expect(names.map((n) => n.name)).toEqual(
      expect.arrayContaining(['idx_groups_chats_list', 'idx_groups_chats_line_list', 'idx_groups_chats_unread', 'idx_groups_chats_pinned', 'idx_groups_chats_archived', 'idx_groups_chats_folder_list']),
    );
    const key = linesSortKey('c');
    const plan = (await getDb()
      .prepare(
        `EXPLAIN QUERY PLAN SELECT c.id FROM groups_chats c WHERE c.user_id = ? AND c.hidden_at IS NULL AND c.archived_at IS NULL AND c.status = 'open' AND c.pinned_at IS NULL
         AND ${key} <= ? AND (${key} < ? OR c.id < ?) ORDER BY ${key} DESC, c.id DESC LIMIT 61`,
      )
      .all('ws', 'z', 'z', 'z')) as Array<{ detail: string }>;
    const detail = plan.map((p) => p.detail).join(' | ');
    expect(detail).toContain('idx_groups_chats_list');
    expect(detail).not.toContain('TEMP B-TREE');
  });
});

describe('Lines: mensajes de un chat por páginas', () => {
  it('sube por el hilo con "<fecha>~<seq>" sin saltear mensajes de la misma hora', async () => {
    const owner = await makeUser('perf-ln-msgs');
    const n = await line(owner.id, 'Línea');
    const jid = '5491100077777@c.us';
    const same = '2026-11-01T10:00:00.000Z';
    for (let i = 0; i < 9; i++) await ingestEvents(n, [lineMsg(jid, `burst-${i}`, `ráfaga ${i}`, 'Ana', same)]);
    for (let i = 0; i < 3; i++) await ingestEvents(n, [lineMsg(jid, `late-${i}`, `después ${i}`, 'Ana', `2026-11-01T10:0${i + 1}:00.000Z`)]);
    const chatId = (await listChats(owner.id, owner.id)).rows[0].id;
    const got: string[] = [];
    let page = await listLineMessages(owner.id, chatId, { limit: 4 });
    got.unshift(...page.map((m) => m.body));
    for (let i = 0; i < 10 && page.length === 4; i++) {
      await ingestEvents(n, [lineMsg(jid, `live-${i}`, `en vivo ${i}`, 'Ana')]);
      const first = page[0];
      expect(typeof first.seq).toBe('number');
      page = await listLineMessages(owner.id, chatId, { limit: 4, before: `${first.createdAt}~${first.seq}` });
      got.unshift(...page.map((m) => m.body));
    }
    expect(got).toEqual([...Array.from({ length: 9 }, (_, i) => `ráfaga ${i}`), ...Array.from({ length: 3 }, (_, i) => `después ${i}`)]);
    // Con la fecha sola (como antes): los estrictamente anteriores.
    expect(await listLineMessages(owner.id, chatId, { before: '2026-11-01T10:01:00.000Z' })).toHaveLength(9);
    // Otro workspace no lee los mensajes.
    const other = await makeUser('perf-ln-msgs-other');
    expect(await listLineMessages(other.id, chatId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Lo que usan las pantallas
// ---------------------------------------------------------------------------

describe('Consultas condicionales y caché de listas', () => {
  it('el mismo contenido responde 304 con If-None-Match; otro contenido, 200', async () => {
    const body = { rows: [{ id: 'a', unread: 1 }] };
    const first = conditionalJson(new Request('https://x.test/api'), body);
    expect(first.status).toBe(200);
    const etag = first.headers.get('etag')!;
    expect(etag).toBe(etagOf(body));
    const again = conditionalJson(new Request('https://x.test/api', { headers: { 'if-none-match': etag } }), body);
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
    expect(conditionalJson(new Request('https://x.test/api', { headers: { 'if-none-match': etag } }), { rows: [{ id: 'a', unread: 2 }] }).status).toBe(200);
  });

  it('las filas que no cambiaron conservan su objeto (no se vuelven a dibujar) y la lista entera si nada cambió', () => {
    const prev = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'c', n: 3 }];
    expect(reuseRows(prev, [{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'c', n: 3 }])).toBe(prev);
    const next = reuseRows(prev, [{ id: 'b', n: 9 }, { id: 'a', n: 1 }, { id: 'd', n: 4 }]);
    expect(next.map((r) => r.id)).toEqual(['b', 'a', 'd']);
    expect(next[1]).toBe(prev[0]);
    expect(next[0]).not.toBe(prev[1]);
  });

  it('la caché de listas guarda las últimas vistas y descarta las más viejas', () => {
    const cache = new ListCache<number>(3);
    for (const k of ['a', 'b', 'c']) cache.set(k, k.charCodeAt(0));
    expect(cache.get('a')).toBe(97);
    cache.set('d', 100);
    // "b" era la menos usada.
    expect(cache.get('b')).toBeUndefined();
    expect([cache.get('a'), cache.get('c'), cache.get('d')]).toEqual([97, 99, 100]);
    expect(cache.size).toBe(3);
  });

  it('las rutas de la bandeja de Inbox: vista, carpeta e idioma; el chat abierto viaja en la URL', () => {
    expect(parseInboxPath('/app/inbox')).toEqual({ view: 'inbox', folderId: null });
    expect(parseInboxPath('/es/app/inbox/v/unread')).toEqual({ view: 'unread', folderId: null });
    expect(parseInboxPath('/pt/app/inbox/f/ibf_1')).toEqual({ view: 'inbox', folderId: 'ibf_1' });
    expect(parseInboxPath('/app/inbox/settings')).toBeNull();
    expect(parseInboxPath('/app/inbox/v/no-existe')).toBeNull();
    expect(parseInboxPath('/app/lines/inbox')).toBeNull();
    expect(inboxUrl({ view: 'inbox', folderId: 'ibf_1' }, 'ibt_abc', '/es/app/inbox/v/unread')).toBe('/es/app/inbox/f/ibf_1?t=ibt_abc');
    expect(inboxUrl({ view: 'done', folderId: null }, null, '/app/inbox')).toBe('/app/inbox/v/done');
  });
});

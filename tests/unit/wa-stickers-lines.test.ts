/**
 * Stickers por línea, en Lines e Inbox (lib/wa-stickers.ts): cada línea tiene su
 * colección, la pestaña pide la de la línea del chat abierto y nunca recibe la
 * de otra; ni la lista ni la imagen (?img=) se entregan de una línea que la
 * persona no ve (tampoco por un grupo de líneas en el que no está, ni desde
 * otro workspace). Listar solo lee la base. Y lo que había antes de que la
 * colección fuera por línea queda ubicado en su línea o sigue a la vista.
 * Números y nombres inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient, getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { connectNumber, createNumber, getNumberRowById, ingestEvents } from '@/lib/groups';
import { createLineGroup, updateLineGroup } from '@/lib/groups-line-groups';
import { groupsViewer } from '@/lib/groups-access';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import * as inboxWhatsapp from '@/lib/inbox/whatsapp';
import type { AccountRow } from '@/lib/inbox/core';
import { FAKE_ANIMATED_STICKER_WEBP, FAKE_STICKER_WEBP } from '@/lib/wa-sticker-fixtures';
import { addSticker, listStickers, removeSticker, stickerBytes, stickerHash, syncStickers, type StickerDto, type StickerOwner } from '@/lib/wa-stickers';
import { linesStickerOwner, linesStickerSource } from '@/lib/groups-stickers';
import { inboxStickerOwner, inboxStickerSource } from '@/lib/inbox/wa-stickers';
import migration, { attributeStickerLines } from '@/lib/schema/migration-files/20261119_1525_wa_stickers_per_line';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const lines = await import('@/app/api/groups/stickers/route');
const inbox = await import('@/app/api/inbox/stickers/route');

type Route = { GET: (req: Request) => Promise<Response>; POST: (req: Request) => Promise<Response> };
type List = { stickers: StickerDto[]; imported: boolean };

const urlOf = (r: Route) => (r === (lines as Route) ? 'http://x/api/groups/stickers' : 'http://x/api/inbox/stickers');
const list = (r: Route, line: string) => r.GET(new Request(`${urlOf(r)}?line=${encodeURIComponent(line)}`));
const img = (r: Route, id: string) => r.GET(new Request(`${urlOf(r)}?img=${encodeURIComponent(id)}`));
const act = (r: Route, body: Record<string, unknown>) => r.POST(new Request(urlOf(r), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const listed = async (r: Route, line: string) => ((await (await list(r, line)).json()) as List).stickers;

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => {
  session.user = null;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Un sticker que llega a un chat: "stk-" baja el WebP quieto del WhatsApp falso y "astk-" el animado. */
function stickerEvent(chatId: string, id: string, sha?: string) {
  return {
    type: 'message' as const,
    chatId,
    isGroup: true,
    fromMe: false,
    senderPhone: '15550001002',
    senderName: 'Beto Prueba',
    body: '',
    timestamp: new Date().toISOString(),
    providerMessageId: id,
    media: { url: `evo:${id}`, type: 'image/webp', name: '', fetchRef: { providerMessageId: id, chatId, fromMe: false }, info: { kind: 'sticker' as const, ...(sha ? { sha } : {}) } },
  };
}

async function line(ws: string, name: string, visibility: 'all' | 'restricted' = 'all') {
  const n = await createNumber(ws, ws, { provider: 'fake', name, visibility });
  await connectNumber(ws, n.id);
  const fake = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (fake) fake.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
  return (await getNumberRowById(n.id))!;
}

/** Los archivos de Lines se bajan después de guardar los mensajes: espera a que estén. */
async function stored(ws: string) {
  await vi.waitFor(async () => {
    const rows = (await getDb().prepare("SELECT media_url FROM groups_messages WHERE user_id = ? AND media_url LIKE 'evo:%'").all(ws)) as unknown[];
    expect(rows).toHaveLength(0);
  });
}

async function importAll(r: Route, lineId: string) {
  for (let i = 0; i < 10; i++) {
    const res = await act(r, { action: 'import', line: lineId });
    expect(res.status).toBe(200);
    if (!((await res.json()) as { more: boolean }).more) return;
  }
}

describe('Lines: una colección por línea', () => {
  async function setup(label: string) {
    const w = await workspaceWithMember(label);
    const a = await line(w.owner.id, 'Ventas');
    const b = await line(w.owner.id, 'Soporte', 'restricted');
    // Una línea restringida dentro de un grupo de líneas que solo tiene `friend`.
    const c = await line(w.owner.id, 'Cobros', 'restricted');
    const group = await createLineGroup(w.owner.id, w.owner.id, { name: 'Administración' });
    await updateLineGroup(w.owner.id, group.id, { numberIds: [c.id], personIds: [w.friend.id] });
    await ingestEvents(a, [stickerEvent('120363040000000001@g.us', `stk-${label}-a`)]);
    await ingestEvents(b, [stickerEvent('120363040000000002@g.us', `astk-${label}-b`)]);
    await ingestEvents(c, [stickerEvent('120363040000000003@g.us', `stk-${label}-c`), stickerEvent('120363040000000003@g.us', `astk-${label}-c`)]);
    await stored(w.owner.id);
    return { w, a, b, c, group };
  }

  it('cada línea muestra los suyos: los de A nunca salen en B, ni la lista ni la imagen cruzan', async () => {
    const { w, a, b, c } = await setup('stkl-own');
    session.user = asOwner(w.owner);
    for (const n of [a, b, c]) await importAll(lines, n.id);
    const [la, lb, lc] = [await listed(lines, a.id), await listed(lines, b.id), await listed(lines, c.id)];
    expect(la.map((s) => [s.animated, s.line])).toEqual([[false, a.id]]);
    expect(lb.map((s) => [s.animated, s.line])).toEqual([[true, b.id]]);
    expect(lc).toHaveLength(2);
    expect(new Set([...la, ...lb, ...lc].map((s) => s.id)).size).toBe(4);
    // El mismo archivo vive en dos líneas (A y C tienen el quieto) con una fila cada una.
    expect(lc.some((s) => !s.animated && s.id !== la[0].id)).toBe(true);
    // La imagen: con sesión, del dueño de la colección, y cacheable para siempre.
    const res = await img(lines, la[0].id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(Buffer.from(await res.arrayBuffer()).equals(FAKE_STICKER_WEBP)).toBe(true);
    // Sin línea no hay lista.
    expect((await lines.GET(new Request('http://x/api/groups/stickers'))).status).toBe(404);
  });

  it('un miembro no recibe nada de una línea que no ve (ni por un grupo de líneas donde no está); otra línea que no existe responde igual', async () => {
    const { w, a, b, c } = await setup('stkl-mem');
    session.user = asOwner(w.owner);
    for (const n of [a, b, c]) await importAll(lines, n.id);
    const ownerB = await listed(lines, b.id);

    session.user = asMember(w.owner, w.member);
    // La que ve: su propia colección (cada persona tiene la suya), que se arma con los chats de esa línea.
    await importAll(lines, a.id);
    expect((await listed(lines, a.id)).map((s) => s.line)).toEqual([a.id]);
    // Las que no ve: 404, con el mismo cuerpo que una línea inventada.
    const unknown = await list(lines, 'no-existe');
    expect(unknown.status).toBe(404);
    const body = await unknown.text();
    for (const hidden of [b.id, c.id]) {
      const res = await list(lines, hidden);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(body);
      expect((await act(lines, { action: 'import', line: hidden })).status).toBe(404);
      const form = new FormData();
      form.append('line', hidden);
      form.append('file', new Blob([new Uint8Array(FAKE_STICKER_WEBP)], { type: 'image/webp' }), 's.webp');
      expect((await lines.POST(new Request('http://x/api/groups/stickers', { method: 'POST', body: form }))).status).toBe(404);
    }
    // No quedó nada suyo en las líneas que no ve.
    const mine = (await getDb().prepare("SELECT line_id FROM wa_stickers WHERE user_id = ? AND app = 'lines'").all(w.member.id)) as Array<{ line_id: string }>;
    expect(mine.map((r) => r.line_id)).toEqual([a.id]);
    // El sticker de otra persona (el owner, en B) no se sirve aunque se sepa su id.
    expect((await img(lines, ownerB[0].id)).status).toBe(404);
    expect((await act(lines, { action: 'use', id: ownerB[0].id })).status).toBe(404);
  });

  it('si deja de ver la línea, sus stickers de esa línea dejan de servirse (también al salir del grupo de líneas)', async () => {
    const { w, a, c, group } = await setup('stkl-lost');
    session.user = asMember(w.owner, w.member);
    await importAll(lines, a.id);
    const [mine] = await listed(lines, a.id);
    expect((await img(lines, mine.id)).status).toBe(200);
    await getDb().prepare("UPDATE groups_numbers SET visibility = 'restricted' WHERE id = ?").run(a.id);
    expect((await list(lines, a.id)).status).toBe(404);
    expect((await img(lines, mine.id)).status).toBe(404);
    for (const body of [{ action: 'favorite', id: mine.id, favorite: true }, { action: 'use', id: mine.id }, { action: 'remove', id: mine.id }]) {
      expect((await act(lines, body)).status).toBe(404);
    }
    expect(await getDb().prepare('SELECT 1 AS x FROM wa_stickers WHERE id = ?').get(mine.id)).toBeTruthy();

    // `friend` ve C por el grupo de líneas: la usa, y al salir del grupo no recibe más nada de ahí.
    session.user = asMember(w.owner, w.friend);
    await importAll(lines, c.id);
    const fromGroup = await listed(lines, c.id);
    expect(fromGroup).toHaveLength(2);
    expect((await img(lines, fromGroup[0].id)).status).toBe(200);
    await updateLineGroup(w.owner.id, group.id, { personIds: [] });
    expect((await list(lines, c.id)).status).toBe(404);
    expect((await img(lines, fromGroup[0].id)).status).toBe(404);
  });

  it('otro workspace y sin sesión: nada', async () => {
    const { w, a } = await setup('stkl-ws');
    session.user = asOwner(w.owner);
    await importAll(lines, a.id);
    const [mine] = await listed(lines, a.id);
    session.user = asOwner(w.stranger);
    expect((await list(lines, a.id)).status).toBe(404);
    expect((await img(lines, mine.id)).status).toBe(404);
    expect((await act(lines, { action: 'import', line: a.id })).status).toBe(404);
    expect((await act(lines, { action: 'remove', id: mine.id })).status).toBe(404);
    session.user = null;
    expect((await list(lines, a.id)).status).toBe(401);
    expect((await img(lines, mine.id)).status).toBe(401);
  });

  it('crear y "agregar a favoritos" quedan en la línea del chat donde pasó', async () => {
    const { w, a, b } = await setup('stkl-fav');
    session.user = asOwner(w.owner);
    const form = new FormData();
    form.append('line', b.id);
    form.append('file', new Blob([new Uint8Array(FAKE_STICKER_WEBP)], { type: 'image/webp' }), 's.webp');
    const created = await lines.POST(new Request('http://x/api/groups/stickers', { method: 'POST', body: form }));
    expect(created.status).toBe(201);
    expect(((await created.json()) as { sticker: StickerDto }).sticker.line).toBe(b.id);
    expect(await listed(lines, a.id)).toEqual([]);
    expect(await listed(lines, b.id)).toHaveLength(1);
    // Favorito desde un mensaje de un chat de A: va a A.
    const msg = (await getDb().prepare("SELECT id FROM groups_messages WHERE number_id = ? AND media_type = 'image/webp'").get(a.id)) as { id: string };
    const fav = await act(lines, { action: 'favoriteMessage', messageId: msg.id });
    expect(fav.status).toBe(200);
    expect(((await fav.json()) as { sticker: StickerDto }).sticker).toMatchObject({ line: a.id, favorite: true });
    expect((await listed(lines, a.id)).map((s) => s.favorite)).toEqual([true]);
    expect((await listed(lines, b.id)).map((s) => s.favorite)).toEqual([false]);
  });
});

describe('Inbox: una colección por cuenta de WhatsApp', () => {
  async function account(owner: string, second = false): Promise<AccountRow> {
    let acc: AccountRow;
    if (!second) {
      acc = (await connectWhatsapp(owner)).account;
    } else {
      const id = `iba_test_${Math.random().toString(36).slice(2, 10)}`;
      await getDb()
        .prepare(
          `INSERT INTO inbox_accounts (id, owner_id, kind, provider, label, address, status, webhook_secret, created_at, updated_at)
           VALUES (?, ?, 'whatsapp', 'fake', 'Trabajo', '', 'connected', 'secreto-de-prueba', ?, ?)`,
        )
        .run(id, owner, new Date().toISOString(), new Date().toISOString());
      acc = (await getDb().prepare('SELECT * FROM inbox_accounts WHERE id = ?').get(id)) as AccountRow;
    }
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(acc.id);
    return { ...acc, status: 'connected' } as AccountRow;
  }

  async function setup(label: string) {
    const u = await makeUser(label);
    const a = await account(u.id);
    const b = await account(u.id, true);
    await ingestWhatsappEvents(a, [stickerEvent('5491100000001@s.whatsapp.net', `stk-${label}-a`)].map((e) => ({ ...e, isGroup: false, senderPhone: '5491100000001' })));
    await ingestWhatsappEvents(b, [stickerEvent('5491100000002@s.whatsapp.net', `astk-${label}-b`)].map((e) => ({ ...e, isGroup: false, senderPhone: '5491100000002' })));
    return { u, a, b };
  }

  it('cada cuenta muestra los suyos y la imagen solo se sirve a su dueña', async () => {
    const { u, a, b } = await setup('stki-own');
    session.user = asOwner(u);
    await importAll(inbox, a.id);
    await importAll(inbox, b.id);
    const [la, lb] = [await listed(inbox, a.id), await listed(inbox, b.id)];
    expect(la.map((s) => [s.animated, s.line])).toEqual([[false, a.id]]);
    expect(lb.map((s) => [s.animated, s.line])).toEqual([[true, b.id]]);
    expect(la[0].id).not.toBe(lb[0].id);
    expect((await img(inbox, la[0].id)).status).toBe(200);
    expect((await inbox.GET(new Request('http://x/api/inbox/stickers'))).status).toBe(404);

    // Favorito desde un mensaje del chat de la cuenta B: queda en B.
    const msg = (await getDb()
      .prepare("SELECT m.id FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id WHERE t.account_id = ? AND m.media_type = 'sticker'")
      .get(b.id)) as { id: string };
    const fav = await act(inbox, { action: 'favoriteMessage', messageId: msg.id });
    expect(((await fav.json()) as { sticker: StickerDto }).sticker).toMatchObject({ line: b.id, favorite: true });
    expect(await listed(inbox, a.id)).toHaveLength(1);

    // Otra persona: ni la lista de esa cuenta, ni la imagen, ni importar; igual que una cuenta inventada.
    const other = await makeUser('stki-other');
    session.user = asOwner(other);
    const unknown = await list(inbox, 'iba_no_existe');
    expect(unknown.status).toBe(404);
    const res = await list(inbox, a.id);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(await unknown.text());
    expect((await img(inbox, la[0].id)).status).toBe(404);
    expect((await act(inbox, { action: 'import', line: a.id })).status).toBe(404);
    expect((await act(inbox, { action: 'remove', id: la[0].id })).status).toBe(404);
    session.user = null;
    expect((await list(inbox, a.id)).status).toBe(401);
  });

  it('listar no baja nada de WhatsApp ni sale a la red: lo que llegó entra con el pedido de importar', async () => {
    const { u, a } = await setup('stki-fast');
    session.user = asOwner(u);
    await importAll(inbox, a.id);
    // Llega otro sticker después de haber importado.
    await ingestWhatsappEvents(a, [{ ...stickerEvent('5491100000001@s.whatsapp.net', 'astk-stki-fast-nuevo'), isGroup: false, senderPhone: '5491100000001' }]);
    const download = vi.spyOn(inboxWhatsapp, 'fetchWhatsappMedia');
    const net = vi.spyOn(globalThis, 'fetch');
    const res = await list(inbox, a.id);
    const body = (await res.json()) as List;
    expect(body.imported).toBe(true);
    expect(body.stickers).toHaveLength(1);
    expect(download).not.toHaveBeenCalled();
    expect(net).not.toHaveBeenCalled();
    // El panel lo pide aparte, después de dibujar.
    const sync = (await (await act(inbox, { action: 'import', line: a.id })).json()) as { added: number; stickers: StickerDto[] };
    expect(sync.added).toBe(1);
    expect(sync.stickers).toHaveLength(2);
    expect(download).toHaveBeenCalledTimes(1);
  });
});

describe('Lines: listar solo lee la base', () => {
  it('con stickers nuevos en los chats, la lista responde lo que ya había', async () => {
    const u = await makeUser('stkl-fast');
    const a = await line(u.id, 'Ventas');
    await ingestEvents(a, [stickerEvent('120363040000000009@g.us', 'stk-fast-1')]);
    await stored(u.id);
    session.user = asOwner(u);
    await importAll(lines, a.id);
    await ingestEvents(a, [stickerEvent('120363040000000009@g.us', 'astk-fast-2')]);
    await stored(u.id);
    const net = vi.spyOn(globalThis, 'fetch');
    const body = (await (await list(lines, a.id)).json()) as List;
    expect(body).toMatchObject({ imported: true });
    expect(body.stickers).toHaveLength(1);
    expect(net).not.toHaveBeenCalled();
    await importAll(lines, a.id);
    expect(await listed(lines, a.id)).toHaveLength(2);
  });
});

describe('lo que había antes de las colecciones por línea', () => {
  const SHA_A = 'a'.repeat(64);
  const SHA_BOTH = 'b'.repeat(64);
  const SHA_NONE = 'c'.repeat(64);

  /** Una fila como las de antes: sin línea. */
  async function legacy(o: StickerOwner, hash: string, source: 'chat' | 'created' | 'favorite', over: { favorite?: number; lastUsed?: string } = {}) {
    const id = `old-${Math.random().toString(36).slice(2, 10)}`;
    await getDb()
      .prepare(
        `INSERT INTO wa_stickers (id, user_id, app, scope_id, line_id, hash, ref, animated, size, favorite, source, last_used_at, created_at)
         VALUES (?, ?, ?, ?, '', ?, 'ref-de-prueba', 0, 10, ?, ?, ?, ?)`,
      )
      .run(id, o.userId, o.app, o.scope, hash, over.favorite ?? 0, source, over.lastUsed ?? null, new Date().toISOString());
    return id;
  }
  const lineOf = async (id: string) => ((await getDb().prepare('SELECT line_id FROM wa_stickers WHERE id = ?').get(id)) as { line_id: string }).line_id;

  it('Lines: los importados van a la línea de un mensaje con su SHA-256; los creados y favoritos sin ubicar se ven en todas; nada se pierde', async () => {
    const u = await makeUser('stk-mig-lines');
    const a = await line(u.id, 'Ventas');
    const b = await line(u.id, 'Soporte');
    await ingestEvents(a, [stickerEvent('120363040000000011@g.us', 'stk-mig-1', SHA_A), stickerEvent('120363040000000011@g.us', 'stk-mig-2', SHA_BOTH)]);
    await ingestEvents(b, [stickerEvent('120363040000000012@g.us', 'stk-mig-3', SHA_BOTH)]);
    await stored(u.id);
    const viewer = await groupsViewer(u.id, u.id, 'owner');
    const person = linesStickerOwner(viewer);
    const inA = await legacy(person, SHA_A, 'chat', { favorite: 1, lastUsed: '2026-11-18T10:00:00.000Z' });
    const inBoth = await legacy(person, SHA_BOTH, 'chat');
    const nowhere = await legacy(person, SHA_NONE, 'chat');
    const made = await legacy(person, 'd'.repeat(64), 'created');
    const faved = await legacy(person, 'e'.repeat(64), 'favorite', { favorite: 1 });
    const before = Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM wa_stickers WHERE user_id = ?').get(u.id)) as { n: number }).n);

    const client = getClient();
    expect(await attributeStickerLines(client)).toBeGreaterThanOrEqual(2);
    // La migración entera tolera correr de nuevo (y dos veces seguidas).
    await migration.up(client);
    await migration.up(client);

    expect(await lineOf(inA)).toBe(a.id);
    // En dos líneas: a la primera por id; la otra lo vuelve a traer de sus chats.
    expect(await lineOf(inBoth)).toBe([a.id, b.id].sort()[0]);
    expect(await lineOf(nowhere)).toBe('');
    expect(await lineOf(made)).toBe('');
    expect(await lineOf(faved)).toBe('');
    expect(Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM wa_stickers WHERE user_id = ?').get(u.id)) as { n: number }).n)).toBe(before);

    const ids = async (lineId: string) => (await listStickers(linesStickerOwner(viewer, lineId))).map((s) => s.id);
    const first = [a.id, b.id].sort()[0];
    const second = [a.id, b.id].sort()[1];
    // El favorito y el reciente del que se ubicó se conservan.
    const kept = (await listStickers(linesStickerOwner(viewer, a.id))).find((s) => s.id === inA)!;
    expect(kept).toMatchObject({ favorite: true, usedAt: '2026-11-18T10:00:00.000Z', line: a.id });
    expect((await ids(first)).sort()).toEqual([inA, inBoth, made, faved].filter((x) => first === a.id || x !== inA).sort());
    expect((await ids(second)).sort()).toEqual([made, faved, ...(second === a.id ? [inA] : [])].sort());
    // El importado sin ubicar no se muestra en una línea que no es la suya.
    expect(await ids(a.id)).not.toContain(nowhere);
    expect(await ids(b.id)).not.toContain(nowhere);
  });

  it('un importado sin ubicar pasa a la línea donde reaparece al traer los stickers de sus chats, con el mismo id', async () => {
    const u = await makeUser('stk-mig-claim');
    const a = await line(u.id, 'Ventas');
    const b = await line(u.id, 'Soporte');
    // En A, un mensaje sin SHA (como los de antes): hay que leer el archivo para reconocerlo.
    await ingestEvents(a, [stickerEvent('120363040000000021@g.us', 'stk-claim-1')]);
    await stored(u.id);
    const viewer = await groupsViewer(u.id, u.id, 'owner');
    const person = linesStickerOwner(viewer);
    const old = await legacy(person, stickerHash(FAKE_STICKER_WEBP), 'chat', { lastUsed: '2026-11-18T10:00:00.000Z' });
    expect(await attributeStickerLines(getClient())).toBe(0);
    expect(await listStickers(linesStickerOwner(viewer, a.id))).toEqual([]);

    // En B no está: no aparece ahí.
    expect((await syncStickers(linesStickerOwner(viewer, b.id), linesStickerSource(viewer, b.id))).added).toBe(0);
    expect(await lineOf(old)).toBe('');
    // En A sí: pasa a ser de A, sin duplicarse.
    expect((await syncStickers(linesStickerOwner(viewer, a.id), linesStickerSource(viewer, a.id))).added).toBe(1);
    expect(await lineOf(old)).toBe(a.id);
    const inA = await listStickers(linesStickerOwner(viewer, a.id));
    expect(inA.map((s) => [s.id, s.usedAt])).toEqual([[old, '2026-11-18T10:00:00.000Z']]);
    expect(await listStickers(linesStickerOwner(viewer, b.id))).toEqual([]);
  });

  it('Inbox: los importados van a la cuenta de un mensaje con su SHA-256', async () => {
    const u = await makeUser('stk-mig-inbox');
    const { account } = await connectWhatsapp(u.id);
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
    const live = { ...account, status: 'connected' } as AccountRow;
    await ingestWhatsappEvents(live, [{ ...stickerEvent('5491100000031@s.whatsapp.net', 'stk-mig-inbox-1', SHA_A), isGroup: false, senderPhone: '5491100000031' }]);
    const person = inboxStickerOwner(u.id);
    const found = await legacy(person, SHA_A, 'chat');
    const lost = await legacy(person, SHA_NONE, 'chat');
    const made = await legacy(person, 'd'.repeat(64), 'created');
    expect(await attributeStickerLines(getClient())).toBe(1);
    expect(await lineOf(found)).toBe(account.id);
    expect(await lineOf(lost)).toBe('');
    expect((await listStickers(inboxStickerOwner(u.id, account.id))).map((s) => s.id).sort()).toEqual([found, made].sort());
    // Con el SHA-256 que manda WhatsApp, traer de los chats no vuelve a bajar lo que ya está.
    const download = vi.spyOn(inboxWhatsapp, 'fetchWhatsappMedia');
    expect((await syncStickers(inboxStickerOwner(u.id, account.id), inboxStickerSource(u.id, account.id))).added).toBe(0);
    expect(download).not.toHaveBeenCalled();
  });

  it('el mismo archivo en dos líneas: dos filas, y quitar una no rompe la otra', async () => {
    const u = await makeUser('stk-two-lines');
    const o: StickerOwner = { userId: u.id, app: 'inbox', scope: '' };
    const inA = await addSticker({ ...o, line: 'linea-a' }, FAKE_STICKER_WEBP);
    const inB = await addSticker({ ...o, line: 'linea-b' }, Buffer.from(FAKE_STICKER_WEBP));
    expect(inA.added && inB.added).toBe(true);
    expect(inA.sticker.id).not.toBe(inB.sticker.id);
    expect((await listStickers({ ...o, line: 'linea-a' })).map((s) => s.id)).toEqual([inA.sticker.id]);
    await addSticker({ ...o, line: 'linea-b' }, FAKE_ANIMATED_STICKER_WEBP);
    expect(await listStickers({ ...o, line: 'linea-a' })).toHaveLength(1);
    await removeSticker(o, inA.sticker.id);
    expect(await listStickers({ ...o, line: 'linea-a' })).toEqual([]);
    expect((await stickerBytes(o, inB.sticker.id)).data.equals(FAKE_STICKER_WEBP)).toBe(true);
    // Sin poder ver la línea, tampoco por id.
    await expect(stickerBytes({ ...o, canSeeLine: async (id) => id !== 'linea-b' }, inB.sticker.id)).rejects.toMatchObject({ code: 'not_found' });
  });
});

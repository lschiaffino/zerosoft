/**
 * Stickers: lo suyo primero, como WhatsApp (lib/wa-sticker-sections.ts,
 * lib/wa-stickers.ts). Recientes = los que la persona mandó desde esa línea,
 * también desde el teléfono; después favoritos y creados; lo que solo recibió
 * va a "De tus chats". Por línea, y en Lines solo con los chats que ve. Y la
 * migración que completa los recientes de las colecciones ya importadas.
 * Números, nombres y mensajes inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient, getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { connectNumber, createNumber, getNumberRowById, ingestEvents } from '@/lib/groups';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import type { AccountRow } from '@/lib/inbox/core';
import { FAKE_ANIMATED_STICKER_WEBP, FAKE_STICKER_WEBP } from '@/lib/wa-sticker-fixtures';
import { addSticker, isoAt, stickerHash, type StickerDto, type StickerOwner } from '@/lib/wa-stickers';
import { stickerSections } from '@/lib/wa-sticker-sections';
import migration, { backfillSentStickers } from '@/lib/schema/migration-files/20261119_2339_wa_stickers_sent_recent';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const lines = await import('@/app/api/groups/stickers/route');
const inbox = await import('@/app/api/inbox/stickers/route');

type Route = { GET: (req: Request) => Promise<Response>; POST: (req: Request) => Promise<Response> };
const urlOf = (r: Route) => (r === (lines as Route) ? 'http://x/api/groups/stickers' : 'http://x/api/inbox/stickers');
const act = (r: Route, body: Record<string, unknown>) => r.POST(new Request(urlOf(r), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const list = (r: Route, line: string) => r.GET(new Request(`${urlOf(r)}?line=${encodeURIComponent(line)}`));
const listed = async (r: Route, line: string) => ((await (await list(r, line)).json()) as { stickers: StickerDto[] }).stickers;
const keys = (l: StickerDto[]) => Object.fromEntries(stickerSections(l).map((s) => [s.key, s.list.map((x) => (x.animated ? 'animado' : 'quieto'))]));

const STILL = stickerHash(FAKE_STICKER_WEBP);
const ANIM = stickerHash(FAKE_ANIMATED_STICKER_WEBP);

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

/** Un sticker en un chat: "stk-" es el WebP quieto del WhatsApp falso, "astk-" el animado. `fromMe`: salió de la línea (desde el teléfono). */
function stickerEvent(chatId: string, id: string, o: { fromMe?: boolean; at?: string; group?: boolean } = {}) {
  const fromMe = o.fromMe ?? false;
  const sha = id.startsWith('astk-') ? ANIM : STILL;
  return {
    type: 'message' as const,
    chatId,
    isGroup: o.group ?? true,
    fromMe,
    senderPhone: fromMe ? '' : '15550001002',
    senderName: fromMe ? '' : 'Beto Prueba',
    body: '',
    timestamp: o.at ?? new Date().toISOString(),
    providerMessageId: id,
    media: { url: `evo:${id}`, type: 'image/webp', name: '', fetchRef: { providerMessageId: id, chatId, fromMe }, info: { kind: 'sticker' as const, sha } },
  };
}

async function line(ws: string, name: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name, visibility: 'all' });
  await connectNumber(ws, n.id);
  const fake = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (fake) fake.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
  return (await getNumberRowById(n.id))!;
}

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

async function inboxAccount(owner: string, second = false): Promise<AccountRow> {
  if (!second) {
    const { account } = await connectWhatsapp(owner);
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
    return { ...account, status: 'connected' } as AccountRow;
  }
  const id = `iba_test_${Math.random().toString(36).slice(2, 10)}`;
  const at = new Date().toISOString();
  await getDb()
    .prepare(
      `INSERT INTO inbox_accounts (id, owner_id, kind, provider, label, address, status, webhook_secret, created_at, updated_at)
       VALUES (?, ?, 'whatsapp', 'fake', 'Trabajo', '', 'connected', 'secreto-de-prueba', ?, ?)`,
    )
    .run(id, owner, at, at);
  return (await getDb().prepare('SELECT * FROM inbox_accounts WHERE id = ?').get(id)) as AccountRow;
}

describe('secciones (lo que dibuja la pestaña)', () => {
  const s = (over: Partial<{ id: string; usedAt: string | null; favorite: boolean; created: boolean }>) => ({ id: 'x', usedAt: null, favorite: false, created: false, ...over });

  it('recientes del más nuevo al más viejo; favoritos y creados; lo solo recibido en "De tus chats"; sin secciones vacías', () => {
    const out = stickerSections([
      s({ id: 'recibido' }),
      s({ id: 'viejo', usedAt: '2026-11-01T10:00:00.000Z' }),
      s({ id: 'nuevo', usedAt: '2026-11-19T10:00:00.000Z', favorite: true }),
      s({ id: 'fav', favorite: true }),
      s({ id: 'hecho', created: true }),
    ]);
    expect(out.map((x) => [x.key, x.list.map((y) => y.id)])).toEqual([
      ['recent', ['nuevo', 'viejo']],
      ['favorites', ['nuevo', 'fav']],
      ['created', ['hecho']],
      ['chats', ['recibido']],
    ]);
    expect(stickerSections([s({ id: 'r' })]).map((x) => x.key)).toEqual(['chats']);
    expect(stickerSections([])).toEqual([]);
  });

  it('un recibido sube al mandarlo o al marcarlo favorito', () => {
    expect(stickerSections([s({ usedAt: '2026-11-19T10:00:00.000Z' })]).map((x) => x.key)).toEqual(['recent']);
    expect(stickerSections([s({ favorite: true })]).map((x) => x.key)).toEqual(['favorites']);
  });

  it('isoAt: las dos formas de fecha de la base dan el mismo ISO', () => {
    expect(isoAt('2026-11-19 10:00:00')).toBe('2026-11-19T10:00:00.000Z');
    expect(isoAt('2026-11-19T10:00:00.000Z')).toBe('2026-11-19T10:00:00.000Z');
    expect(isoAt('')).toBeUndefined();
  });
});

describe('Lines: mandado desde el teléfono cuenta como mandado', () => {
  it('el que salió de la línea va a Recientes con la hora del mensaje; el recibido a "De tus chats"; el creado a Creados', async () => {
    const u = await makeUser('stkm-lines');
    const a = await line(u.id, 'Ventas');
    const at = '2026-11-18T12:00:00.000Z';
    await ingestEvents(a, [stickerEvent('120363040000000101@g.us', 'stk-stkm-in'), stickerEvent('120363040000000101@g.us', 'astk-stkm-out', { fromMe: true, at })]);
    await stored(u.id);
    session.user = asOwner(u);
    await importAll(lines, a.id);
    const got = await listed(lines, a.id);
    expect(keys(got)).toEqual({ recent: ['animado'], chats: ['quieto'] });
    expect(got.find((x) => x.animated)!.usedAt).toBe(at);
    // Crear: va a Creados, no a "De tus chats".
    const form = new FormData();
    form.append('line', a.id);
    form.append('file', new Blob([new Uint8Array(FAKE_STICKER_WEBP)], { type: 'image/webp' }), 's.webp');
    const created = await lines.POST(new Request('http://x/api/groups/stickers', { method: 'POST', body: form }));
    expect(created.status).toBe(201);
    expect(((await created.json()) as { sticker: StickerDto }).sticker.created).toBe(true);
    // Favorito: sube.
    const still = got.find((x) => !x.animated)!;
    expect((await act(lines, { action: 'favorite', id: still.id, favorite: true })).status).toBe(200);
    expect(keys(await listed(lines, a.id))).toEqual({ recent: ['animado'], favorites: ['quieto'], created: ['quieto'] });
  });

  it('un mensaje viejo no pisa un envío más nuevo', async () => {
    const u = await makeUser('stkm-order');
    const a = await line(u.id, 'Ventas');
    session.user = asOwner(u);
    const o: StickerOwner = { userId: u.id, app: 'lines', scope: u.id, line: a.id };
    const { sticker } = await addSticker(o, FAKE_ANIMATED_STICKER_WEBP);
    await getDb().prepare('UPDATE wa_stickers SET last_used_at = ? WHERE id = ?').run('2026-11-19T09:00:00.000Z', sticker.id);
    await ingestEvents(a, [stickerEvent('120363040000000102@g.us', 'astk-stkm-old', { fromMe: true, at: '2026-11-10T09:00:00.000Z' })]);
    await stored(u.id);
    await importAll(lines, a.id);
    expect((await listed(lines, a.id)).map((x) => x.usedAt)).toEqual(['2026-11-19T09:00:00.000Z']);
  });

  it('por línea: lo mandado en A no es reciente en B; un compañero no hereda lo que mandó otro desde zerosoft; sin acceso, nada', async () => {
    const w = await workspaceWithMember('stkm-iso');
    const a = await line(w.owner.id, 'Ventas');
    const b = await line(w.owner.id, 'Soporte');
    // En A: uno desde el teléfono y otro que mandó el dueño desde zerosoft. En B el mismo animado, recibido.
    await ingestEvents(a, [
      stickerEvent('120363040000000103@g.us', 'astk-stkm-phone', { fromMe: true }),
      stickerEvent('120363040000000103@g.us', 'stk-stkm-owner', { fromMe: true }),
    ]);
    await ingestEvents(b, [stickerEvent('120363040000000104@g.us', 'astk-stkm-b')]);
    await stored(w.owner.id);
    await getDb()
      .prepare("UPDATE groups_messages SET author_kind = 'person', author_id = ? WHERE number_id = ? AND provider_message_id = 'stk-stkm-owner'")
      .run(w.owner.id, a.id);

    session.user = asOwner(w.owner);
    await importAll(lines, a.id);
    await importAll(lines, b.id);
    // El dueño: los dos son suyos (uno desde el teléfono, otro desde zerosoft).
    const ownerA = keys(await listed(lines, a.id));
    expect(Object.keys(ownerA)).toEqual(['recent']);
    expect([...ownerA.recent].sort()).toEqual(['animado', 'quieto']);
    expect(keys(await listed(lines, b.id))).toEqual({ chats: ['animado'] });

    // El miembro ve A: lo del teléfono es reciente para él también; lo que mandó el dueño desde zerosoft no.
    session.user = asMember(w.owner, w.member);
    await importAll(lines, a.id);
    expect(keys(await listed(lines, a.id))).toEqual({ recent: ['animado'], chats: ['quieto'] });

    // Sin acceso a la línea: ni lista ni importar, y no le queda nada de ahí.
    await getDb().prepare("UPDATE groups_numbers SET visibility = 'restricted' WHERE id = ?").run(b.id);
    expect((await list(lines, b.id)).status).toBe(404);
    expect((await act(lines, { action: 'import', line: b.id })).status).toBe(404);
    const mine = (await getDb().prepare("SELECT DISTINCT line_id FROM wa_stickers WHERE user_id = ? AND app = 'lines'").all(w.member.id)) as Array<{ line_id: string }>;
    expect(mine.map((r) => r.line_id)).toEqual([a.id]);
  });
});

describe('Inbox: from_me cuenta como mandado, por cuenta', () => {
  it('el propio va a Recientes en su cuenta y no en la otra', async () => {
    const u = await makeUser('stkm-inbox');
    const a = await inboxAccount(u.id);
    const b = await inboxAccount(u.id, true);
    const at = '2026-11-18T15:00:00.000Z';
    await ingestWhatsappEvents(a, [
      stickerEvent('5491100000101@s.whatsapp.net', 'astk-stkm-ia', { fromMe: true, at, group: false }),
      stickerEvent('5491100000101@s.whatsapp.net', 'stk-stkm-ib', { group: false }),
    ]);
    await ingestWhatsappEvents(b, [stickerEvent('5491100000102@s.whatsapp.net', 'astk-stkm-ic', { group: false })]);
    session.user = asOwner(u);
    await importAll(inbox, a.id);
    await importAll(inbox, b.id);
    const inA = await listed(inbox, a.id);
    expect(keys(inA)).toEqual({ recent: ['animado'], chats: ['quieto'] });
    expect(inA.find((x) => x.animated)!.usedAt).toBe(at);
    expect(keys(await listed(inbox, b.id))).toEqual({ chats: ['animado'] });
    // Otra persona: la cuenta no existe para ella.
    session.user = asOwner(await makeUser('stkm-inbox-other'));
    expect((await list(inbox, a.id)).status).toBe(404);
  });
});

describe('migración: completa los recientes de lo ya importado', () => {
  async function row(o: StickerOwner, hash: string, lastUsed: string | null = null) {
    const id = `mig-${Math.random().toString(36).slice(2, 10)}`;
    await getDb()
      .prepare(
        `INSERT INTO wa_stickers (id, user_id, app, scope_id, line_id, hash, ref, animated, size, favorite, source, last_used_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'ref-de-prueba', 0, 10, 0, 'chat', ?, ?)`,
      )
      .run(id, o.userId, o.app, o.scope, o.line ?? '', hash, lastUsed, new Date().toISOString());
    return id;
  }
  const usedAt = async (id: string) => ((await getDb().prepare('SELECT last_used_at AS u FROM wa_stickers WHERE id = ?').get(id)) as { u: string | null }).u;

  it('Inbox y Lines: el último envío propio por línea; el teléfono solo para el dueño; idempotente', async () => {
    const w = await workspaceWithMember('stkm-mig');
    const a = await line(w.owner.id, 'Ventas');
    const b = await line(w.owner.id, 'Soporte');
    await ingestEvents(a, [
      stickerEvent('120363040000000201@g.us', 'astk-stkm-m1', { fromMe: true, at: '2026-11-10T10:00:00.000Z' }),
      stickerEvent('120363040000000201@g.us', 'astk-stkm-m2', { fromMe: true, at: '2026-11-12T10:00:00.000Z' }),
      stickerEvent('120363040000000201@g.us', 'stk-stkm-m3', { fromMe: true, at: '2026-11-11T10:00:00.000Z' }),
    ]);
    await ingestEvents(b, [stickerEvent('120363040000000202@g.us', 'stk-stkm-m4', { at: '2026-11-13T10:00:00.000Z' })]);
    await stored(w.owner.id);
    // El quieto lo mandó el miembro desde zerosoft.
    await getDb()
      .prepare("UPDATE groups_messages SET author_kind = 'person', author_id = ? WHERE number_id = ? AND provider_message_id = 'stk-stkm-m3'")
      .run(w.member.id, a.id);
    const owner = (line: string): StickerOwner => ({ userId: w.owner.id, app: 'lines', scope: w.owner.id, line });
    const member = (line: string): StickerOwner => ({ userId: w.member.id, app: 'lines', scope: w.owner.id, line });
    const ownerAnim = await row(owner(a.id), ANIM);
    const ownerStill = await row(owner(a.id), STILL);
    const ownerB = await row(owner(b.id), STILL);
    const memberAnim = await row(member(a.id), ANIM);
    const memberStill = await row(member(a.id), STILL);
    const newer = await row(owner(a.id), ANIM.replace(/.$/, '0'), '2026-11-19T00:00:00.000Z');

    const u = await makeUser('stkm-mig-inbox');
    const acc = await inboxAccount(u.id);
    const other = await inboxAccount(u.id, true);
    await ingestWhatsappEvents(acc, [stickerEvent('5491100000201@s.whatsapp.net', 'astk-stkm-mi', { fromMe: true, at: '2026-11-14T10:00:00.000Z', group: false })]);
    await ingestWhatsappEvents(other, [stickerEvent('5491100000202@s.whatsapp.net', 'astk-stkm-mo', { at: '2026-11-15T10:00:00.000Z', group: false })]);
    const inboxSent = await row({ userId: u.id, app: 'inbox', scope: '', line: acc.id }, ANIM);
    const inboxOther = await row({ userId: u.id, app: 'inbox', scope: '', line: other.id }, ANIM);

    expect(await backfillSentStickers(getClient())).toBe(3);
    await migration.up(getClient());
    expect(await backfillSentStickers(getClient())).toBe(0);

    // Dueño: el teléfono cuenta, el más nuevo de los dos envíos.
    expect(await usedAt(ownerAnim)).toBe('2026-11-12T10:00:00.000Z');
    // Lo mandó el miembro desde zerosoft: no es del dueño.
    expect(await usedAt(ownerStill)).toBeNull();
    // En B solo se recibió.
    expect(await usedAt(ownerB)).toBeNull();
    // Miembro: lo suyo sí; lo del teléfono no (puede no ver todos los chats: lo suma la importación).
    expect(await usedAt(memberStill)).toBe('2026-11-11T10:00:00.000Z');
    expect(await usedAt(memberAnim)).toBeNull();
    // Solo avanza.
    expect(await usedAt(newer)).toBe('2026-11-19T00:00:00.000Z');
    // Inbox: por cuenta.
    expect(await usedAt(inboxSent)).toBe('2026-11-14T10:00:00.000Z');
    expect(await usedAt(inboxOther)).toBeNull();
  });
});

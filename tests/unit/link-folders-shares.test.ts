import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { bulkLinkAction, createLink, createLinksBulk, getUserLink, listLinks, parseBulkLines } from '@/lib/links';
import { bulkResultsToCsv } from '@/lib/link-bulk-csv';
import {
  getWorkspaceAnalytics,
  localMidnightUtc,
  offsetSegments,
  parseTimezone,
  parseWorkspaceFilters,
} from '@/lib/link-analytics';
import { createFolder, deleteFolder, listFolders, resolveAccess, updateFolder, viewerOf } from '@/lib/link-folders';
import { createShare, getPublicShare, isShareToken, listShares, revokeShare } from '@/lib/link-shares';
import { addMember, createTeam } from '@/lib/teams';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));

const linkRoute = await import('@/app/api/links/[id]/route');
const sharesRoute = await import('@/app/api/links/shares/route');
const shareRoute = await import('@/app/api/links/shares/[id]/route');
const foldersRoute = await import('@/app/api/links/folders/route');

const slug = (p: string) => `${p}${crypto.randomUUID().slice(0, 6)}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (path: string, method: string, body?: unknown) =>
  new NextRequest(`http://x${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.1` },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;

afterEach(() => {
  session.user = null;
});

async function mk(userId: string, s: string, extra: Record<string, unknown> = {}) {
  const r = await createLink(userId, { url: `https://${s}.example.com`, slug: slug(s), ...extra });
  if (!r.ok) throw new Error(r.code);
  return r.link;
}

async function click(linkId: string, ts: string, c: Partial<Record<'source' | 'country' | 'device', string>> = {}) {
  await getDb()
    .prepare('INSERT INTO clicks (link_id, ts, referrer, country, device, browser, os, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(linkId, ts, 'x.com', c.country ?? 'AR', c.device ?? 'desktop', 'Chrome', 'Mac OS', c.source ?? 'link');
}

/** Owner con un team y un miembro; `member` es la sesión del miembro actuando en el workspace. */
async function workspace() {
  const owner = await makeUser('fo');
  const person = await makeUser('fm');
  const team = await createTeam(owner.id, 'Equipo');
  await addMember(team.id, person.id, 'member');
  const member = { ...owner, actingUser: person, role: 'member' as const, team };
  return { owner, person, member };
}

describe('Link: alta masiva con dominio, slug y título por fila', () => {
  it('parseBulkLines: URL sola, comas, tabs y comas dentro de la URL', () => {
    expect(
      parseBulkLines(
        [
          'https://a.com',
          '',
          'https://b.com, promo-1, Promo de primavera, con coma',
          'https://c.com\tc-slug\tTítulo C',
          'https://d.com/x?a=1,2,3',
          'https://f.com/x?a=1, f-slug',
          'https://e.com,,Solo título',
        ].join('\n'),
      ),
    ).toEqual([
      { url: 'https://a.com' },
      { url: 'https://b.com', slug: 'promo-1', title: 'Promo de primavera, con coma' },
      { url: 'https://c.com', slug: 'c-slug', title: 'Título C' },
      { url: 'https://d.com/x?a=1,2,3' },
      { url: 'https://f.com/x?a=1', slug: 'f-slug' },
      { url: 'https://e.com', title: 'Solo título' },
    ]);
  });

  it('crea en el dominio elegido con el slug y el título de cada fila; un slug repetido falla solo en su fila', async () => {
    const u = await makeUser('bk');
    const domainId = crypto.randomUUID();
    const host = `go-${domainId.slice(0, 8)}.example.com`;
    await getDb().prepare('INSERT INTO link_domains (id, user_id, hostname, verified) VALUES (?, ?, ?, 1)').run(domainId, u.id, host);
    const s = slug('bk');
    const results = await createLinksBulk(u.id, {
      rows: parseBulkLines(`https://one.com, ${s}, Uno\nhttps://two.com, ${s}, Dos\nhttps://three.com`),
      domainId,
    });
    expect(results.map((r) => r.status)).toEqual(['created', 'error', 'created']);
    expect(results[0].short_url).toBe(`https://${host}/${s}`);
    expect(results[1].error).toBe('slug_taken');
    expect(results[2].short_url.startsWith(`https://${host}/`)).toBe(true);
    const created = await listLinks(u.id, { q: 'one.com' });
    expect(created.links[0].title).toBe('Uno');
    expect(created.links[0].domain_id).toBe(domainId);
    expect(bulkResultsToCsv(results).split('\n')[1]).toBe(`https://one.com,https://${host}/${s},created,Uno`);

    // Un dominio ajeno o sin verificar no crea nada.
    const other = await makeUser('bk2');
    const bad = await createLinksBulk(other.id, { rows: [{ url: 'https://x.com' }], domainId });
    expect(bad).toEqual([{ url: 'https://x.com', short_url: '', status: 'error', error: 'invalid_domain' }]);
  });
});

describe('Link: filtros y zona horaria en analytics', () => {
  it('parsea filtros válidos e ignora el resto', () => {
    expect(
      parseWorkspaceFilters(new URLSearchParams('tag=promo&domain=default&country=ar&device=phone&link=abc&folder=none')),
    ).toEqual({ tag: 'promo', domain: 'default', country: 'AR', link: 'abc', folder: 'none' });
    expect(parseTimezone('America/Argentina/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires');
    expect(parseTimezone('Mars/Base')).toBe('UTC');
  });

  it('filtra por tag, dominio, link, país y dispositivo', async () => {
    const u = await makeUser('af');
    const domainId = crypto.randomUUID();
    await getDb()
      .prepare('INSERT INTO link_domains (id, user_id, hostname, verified) VALUES (?, ?, ?, 1)')
      .run(domainId, u.id, `af-${domainId.slice(0, 8)}.example.com`);
    const tagged = await mk(u.id, 'tg', { tags: ['promo'] });
    const custom = await mk(u.id, 'cd', { domainId });
    await click(tagged.id, '2026-03-01 10:00:00', { country: 'AR', device: 'mobile' });
    await click(tagged.id, '2026-03-01 11:00:00', { country: 'UY' });
    await click(custom.id, '2026-03-02 10:00:00', { country: 'AR', source: 'qr' });
    const range = { from: '2026-03-01', to: '2026-03-03' };
    const total = (f: Parameters<typeof parseWorkspaceFilters>[0]) =>
      getWorkspaceAnalytics(u.id, range, { filters: parseWorkspaceFilters(f) }).then((r) => r.clicks + r.scans);

    expect(await total({})).toBe(3);
    expect(await total({ tag: 'promo' })).toBe(2);
    expect(await total({ domain: domainId })).toBe(1);
    expect(await total({ domain: 'default' })).toBe(2);
    expect(await total({ link: custom.id })).toBe(1);
    expect(await total({ country: 'AR' })).toBe(2);
    expect(await total({ device: 'mobile' })).toBe(1);
    expect(await total({ tag: 'promo', country: 'UY' })).toBe(1);
  });

  it('corta los días en la zona elegida, también con cambio de horario', async () => {
    const u = await makeUser('tz');
    const l = await mk(u.id, 'tz');
    // 02:00 UTC del 2 de marzo = 23:00 del 1 de marzo en Buenos Aires (UTC-3).
    await click(l.id, '2026-03-02 02:00:00');
    await click(l.id, '2026-03-02 04:00:00');
    const range = { from: '2026-03-01', to: '2026-03-02' };
    const utc = await getWorkspaceAnalytics(u.id, range);
    expect(utc.byDay.map((d) => d.clicks)).toEqual([0, 2]);
    expect(utc.timezone).toBe('UTC');
    const ba = await getWorkspaceAnalytics(u.id, range, { timezone: 'America/Argentina/Buenos_Aires' });
    expect(ba.byDay.map((d) => d.clicks)).toEqual([1, 1]);

    // Nueva York pasa a UTC-4 el 8 de marzo de 2026 a las 07:00 UTC.
    const segs = offsetSegments('America/New_York', localMidnightUtc('2026-03-07', 'America/New_York'), localMidnightUtc('2026-03-10', 'America/New_York'));
    expect(segs.map((s) => s.offset)).toEqual([-300, -240]);
    expect(new Date(segs[0].until).toISOString()).toBe('2026-03-08T07:00:00.000Z');
    const ny = await makeUser('ny');
    const nl = await mk(ny.id, 'ny');
    await click(nl.id, '2026-03-08 04:30:00'); // 23:30 del 7 (UTC-5)
    await click(nl.id, '2026-03-09 03:30:00'); // 23:30 del 8 (UTC-4)
    const r = await getWorkspaceAnalytics(ny.id, { from: '2026-03-07', to: '2026-03-09' }, { timezone: 'America/New_York' });
    expect(r.byDay.map((d) => d.clicks)).toEqual([1, 1, 0]);
  });
});

describe('Link: páginas públicas de analytics', () => {
  it('token largo, se lista, se abre y deja de funcionar al revocarla', async () => {
    const u = await makeUser('sh');
    const l = await mk(u.id, 'sh', { tags: ['launch'] });
    const res = await createShare(u.id, { linkId: l.id }, u.id);
    if (!res.ok) throw new Error(res.code);
    expect(isShareToken(res.share.token)).toBe(true);
    expect(res.share.url).toContain(`/stats/${res.share.token}`);
    expect((await listShares(u.id, { linkId: l.id })).map((s) => s.id)).toEqual([res.share.id]);
    const pub = await getPublicShare(res.share.token);
    expect(pub?.link?.id).toBe(l.id);

    expect(await getPublicShare('x'.repeat(43))).toBeNull();
    expect(await revokeShare(u.id, res.share.id)).toBe(true);
    expect(await getPublicShare(res.share.token)).toBeNull();
    expect(await listShares(u.id, { linkId: l.id })).toEqual([]);

    // Tag: tiene que existir en el workspace; un link ajeno no se puede compartir.
    expect((await createShare(u.id, { tag: 'nope' }, u.id)).ok).toBe(false);
    const tagShare = await createShare(u.id, { tag: 'launch' }, u.id);
    expect(tagShare.ok && (await getPublicShare(tagShare.share.token))?.label).toBe('launch');
    const other = await makeUser('sh2');
    expect(await createShare(other.id, { linkId: l.id }, other.id)).toEqual({ ok: false, code: 'not_found' });
  });

  it('API: un miembro comparte un link pero no un tag; revoca quien la creó', async () => {
    const { owner, member } = await workspace();
    const l = await mk(owner.id, 'shm', { tags: ['t1'] });
    session.user = member as unknown as Record<string, unknown>;
    const created = await sharesRoute.POST(jsonReq('/api/links/shares', 'POST', { linkId: l.id }));
    expect(created.status).toBe(201);
    const share = (await created.json()) as { id: string };
    expect((await sharesRoute.POST(jsonReq('/api/links/shares', 'POST', { tag: 't1' }))).status).toBe(403);
    expect((await shareRoute.DELETE(jsonReq(`/api/links/shares/${share.id}`, 'DELETE'), ctx(share.id))).status).toBe(204);
  });
});

describe('Link: carpetas con acceso por carpeta', () => {
  it('resolveAccess: admins editan, la excepción gana al default', () => {
    expect(resolveAccess({ id: 'a', admin: true }, { default_access: 'none' }, 'none')).toBe('edit');
    expect(resolveAccess({ id: 'a', admin: false }, null, undefined)).toBe('edit');
    expect(resolveAccess({ id: 'a', admin: false }, { default_access: 'view' }, undefined)).toBe('view');
    expect(resolveAccess({ id: 'a', admin: false }, { default_access: 'view' }, 'edit')).toBe('edit');
    expect(viewerOf({ id: 'o', actingUser: { id: 'm' }, role: 'member' })).toEqual({ id: 'm', admin: false });
  });

  it('ver sin editar, ocultar con none, excepciones por persona y borrar sin perder links', async () => {
    const { owner, person, member } = await workspace();
    const viewer = viewerOf(member);
    const f = await createFolder(owner.id, { name: 'Campañas', defaultAccess: 'view' });
    if (!f.ok) throw new Error(f.code);
    expect((await createFolder(owner.id, { name: 'campañas' })).ok).toBe(false);
    const inFolder = await mk(owner.id, 'inf', { folderId: f.folder.id });
    const loose = await mk(owner.id, 'loose');

    // Un miembro no puede crear en una carpeta de solo lectura.
    expect(await createLink(owner.id, { url: 'https://m.com', folderId: f.folder.id, viewer })).toEqual({
      ok: false,
      code: 'invalid_folder',
    });

    session.user = member as unknown as Record<string, unknown>;
    expect((await linkRoute.GET(jsonReq(`/api/links/${inFolder.id}`, 'GET'), ctx(inFolder.id))).status).toBe(200);
    const patch = await linkRoute.PATCH(jsonReq(`/api/links/${inFolder.id}`, 'PATCH', { title: 'x' }), ctx(inFolder.id));
    expect(patch.status).toBe(403);
    expect((await linkRoute.PATCH(jsonReq(`/api/links/${loose.id}`, 'PATCH', { title: 'ok' }), ctx(loose.id))).status).toBe(200);
    // Mover un link suelto a una carpeta de lectura tampoco.
    const move = await linkRoute.PATCH(jsonReq(`/api/links/${loose.id}`, 'PATCH', { folderId: f.folder.id }), ctx(loose.id));
    expect(move.status).toBe(400);
    expect(await bulkLinkAction(owner.id, { action: 'archive', ids: [inFolder.id, loose.id] }, viewer)).toBe(1);
    expect((await getUserLink(owner.id, inFolder.id))?.archived).toBe(0);

    // Sin acceso: no aparece en la lista ni se abre.
    await updateFolder(owner.id, f.folder.id, { members: [{ userId: person.id, access: 'none' }] });
    const listed = await listLinks(owner.id, { archived: 'all', viewer });
    expect(listed.links.map((l) => l.id)).toEqual([loose.id]);
    expect((await linkRoute.GET(jsonReq(`/api/links/${inFolder.id}`, 'GET'), ctx(inFolder.id))).status).toBe(404);
    expect(await listFolders(owner.id, viewer)).toEqual([]);
    const folderList = await foldersRoute.GET();
    expect(((await folderList.json()) as { folders: unknown[] }).folders).toEqual([]);
    // Las analytics tampoco cuentan esa carpeta.
    await click(inFolder.id, '2026-04-01 10:00:00');
    expect((await getWorkspaceAnalytics(owner.id, { from: '2026-04-01', to: '2026-04-01' }, { viewer })).clicks).toBe(0);
    expect((await getWorkspaceAnalytics(owner.id, { from: '2026-04-01', to: '2026-04-01' })).clicks).toBe(1);

    // Con edición: se edita y se mueve.
    await updateFolder(owner.id, f.folder.id, { members: [{ userId: person.id, access: 'edit' }] });
    expect((await linkRoute.PATCH(jsonReq(`/api/links/${inFolder.id}`, 'PATCH', { title: 'y' }), ctx(inFolder.id))).status).toBe(200);
    expect(await bulkLinkAction(owner.id, { action: 'move', ids: [loose.id], folderId: f.folder.id }, viewer)).toBe(1);
    expect((await listLinks(owner.id, { folder: f.folder.id, archived: 'all' })).total).toBe(2);
    expect((await listLinks(owner.id, { folder: 'none' })).links.map((l) => l.id)).not.toContain(loose.id);

    // Solo admins crean carpetas; borrar deja los links sin carpeta.
    expect((await foldersRoute.POST(jsonReq('/api/links/folders', 'POST', { name: 'Otra' }))).status).toBe(403);
    expect(await updateFolder(owner.id, f.folder.id, { members: [{ userId: 'ajeno', access: 'edit' }] })).toEqual({
      ok: false,
      code: 'invalid_member',
    });
    expect(await deleteFolder(owner.id, f.folder.id)).toBe(true);
    expect((await getUserLink(owner.id, inFolder.id))?.folder_id).toBeNull();
  });
});

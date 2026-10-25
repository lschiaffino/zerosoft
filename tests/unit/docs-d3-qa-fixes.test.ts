import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb, upsertUser } from '@/lib/db';
import { createDocPage, createDocShare, getDocPageRow, updateDocPage } from '@/lib/docs';
import { listDocVersions } from '@/lib/docs-versions';
import { acceptGuestInvite, createGuestInvite } from '@/lib/docs-guests';
import { auditTargetLabel } from '@/lib/docs-audit';
import { addMember, createTeam } from '@/lib/teams';
import type { DocsBlock, DocsDatabase } from '@/lib/docs-types';
import { makeUser } from './helpers';

type FakeUser = { id: string; email: string; name?: string | null; actingUser?: { id: string; email: string; name?: string | null }; role?: string; team?: { id: string } | null };
const session = vi.hoisted(() => ({ user: null as null | FakeUser }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: FakeUser) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: FakeUser) => !u.actingUser || u.role === 'owner' || u.role === 'admin',
}));
vi.mock('@/lib/user-tz', () => ({ getUserTimeZone: async () => 'UTC' }));

const pageRoute = await import('@/app/api/docs/pages/[id]/route');
const liveRoute = await import('@/app/api/docs/pages/[id]/live/route');
const dbRoute = await import('@/app/api/docs/databases/[pageId]/[blockId]/route');
const searchRoute = await import('@/app/api/docs/search/route');

function req(url: string, method = 'GET', body?: unknown) {
  const r = new Request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return Object.assign(r, { cookies: { get: () => undefined }, nextUrl: new URL(url) }) as never;
}
const para = (id: string, content: string): DocsBlock => ({ id, type: 'paragraph', content });

beforeEach(() => {
  session.user = null;
});

describe('Docs D3 QA: guardados', () => {
  it('un PATCH con el mismo contenido no crea revisión ni versión', async () => {
    const owner = await makeUser('own');
    session.user = { id: owner.id, email: owner.email, name: owner.name };
    const page = await createDocPage(owner.id, { title: 'Igual', content: [para('a', 'Hola')] });
    const before = (await getDocPageRow(page.id))!;
    const url = `http://x/api/docs/pages/${page.id}`;
    const res = await pageRoute.PATCH(req(url, 'PATCH', { content: [para('a', 'Hola')], base_updated_at: before.updated_at }), { params: Promise.resolve({ id: page.id }) });
    expect(res.status).toBe(200);
    const after = (await getDocPageRow(page.id))!;
    expect(after.updated_at).toBe(before.updated_at);
    const revs = (await getDb().prepare('SELECT COUNT(*) AS c FROM docs_page_revisions WHERE page_id = ?').get(page.id)) as { c: number };
    expect(Number(revs.c)).toBe(0);
    expect(await listDocVersions(owner.id, page.id)).toEqual([]);
  });

  it('quien pierde un choque recibe aviso y la versión guardada es suya', async () => {
    const owner = await makeUser('own');
    const bob = await makeUser('bob');
    const team = await createTeam(owner.id, 'Equipo');
    await addMember(team.id, bob.id, 'member');
    const page = await createDocPage(owner.id, { title: 'Choque', content: [para('a', 'Base')] });
    const base = (await getDocPageRow(page.id))!.updated_at;
    // Bob guarda primero; la dueña guarda sobre la base vieja cambiando el mismo bloque.
    await updateDocPage(owner.id, page.id, { content: [para('a', 'De Bob')], base_updated_at: base }, { actorId: bob.id });
    await updateDocPage(owner.id, page.id, { content: [para('a', 'De la dueña')], base_updated_at: base }, { actorId: owner.id });
    const versions = await listDocVersions(owner.id, page.id);
    expect(versions[0]?.author_id).toBe(bob.id);
    const notes = (await getDb().prepare("SELECT meta FROM notifications WHERE user_id = ? AND source_id = ?").all(bob.id, page.id)) as Array<{ meta: string }>;
    expect(notes.some((n) => JSON.parse(n.meta).conflict === true)).toBe(true);
  });

  it('la API de bases no acepta cambios en una página bloqueada (423)', async () => {
    const owner = await makeUser('own');
    session.user = { id: owner.id, email: owner.email, role: 'owner' };
    const db: DocsDatabase = { title: 'T', properties: [{ id: 'n', name: 'Name', type: 'title' }], rows: [{ id: 'r1', values: { n: 'Uno' }, created_at: '', updated_at: '' }], views: [{ id: 'v', name: '', type: 'table' }] };
    const page = await createDocPage(owner.id, { title: 'Bloqueada', content: [{ id: 'db1', type: 'database', content: '', db } as DocsBlock] });
    await updateDocPage(owner.id, page.id, { locked: true }, { actorId: owner.id });
    const res = await dbRoute.POST(
      new NextRequest(`http://t/api/docs/databases/${page.id}/db1`, { method: 'POST', body: JSON.stringify({ ops: [{ op: 'set_cell', row: 'r1', prop: 'n', value: 'Pisado' }] }) }),
      { params: Promise.resolve({ pageId: page.id, blockId: 'db1' }) },
    );
    expect(res.status).toBe(423);
    expect((await getDocPageRow(page.id))!.content).not.toContain('Pisado');
  });
});

describe('Docs D3 QA: invitados, auditoría y presencia', () => {
  it('aceptar dos veces el mismo link solo cuenta la primera; el detalle lleva nombres', async () => {
    const owner = await makeUser('own');
    const page = await createDocPage(owner.id, { title: 'Para afuera' });
    const email = `cliente-${crypto.randomUUID().slice(0, 6)}@afuera.test`;
    const { token } = await createGuestInvite({ page: (await getDocPageRow(page.id))!, email, role: 'comment', invitedBy: owner });
    const guest = await upsertUser({ id: `g-${crypto.randomUUID().slice(0, 8)}`, email, name: 'Cliente Uno', image: null });
    expect(await acceptGuestInvite(token, guest)).toMatchObject({ ok: true, first: true });
    expect(await acceptGuestInvite(token, guest)).toMatchObject({ ok: true, first: false });
    expect(await auditTargetLabel('user', guest.id)).toBe('Cliente Uno');
    const team = await createTeam(owner.id, 'Ventas');
    expect(await auditTargetLabel('team', team.id)).toBe('Ventas');
  });

  it('un invitado encuentra en la búsqueda lo que le compartieron', async () => {
    const owner = await makeUser('own');
    const guest = await makeUser('gst');
    const page = await createDocPage(owner.id, { title: 'Propuesta comercial', content: [para('a', 'Precio cuarzolimón por mes')] });
    await createDocPage(owner.id, { title: 'Interna cuarzolimón' });
    await createDocShare(owner.id, page.id, 'user', guest.id, 'comment');
    session.user = { id: guest.id, email: guest.email, name: guest.name };
    const rows = ((await (await searchRoute.GET(req('http://x/api/docs/search?content=1&q=cuarzolimón'))).json()) as { rows: Array<{ id: string; title: string }> }).rows;
    expect(rows.map((r) => r.id)).toEqual([page.id]);
  });

  it('uno mismo en otra pestaña no aparece como presente', async () => {
    const owner = await makeUser('own');
    const bob = await makeUser('bob');
    const team = await createTeam(owner.id, 'Equipo');
    await addMember(team.id, bob.id, 'member');
    const page = await createDocPage(owner.id, { title: 'Presencia' });
    const ctx = { params: Promise.resolve({ id: page.id }) };
    const pulse = async (u: FakeUser, s: string) =>
      (await (await liveRoute.POST(req(`http://x/api/docs/pages/${page.id}/live`, 'POST', { session: s }), ctx)).json()) as { peers: Array<{ user_id: string }> };
    session.user = { id: owner.id, email: owner.email };
    await pulse(session.user, 'tab-own-one');
    const asBob: FakeUser = { id: owner.id, email: owner.email, actingUser: { id: bob.id, email: bob.email }, role: 'member', team };
    session.user = asBob;
    await pulse(asBob, 'tab-bob-one1');
    session.user = { id: owner.id, email: owner.email };
    const second = await pulse(session.user, 'tab-own-two');
    expect(second.peers.map((p) => p.user_id)).toEqual([bob.id]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { bulkLinkAction, createLink, getUserLink, parseTags } from '@/lib/links';
import { createApiKey } from '@/lib/api-auth';
import { addMember, createTeam } from '@/lib/teams';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string }) => u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));

const batchRoute = await import('@/app/api/links/batch/route');
const linkRoute = await import('@/app/api/links/[id]/route');
const v1LinkRoute = await import('@/app/api/v1/links/[id]/route');

const post = (body: unknown) =>
  new NextRequest('http://x/api/links/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;

const slug = (p: string) => `${p}${crypto.randomUUID().slice(0, 6)}`;

async function twoWorkspaces() {
  const a = await makeUser('la');
  const b = await makeUser('lb');
  const mk = async (userId: string, url: string, tags?: string[]) => {
    const r = await createLink(userId, { url, slug: slug('k'), tags });
    if (!r.ok) throw new Error(r.code);
    return r.link;
  };
  const a1 = await mk(a.id, 'https://example.com/1', ['x']);
  const a2 = await mk(a.id, 'https://example.com/2');
  const b1 = await mk(b.id, 'https://example.com/3');
  return { a, b, a1, a2, b1 };
}

describe('Link: acciones masivas', () => {
  it('archiva, etiqueta y borra solo links del workspace (ids ajenos se ignoran)', async () => {
    const { a, b, a1, a2, b1 } = await twoWorkspaces();
    const ids = [a1.id, a2.id, b1.id];

    expect(await bulkLinkAction(a.id, { action: 'archive', ids })).toBe(2);
    expect((await getUserLink(a.id, a1.id))?.archived).toBe(1);
    expect((await getUserLink(b.id, b1.id))?.archived).toBe(0);

    expect(await bulkLinkAction(a.id, { action: 'tag', ids, tag: 'promo' })).toBe(2);
    expect(parseTags((await getUserLink(a.id, a1.id))!.tags)).toEqual(['x', 'promo']);
    expect(parseTags((await getUserLink(b.id, b1.id))!.tags)).toEqual([]);
    // Etiquetar de nuevo no duplica.
    expect(await bulkLinkAction(a.id, { action: 'tag', ids, tag: 'promo' })).toBe(0);

    expect(await bulkLinkAction(a.id, { action: 'unarchive', ids })).toBe(2);
    expect(await bulkLinkAction(a.id, { action: 'delete', ids })).toBe(2);
    expect(await getUserLink(a.id, a1.id)).toBeUndefined();
    expect(await getUserLink(b.id, b1.id)).toBeDefined();
  });

  it('API /api/links/batch: auth, validación y aislamiento', async () => {
    const { a, b, a1, b1 } = await twoWorkspaces();

    session.user = null;
    expect((await batchRoute.POST(post({ action: 'archive', ids: [a1.id] }))).status).toBe(401);

    session.user = { ...b, team: null, role: 'owner' };
    expect((await batchRoute.POST(post({ action: 'nuke', ids: [a1.id] }))).status).toBe(400);
    expect((await batchRoute.POST(post({ action: 'tag', ids: [a1.id] }))).status).toBe(400); // falta tag
    const res = await batchRoute.POST(post({ action: 'delete', ids: [a1.id, b1.id] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, affected: 1 });
    // El link de A sigue ahí.
    const row = await getDb().prepare('SELECT id FROM links WHERE id = ?').get(a1.id);
    expect(row).toBeDefined();
    expect(a.id).not.toBe(b.id);
    session.user = null;
  });

  it('borrar un link suelto pide el mismo rol que el borrado masivo (admin), por sesión y por API', async () => {
    const owner = await makeUser('ldel');
    const member = await makeUser('ldel-m');
    const admin = await makeUser('ldel-a');
    const team = await createTeam(owner.id, 'Links');
    await addMember(team.id, member.id, 'member');
    await addMember(team.id, admin.id, 'admin');
    const mk = async () => {
      const r = await createLink(owner.id, { url: 'https://example.com', slug: slug('d') });
      if (!r.ok) throw new Error(r.code);
      return r.link;
    };
    const exists = async (id: string) => Boolean(await getDb().prepare('SELECT id FROM links WHERE id = ?').get(id));
    const del = (id: string) =>
      linkRoute.DELETE(new NextRequest(`http://x/api/links/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id }) });
    const v1Del = (id: string, key: string) =>
      v1LinkRoute.DELETE(
        new NextRequest(`http://x/api/v1/links/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${key}` } }),
        { params: Promise.resolve({ id }) },
      );

    // Sesión: un member actúa sobre el workspace del owner (user.id = owner).
    const l1 = await mk();
    session.user = { ...owner, team, role: 'member' };
    expect((await del(l1.id)).status).toBe(403);
    expect(await exists(l1.id)).toBe(true);
    session.user = { ...owner, team, role: 'admin' };
    expect((await del(l1.id)).status).toBe(204);
    expect(await exists(l1.id)).toBe(false);
    session.user = null;

    // API v1: la key actúa con el rol de quien la creó.
    const l2 = await mk();
    const memberKey = (await createApiKey(owner.id, 'm', member.id)).key;
    const adminKey = (await createApiKey(owner.id, 'a', admin.id)).key;
    const res = await v1Del(l2.id, memberKey);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: 'forbidden', message: expect.any(String) } });
    expect(await exists(l2.id)).toBe(true);
    expect((await v1Del(l2.id, adminKey)).status).toBe(204);
    expect(await exists(l2.id)).toBe(false);
  });
});

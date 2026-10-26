import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectDescendants,
  createDocComment,
  createDocPage,
  createDocShare,
  deleteDocShare,
  getDocComment,
  getDocPage,
  listDocPages,
  moveDocPage,
  updateDocPage,
} from '@/lib/docs';
import { saveDocVersion } from '@/lib/docs-versions';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; actingUser?: { id: string } },
}));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { actingUser?: { id: string }; role?: string }) => !u.actingUser || u.role === 'owner' || u.role === 'admin',
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const actions = await import('@/lib/docs-actions');
const versionsRoute = await import('@/lib/routes/docs/pages/[id]/versions/route');
const commentsRoute = await import('@/lib/routes/docs/pages/[id]/comments/route');
const commentRoute = await import('@/lib/routes/docs/pages/[id]/comments/[commentId]/route');
const pageRoute = await import('@/lib/routes/docs/pages/[id]/route');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
function jsonReq(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  session.user = null;
});

describe('Docs: server actions usan el usuario de la sesión', () => {
  it('sin sesión no se puede mover ni crear', async () => {
    const victim = await makeUser('vic');
    const a = await createDocPage(victim.id, { title: 'A' });
    const b = await createDocPage(victim.id, { title: 'B' });
    await expect(actions.moveDocPageAction(a.id, b.id)).rejects.toThrow();
    await expect(actions.createDocPageAction('en', null)).rejects.toThrow('unauthorized');
    expect((await getDocPage(victim.id, a.id))?.parent_id).toBeNull();
  });

  it('un usuario de otro workspace no puede mover páginas ajenas', async () => {
    const victim = await makeUser('vic');
    const attacker = await makeUser('att');
    const a = await createDocPage(victim.id, { title: 'A' });
    const b = await createDocPage(victim.id, { title: 'B' });
    session.user = { id: attacker.id, email: attacker.email };
    await actions.moveDocPageAction(a.id, b.id);
    await actions.reorderDocPageAction(a.id, b.id, 'after');
    await actions.moveDocPageStepAction(a.id, 1);
    expect((await getDocPage(victim.id, a.id))?.parent_id).toBeNull();
    // Crear: queda en el workspace del que llama, nunca en el de la víctima.
    const before = (await listDocPages(victim.id)).length;
    await expect(actions.createDocPageAction('en', a.id)).rejects.toThrow(/^REDIRECT:\/en\/app\/docs\//);
    expect((await listDocPages(victim.id)).length).toBe(before);
    const mine = await listDocPages(attacker.id);
    expect(mine).toHaveLength(1);
    // No se cuelga de una página de otro workspace.
    expect(mine[0].parent_id).toBeNull();
  });

  it('el locale del redirect no permite redirigir afuera', async () => {
    const u = await makeUser('loc');
    session.user = { id: u.id, email: u.email };
    await expect(actions.createDocPageAction('/evil.com', null)).rejects.toThrow(/^REDIRECT:\/en\/app\/docs\//);
  });
});

describe('Docs: publicar no expone historial ni comentarios', () => {
  it('un usuario logueado de otro workspace ve la página publicada pero no versiones ni comentarios', async () => {
    const owner = await makeUser('own');
    const stranger = await makeUser('str');
    const page = await createDocPage(owner.id, { title: 'Ayuda' });
    await saveDocVersion(owner.id, page.id, owner.id, 'manual');
    await createDocComment(page.id, owner.id, { body: 'interno' });
    await updateDocPage(owner.id, page.id, { published: true });

    session.user = { id: stranger.id, email: stranger.email };
    const url = `http://x/api/docs/pages/${page.id}`;
    expect((await pageRoute.GET(jsonReq(url, 'GET'), ctx(page.id))).status).toBe(200);
    expect((await versionsRoute.GET(jsonReq(`${url}/versions`, 'GET'), ctx(page.id))).status).toBe(404);
    expect((await commentsRoute.GET(jsonReq(`${url}/comments`, 'GET'), ctx(page.id))).status).toBe(404);
    expect(
      (await commentsRoute.POST(jsonReq(`${url}/comments`, 'POST', { body: 'spam' }), ctx(page.id))).status,
    ).toBe(404);
  });

  it('un share explícito sí da acceso al historial', async () => {
    const owner = await makeUser('own');
    const guest = await makeUser('gst');
    const page = await createDocPage(owner.id, { title: 'Plan' });
    await createDocShare(owner.id, page.id, 'user', guest.id, 'view');
    session.user = { id: guest.id, email: guest.email };
    const url = `http://x/api/docs/pages/${page.id}`;
    expect((await versionsRoute.GET(jsonReq(`${url}/versions`, 'GET'), ctx(page.id))).status).toBe(200);
    expect((await commentsRoute.GET(jsonReq(`${url}/comments`, 'GET'), ctx(page.id))).status).toBe(200);
  });
});

describe('Docs: borrar un comentario propio', () => {
  it('con el share revocado ya no puede borrar sus comentarios; con acceso, sí', async () => {
    const owner = await makeUser('own');
    const guest = await makeUser('gst');
    const page = await createDocPage(owner.id, { title: 'Review' });
    // Comentar (y borrar lo propio) pide "puede comentar" o más; "puede ver" solo lee.
    const share = await createDocShare(owner.id, page.id, 'user', guest.id, 'comment');
    if (!share) throw new Error('share');
    const kept = await createDocComment(page.id, guest.id, { body: 'Cambiar el precio' });
    const removed = await createDocComment(page.id, guest.id, { body: 'Typo' });
    const del = (commentId: string) =>
      commentRoute.DELETE(jsonReq(`http://x/api/docs/pages/${page.id}/comments/${commentId}`, 'DELETE'), {
        params: Promise.resolve({ id: page.id, commentId }),
      });

    session.user = { id: guest.id, email: guest.email };
    expect((await del(removed.id)).status).toBe(204);
    expect(await getDocComment(removed.id)).toBeFalsy();

    expect(await deleteDocShare(owner.id, page.id, share.id)).toBe(true);
    expect((await del(kept.id)).status).toBe(404);
    expect(await getDocComment(kept.id)).toBeTruthy();

    // El dueño de la página sigue pudiendo borrarlo.
    session.user = { id: owner.id, email: owner.email };
    expect((await del(kept.id)).status).toBe(204);
  });
});

describe('Docs: mover dentro de un descendiente', () => {
  it('rechaza ciclos de parent_id', async () => {
    const u = await makeUser('cyc');
    const a = await createDocPage(u.id, { title: 'A' });
    const b = await createDocPage(u.id, { title: 'B', parent_id: a.id });
    const c = await createDocPage(u.id, { title: 'C', parent_id: b.id });
    expect(await moveDocPage(u.id, a.id, b.id)).toBeNull();
    expect(await moveDocPage(u.id, a.id, c.id)).toBeNull();
    expect(await moveDocPage(u.id, a.id, a.id)).toBeNull();
    expect((await getDocPage(u.id, a.id))?.parent_id).toBeNull();
    // Un movimiento válido sigue funcionando.
    const d = await createDocPage(u.id, { title: 'D' });
    expect((await moveDocPage(u.id, d.id, c.id))?.parent_id).toBe(c.id);
  });

  it('rechaza padres de otro workspace', async () => {
    const u = await makeUser('own');
    const other = await makeUser('oth');
    const a = await createDocPage(u.id, { title: 'A' });
    const foreign = await createDocPage(other.id, { title: 'F' });
    expect(await moveDocPage(u.id, a.id, foreign.id)).toBeNull();
  });

  it('collectDescendants termina aunque haya un ciclo en los datos', async () => {
    const u = await makeUser('loop');
    const a = await createDocPage(u.id, { title: 'A' });
    const b = await createDocPage(u.id, { title: 'B', parent_id: a.id });
    await getDb().prepare('UPDATE docs_pages SET parent_id = ? WHERE id = ?').run(b.id, a.id);
    const ids = await collectDescendants(u.id, a.id);
    expect(ids.sort()).toEqual([a.id, b.id].sort());
  });
});

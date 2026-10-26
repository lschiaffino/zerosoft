import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocPage, createDocShare, updateDocPage } from '@/lib/docs';
import { getSyncedBlock } from '@/lib/docs-synced';
import type { DocsBlock } from '@/lib/docs-types';
import { makeUser } from './helpers';

/**
 * Un invitado con edición en una página que pega un bloque sincronizado no
 * cambia su contenido si no puede editar la página de origen.
 */
type FakeUser = { id: string; email: string; name?: string | null };
const session = vi.hoisted(() => ({ user: null as null | FakeUser }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: FakeUser) => u.id,
  isWorkspaceAdmin: () => true,
}));
vi.mock('@/lib/user-tz', () => ({ getUserTimeZone: async () => 'UTC' }));

const pageRoute = await import('@/lib/routes/docs/pages/[id]/route');

function req(url: string, method = 'GET', body?: unknown) {
  const r = new Request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return Object.assign(r, { cookies: { get: () => undefined }, nextUrl: new URL(url) }) as never;
}
const para = (id: string, content: string, indent = 0): DocsBlock => ({ id, type: 'paragraph', content, ...(indent ? { indent } : {}) });

beforeEach(() => {
  session.user = null;
});

describe('Docs: editar un sincronizado pide poder editar su origen', () => {
  async function setup() {
    const owner = await makeUser('own');
    const guest = await makeUser('gst');
    const sid = `sync-${crypto.randomUUID().slice(0, 12)}`;
    const synced: DocsBlock[] = [{ id: 's', type: 'synced', content: '', synced_id: sid }, para('c', 'Política oficial', 1)];
    const src = await createDocPage(owner.id, { title: 'Políticas' });
    await updateDocPage(owner.id, src.id, { content: synced }, { actorId: owner.id });
    const host = await createDocPage(owner.id, { title: 'Compartida' });
    await updateDocPage(owner.id, host.id, { content: [para('a', 'Hola'), ...synced] }, { actorId: owner.id });
    await createDocShare(owner.id, host.id, 'user', guest.id, 'edit');
    return { owner, guest, sid, src, host };
  }
  // Como el editor: carga la página (con la versión de cada sincronizado, synced_at) y guarda con eso.
  const patch = async (id: string, content: DocsBlock[]) => {
    const seen = (await (await pageRoute.GET(req(`http://x/api/docs/pages/${id}`), { params: Promise.resolve({ id }) })).json()) as { content: DocsBlock[]; updated_at: string };
    const at = new Map(seen.content.filter((b) => b.type === 'synced').map((b) => [b.synced_id, b.synced_at]));
    const withAt = content.map((b) => (b.type === 'synced' && at.get(b.synced_id) ? { ...b, synced_at: at.get(b.synced_id) } : b));
    return pageRoute.PATCH(req(`http://x/api/docs/pages/${id}`, 'PATCH', { content: withAt, base_updated_at: seen.updated_at }), { params: Promise.resolve({ id }) });
  };

  it('un invitado sin acceso (o solo con lectura) al origen no lo cambia', async () => {
    const { owner, guest, sid, src, host } = await setup();
    session.user = { id: guest.id, email: guest.email };
    const defaced = [para('a', 'Hola'), { id: 's', type: 'synced', content: '', synced_id: sid } as DocsBlock, para('c', 'DEFACED', 1), para('b', 'del invitado')];
    expect((await patch(host.id, defaced)).status).toBe(200);
    expect((await getSyncedBlock(owner.id, sid))?.[0]?.content).toBe('Política oficial');
    await createDocShare(owner.id, src.id, 'user', guest.id, 'view');
    expect((await patch(host.id, defaced.map((b) => (b.id === 'c' ? { ...b, content: 'DEFACED 2' } : b)))).status).toBe(200);
    expect((await getSyncedBlock(owner.id, sid))?.[0]?.content).toBe('Política oficial');
  });

  it('con edición en el origen sí lo cambia', async () => {
    const { owner, guest, sid, src, host } = await setup();
    await createDocShare(owner.id, src.id, 'user', guest.id, 'edit');
    session.user = { id: guest.id, email: guest.email };
    await patch(host.id, [para('a', 'Hola'), { id: 's', type: 'synced', content: '', synced_id: sid } as DocsBlock, para('c', 'Política 2', 1)]);
    expect((await getSyncedBlock(owner.id, sid))?.[0]?.content).toBe('Política 2');
  });

  it('el dueño del workspace sigue editándolo desde cualquier página', async () => {
    const { owner, sid, host } = await setup();
    session.user = { id: owner.id, email: owner.email };
    await patch(host.id, [para('a', 'Hola'), { id: 's', type: 'synced', content: '', synced_id: sid } as DocsBlock, para('c', 'Del dueño', 1)]);
    expect((await getSyncedBlock(owner.id, sid))?.[0]?.content).toBe('Del dueño');
  });
});

/**
 * Inbox: cambiar el nombre y la descripción de un grupo de WhatsApp desde la
 * info del grupo (el lápiz, como en WhatsApp Web). Va a WhatsApp, queda en el
 * chat con el aviso "Cambiaste…", valida el nombre vacío y solo la dueña de la
 * cuenta puede. Con el WhatsApp falso y números inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectWhatsapp } from '@/lib/inbox/whatsapp';
import { createWhatsappGroup } from '@/lib/inbox/new-chat';
import { cleanGroupInfoPatch } from '@/lib/inbox/wa-group-members';
import { parseThreadInfo } from '@/lib/inbox/wa-meta';
import { InboxError } from '@/lib/inbox/types';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const inboxRoute = await import('@/lib/routes/inbox/threads/[id]/wa/route');

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => {
  session.user = null;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type FakeGroup = { name: string; description: string; participants: Array<{ phone: string; role: string }> };
type FakeState = { connectedAt: number | null; groups: Map<string, FakeGroup> };
const fake = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, FakeState> }).__groupsFake.get(id);
const post = (body: unknown) => new Request('http://x/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function inboxGroup(label: string) {
  const u = await makeUser(label);
  const { account: acc } = await connectWhatsapp(u.id);
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected', address = '15550000001' WHERE id = ?").run(acc.id);
  const s = fake(`inbox-${acc.id}`);
  if (s) s.connectedAt = Date.now() - 5000;
  const thread = await createWhatsappGroup(u.id, { name: `Grupo ${label}`, phones: ['15550101000'] });
  return { u, accountId: acc.id, thread };
}

async function inboxPost(threadId: string, body: unknown) {
  const res = await inboxRoute.POST(post(body), ctx(threadId));
  return { status: res.status, data: (await res.json()) as { title?: string; about?: string; error?: string } };
}

async function row(id: string) {
  return (await getDb().prepare('SELECT title, info FROM inbox_threads WHERE id = ?').get(id)) as { title: string; info: string };
}

describe('cleanGroupInfoPatch', () => {
  it('limpia el nombre, deja la descripción vacía y corta lo largo', () => {
    expect(cleanGroupInfoPatch({ name: '  Equipo   ventas ' })).toEqual({ name: 'Equipo ventas' });
    expect(cleanGroupInfoPatch({ description: '  ' })).toEqual({ description: '' });
    expect(cleanGroupInfoPatch({ name: 'x'.repeat(150) }).name).toHaveLength(100);
    expect(cleanGroupInfoPatch({ description: 'y'.repeat(3000) }).description).toHaveLength(2000);
  });

  it('un nombre vacío o nada para cambiar es un error', () => {
    expect(() => cleanGroupInfoPatch({ name: '   ' })).toThrow(InboxError);
    expect(() => cleanGroupInfoPatch({})).toThrow(InboxError);
    expect(() => cleanGroupInfoPatch({ name: 3 })).toThrow(InboxError);
  });
});

describe('Inbox: nombre y descripción del grupo', () => {
  it('cambia el nombre y la descripción en WhatsApp, los guarda y deja el aviso en el chat', async () => {
    const { u, accountId, thread } = await inboxGroup('ige1');
    session.user = { ...u, role: 'owner', apps: '*' };
    const name = await inboxPost(thread.id, { action: 'groupInfo', name: 'Proveedores 2027' });
    expect(name.status).toBe(200);
    expect(name.data.title).toBe('Proveedores 2027');
    const desc = await inboxPost(thread.id, { action: 'groupInfo', description: 'Pedidos de los martes' });
    expect(desc.data).toMatchObject({ title: 'Proveedores 2027', about: 'Pedidos de los martes' });

    const g = fake(`inbox-${accountId}`)!.groups.get(thread.external_id)!;
    expect(g.name).toBe('Proveedores 2027');
    expect(g.description).toBe('Pedidos de los martes');
    const r = await row(thread.id);
    expect(r.title).toBe('Proveedores 2027');
    expect(parseThreadInfo(r.info).about).toBe('Pedidos de los martes');

    const events = (await getDb().prepare("SELECT meta FROM inbox_messages WHERE thread_id = ? AND media_type = 'system'").all(thread.id)) as Array<{ meta: string }>;
    const kinds = events.map((e) => (JSON.parse(e.meta) as { sys: { t: string; by?: { p: string } } }).sys);
    expect(kinds).toEqual(expect.arrayContaining([expect.objectContaining({ t: 'subject', by: { p: 'me' } }), expect.objectContaining({ t: 'description' })]));

    // Lo mismo otra vez no va a WhatsApp ni suma avisos.
    g.name = 'sin tocar';
    await inboxPost(thread.id, { action: 'groupInfo', name: 'Proveedores 2027' });
    expect(g.name).toBe('sin tocar');
    const after = (await getDb().prepare("SELECT COUNT(*) AS n FROM inbox_messages WHERE thread_id = ? AND media_type = 'system'").get(thread.id)) as { n: number };
    expect(Number(after.n)).toBe(events.length);
  });

  it('nombre vacío: 400 invalid_name, sin tocar nada', async () => {
    const { u, thread } = await inboxGroup('ige2');
    session.user = { ...u, role: 'owner', apps: '*' };
    const res = await inboxPost(thread.id, { action: 'groupInfo', name: '  ' });
    expect(res.status).toBe(400);
    expect(res.data.error).toBe('invalid_name');
    expect((await row(thread.id)).title).toBe('Grupo ige2');
  });

  it('el grupo de otra persona no se puede cambiar', async () => {
    const { thread } = await inboxGroup('ige3');
    const other = await makeUser('ige3-other');
    session.user = { ...other, role: 'owner', apps: '*' };
    const res = await inboxPost(thread.id, { action: 'groupInfo', name: 'Otro' });
    expect(res.status).toBe(404);
    expect((await row(thread.id)).title).toBe('Grupo ige3');
  });
});

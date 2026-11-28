/**
 * Volver a entrar a un grupo con el link: la respuesta trae los datos del chat
 * (etiquetas, notas, vínculos) solo a quien ve ese chat. Con acceso por
 * etiqueta, un miembro sin la etiqueta del grupo hace entrar a la línea pero no
 * recibe nada del chat. Miradas: anónimo, otro workspace, miembro sin la
 * etiqueta, miembro con la etiqueta y owner. Datos inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@/lib/session';
import { connectNumber, createLabel, createNumber, getNumberRowById, updateChat } from '@/lib/groups';
import { joinGroup, leaveGroup } from '@/lib/groups-org';
import { setLabelAccess, updatePlatformSettings } from '@/lib/groups-access';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const { POST } = await import('@/app/api/groups/join/route');

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});

const LABEL = 'zz-private-label';
const CODE = 'JoinPriv8x1';

async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  const n = await createNumber(ws, ws, { provider: 'fake', visibility: 'all' });
  await connectNumber(ws, n.id);
  const fake = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (fake) fake.connectedAt = Date.now() - 5000;
  // El grupo ya estuvo en la línea: tiene su etiqueta, y la línea lo dejó.
  const chat = await joinGroup(ws, n.id, CODE);
  const vip = await createLabel(ws, { name: LABEL });
  await updateChat(ws, chat.id, { labelIds: [vip.id] });
  await leaveGroup(ws, chat.id);
  await updatePlatformSettings(ws, { labelAccess: true, maskRoles: [] });
  return { w, ws, numberId: n.id, chatId: chat.id, labelId: vip.id, row: (await getNumberRowById(n.id))! };
}

async function join(user: SessionUser | null, numberId: string): Promise<{ status: number; text: string }> {
  session.user = user;
  const res = await POST(new Request('http://localhost/api/groups/join', { method: 'POST', body: JSON.stringify({ numberId, invite: CODE }), headers: { 'content-type': 'application/json' } }));
  return { status: res.status, text: await res.text() };
}

describe('entrar de nuevo a un grupo: los datos del chat solo para quien lo ve', () => {
  it('anónimo y otro workspace: nada', async () => {
    const s = await setup('join8-out');
    expect((await join(null, s.numberId)).status).toBe(401);
    const other = await join(asOwner(s.w.stranger), s.numberId);
    expect(other.status).toBe(404);
    expect(other.text).not.toContain(s.chatId);
  });

  it('miembro sin la etiqueta: la línea entra, la respuesta no trae el chat', async () => {
    const s = await setup('join8-nolabel');
    const res = await join(asMember(s.w.owner, s.w.member), s.numberId);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.text)).toMatchObject({ error: 'join_no_access' });
    expect(res.text).not.toContain(s.chatId);
    expect(res.text).not.toContain(LABEL);
    expect(res.text).not.toContain(s.labelId);
    expect(res.text).not.toContain('Invited');
  });

  it('miembro con la etiqueta y owner: el chat completo', async () => {
    const s = await setup('join8-label');
    await setLabelAccess(s.ws, s.labelId, [s.w.member.id]);
    const member = await join(asMember(s.w.owner, s.w.member), s.numberId);
    expect(member.status).toBe(201);
    expect(JSON.parse(member.text)).toMatchObject({ id: s.chatId });
    await leaveGroup(s.ws, s.chatId);
    const owner = await join(asOwner(s.w.owner), s.numberId);
    expect(owner.status).toBe(201);
    expect(JSON.parse(owner.text)).toMatchObject({ id: s.chatId });
  });
});

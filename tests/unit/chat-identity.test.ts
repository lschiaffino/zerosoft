import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import {
  createChatConversation,
  createChatWidget,
  getChatConversationWithVisitor,
  getChatVisitor,
  getOrCreateChatVisitor,
  updateChatVisitor,
} from '@/lib/chat-data';
import {
  rotateWidgetIdentitySecret,
  signVisitorIdentity,
  verifyVisitorIdentity,
  visitorIdentityHash,
} from '@/lib/chat-identity';
import { createContact, listTimeline } from '@/lib/crm';
import { logChatToCrm } from '@/lib/crm-integrations';
import { makeUser } from './helpers';

type FakeUser = { id: string; email: string; role?: string; team?: null };
const session = vi.hoisted(() => ({ user: null as null | FakeUser }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: FakeUser) => u.id,
  isWorkspaceAdmin: (u: FakeUser) => u.role === 'owner' || u.role === 'admin',
}));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: () => undefined,
}));

const visitorMessages = await import('@/app/api/chat/messages/route');
const crmRoute = await import('@/app/api/chat/conversations/[id]/crm/route');
const identityRoute = await import('@/app/api/chat/widgets/[id]/identity/route');

let ipN = 0;
function jsonReq(url: string, method: string, body?: unknown) {
  ipN += 1;
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.77.${ipN >> 8}.${ipN & 255}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function setup(label: string) {
  const owner = await makeUser(label);
  const widget = await createChatWidget(owner.id, null, { name: `${label} widget` });
  return { owner, widget };
}

beforeEach(() => {
  session.user = null;
});

describe('Chat: identidad del visitante', () => {
  it('una identidad declarada no pisa una verificada; una firmada sí la reemplaza', async () => {
    const { widget } = await setup('cid-a');
    const ext = `ext-${crypto.randomUUID()}`;
    const v = await getOrCreateChatVisitor(widget.id, ext, { email: 'ana@acme.com', name: 'Ana', verified: true });
    expect(v.email_verified).toBe(1);

    const after = await getOrCreateChatVisitor(widget.id, ext, { email: 'ceo@bigco.com', name: 'Ceo' });
    expect([after.email, after.name, after.email_verified]).toEqual(['ana@acme.com', 'Ana', 1]);

    const switched = await getOrCreateChatVisitor(widget.id, ext, { email: 'bo@acme.com', name: 'Bo', verified: true });
    expect([switched.email, switched.name, switched.email_verified]).toEqual(['bo@acme.com', 'Bo', 1]);

    // Sin verificar: se completa y se actualiza, pero sigue sin verificar.
    const ext2 = `ext-${crypto.randomUUID()}`;
    const u1 = await getOrCreateChatVisitor(widget.id, ext2, { email: 'x@y.com' });
    expect(u1.email_verified).toBe(0);
    const u2 = await getOrCreateChatVisitor(widget.id, ext2, { email: 'z@y.com' });
    expect([u2.email, u2.email_verified]).toEqual(['z@y.com', 0]);
  });

  it('un email que carga el equipo queda verificado; cambiarlo sin confirmar lo desverifica', async () => {
    const { widget } = await setup('cid-b');
    const v = await getOrCreateChatVisitor(widget.id, `ext-${crypto.randomUUID()}`, { email: 'x@y.com' });
    const byTeam = await updateChatVisitor(v.id, { email: 'Real@Y.com', emailVerified: true });
    expect([byTeam?.email, byTeam?.email_verified]).toEqual(['real@y.com', 1]);
    // Guardar el mismo email (p. ej. al editar otra cosa) no cambia el estado.
    expect((await updateChatVisitor(v.id, { email: 'real@y.com' }))?.email_verified).toBe(1);
    expect((await updateChatVisitor(v.id, { email: 'other@y.com' }))?.email_verified).toBe(0);
  });

  it('el widget verifica el email solo con un userHash válido del secreto del widget', async () => {
    const { widget } = await setup('cid-c');
    const other = await setup('cid-c2');
    const secret = await rotateWidgetIdentitySecret(widget.id);
    const otherSecret = await rotateWidgetIdentitySecret(other.widget.id);
    expect(await verifyVisitorIdentity(widget.id, 'ana@acme.com', visitorIdentityHash(secret, 'ANA@acme.com'))).toBe(true);
    expect(await verifyVisitorIdentity(widget.id, 'ana@acme.com', visitorIdentityHash(otherSecret, 'ana@acme.com'))).toBe(false);
    expect(await verifyVisitorIdentity(widget.id, 'bo@acme.com', visitorIdentityHash(secret, 'ana@acme.com'))).toBe(false);
    expect(await verifyVisitorIdentity(widget.id, 'ana@acme.com', 'nope')).toBe(false);

    const post = (body: Record<string, unknown>) =>
      visitorMessages.POST(jsonReq('http://t/api/chat/messages', 'POST', { widgetId: widget.id, ...body }));
    const ext = `ext-${crypto.randomUUID()}`;
    // Firma falsa: el email se guarda, pero sin verificar.
    expect((await post({ visitorId: ext, body: 'hi', email: 'ana@acme.com', userHash: 'a'.repeat(64) })).status).toBe(201);
    const row = () =>
      getDb().prepare('SELECT email, email_verified FROM chat_visitors WHERE widget_id = ? AND external_id = ?').get(widget.id, ext) as Promise<{
        email: string;
        email_verified: number;
      }>;
    expect(await row()).toMatchObject({ email: 'ana@acme.com', email_verified: 0 });
    // Firma válida: queda verificado.
    const hash = visitorIdentityHash(secret, 'ana@acme.com');
    expect((await post({ visitorId: ext, body: 'hi', email: 'ana@acme.com', userHash: hash })).status).toBe(201);
    expect(await row()).toMatchObject({ email: 'ana@acme.com', email_verified: 1 });
    // Otro email sin firma (o con la firma de otro email) no pisa la identidad verificada.
    expect((await post({ visitorId: ext, body: 'hi', email: 'ceo@bigco.com', name: 'Ceo' })).status).toBe(201);
    expect((await post({ visitorId: ext, body: 'hi', email: 'ceo@bigco.com', userHash: hash })).status).toBe(201);
    expect(await row()).toMatchObject({ email: 'ana@acme.com', email_verified: 1 });
  });

  it('widget de soporte: la firma se hace en el server y el widget la acepta como verificada', async () => {
    const { widget } = await setup('cid-sup');
    // Sin secreto no hay firma (el widget sigue andando con identidad declarada).
    expect(await signVisitorIdentity(widget.id, 'ana@acme.com')).toBeNull();
    const secret = await rotateWidgetIdentitySecret(widget.id);
    expect(await signVisitorIdentity(widget.id, null)).toBeNull();
    expect(await signVisitorIdentity(widget.id, '  ')).toBeNull();
    const hash = (await signVisitorIdentity(widget.id, ' Ana@Acme.com '))!;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(secret.slice(5));
    expect(await verifyVisitorIdentity(widget.id, 'ana@acme.com', hash)).toBe(true);
    const ext = `sup-${crypto.randomUUID()}`;
    const res = await visitorMessages.POST(
      jsonReq('http://t/api/chat/messages', 'POST', { widgetId: widget.id, visitorId: ext, body: 'hola', email: 'ana@acme.com', userHash: hash }),
    );
    expect(res.status).toBe(201);
    const row = (await getDb()
      .prepare('SELECT email_verified FROM chat_visitors WHERE widget_id = ? AND external_id = ?')
      .get(widget.id, ext)) as { email_verified: number };
    expect(row.email_verified).toBe(1);
  });

  it('CRM: un email sin verificar no se asocia solo a un contacto existente; con confirmación del agente, sí', async () => {
    const { owner, widget } = await setup('cid-d');
    const ceo = await createContact(owner.id, { email: 'ceo@bigco.com', firstName: 'Ceo' });
    const visitor = await getOrCreateChatVisitor(widget.id, `ext-${crypto.randomUUID()}`, { email: 'ceo@bigco.com' });
    const conv = await createChatConversation(widget.id, visitor.id);

    // El inbox no lo muestra como ese contacto.
    expect((await getChatConversationWithVisitor(conv.id))?.crm_contact).toBeNull();
    expect((await getChatConversationWithVisitor(conv.id))?.visitor.email_verified).toBe(0);

    session.user = { id: owner.id, email: owner.email, role: 'owner', team: null };
    const res = await crmRoute.POST(jsonReq(`http://t/api/chat/conversations/${conv.id}/crm`, 'POST'), ctx(conv.id));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'unverified_email' });
    expect(await listTimeline(owner.id, { contactId: ceo.id })).toHaveLength(0);

    const ok = await crmRoute.POST(
      jsonReq(`http://t/api/chat/conversations/${conv.id}/crm`, 'POST', { confirm: true }),
      ctx(conv.id),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ contactId: ceo.id, created: false });
    expect(await listTimeline(owner.id, { contactId: ceo.id })).toHaveLength(1);
    // Ya guardada ahí: el inbox la muestra con ese contacto y volver a guardar no pide confirmar.
    expect((await getChatConversationWithVisitor(conv.id))?.crm_contact?.id).toBe(ceo.id);
    expect((await crmRoute.POST(jsonReq(`http://t/api/chat/conversations/${conv.id}/crm`, 'POST'), ctx(conv.id))).status).toBe(200);

    // Un email nuevo (sin contacto) se puede crear sin confirmar.
    const fresh = await getOrCreateChatVisitor(widget.id, `ext-${crypto.randomUUID()}`, { email: 'new@lead.com' });
    const freshConv = await createChatConversation(widget.id, fresh.id);
    const created = await logChatToCrm(owner.id, {
      conversationId: freshConv.id,
      subject: null,
      visitor: fresh,
      messages: [],
    });
    expect('contact' in created && created.created).toBe(true);

    // Verificado: se asocia directo.
    const verified = await getOrCreateChatVisitor(widget.id, `ext-${crypto.randomUUID()}`, {
      email: 'ceo@bigco.com',
      verified: true,
    });
    const vConv = await createChatConversation(widget.id, verified.id);
    expect((await getChatConversationWithVisitor(vConv.id))?.crm_contact?.id).toBe(ceo.id);
    const logged = await logChatToCrm(owner.id, {
      conversationId: vConv.id,
      subject: null,
      visitor: (await getChatVisitor(verified.id))!,
      messages: [],
    });
    expect('contact' in logged && logged.contact.id).toBe(ceo.id);
  });

  it('el secreto del widget solo lo generan owner/admin', async () => {
    const { owner, widget } = await setup('cid-e');
    session.user = { id: owner.id, email: owner.email, role: 'member', team: null };
    expect((await identityRoute.POST(jsonReq('http://t', 'POST'), ctx(widget.id))).status).toBe(403);
    session.user = { id: owner.id, email: owner.email, role: 'owner', team: null };
    const res = await identityRoute.POST(jsonReq('http://t', 'POST'), ctx(widget.id));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { secret: string }).secret).toMatch(/^zsid_[0-9a-f]{64}$/);
    expect((await identityRoute.DELETE(jsonReq('http://t', 'DELETE'), ctx(widget.id))).status).toBe(200);
    expect(await verifyVisitorIdentity(widget.id, 'a@b.com', 'a'.repeat(64))).toBe(false);
  });
});

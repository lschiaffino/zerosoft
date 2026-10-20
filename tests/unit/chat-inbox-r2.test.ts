import { describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
}));
// after() corre la tarea en el momento (fuera de un request de Next).
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => {
    void task().catch(() => {});
  },
}));
const sentEmails = vi.hoisted(() => [] as Array<{ to: string; subject: string; text: string; html?: string }>);
const emailFails = vi.hoisted(() => ({ value: false }));
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<typeof import('@/lib/email')>()),
  sendEmail: async (opts: { to: string; subject: string; text: string; html?: string }) => {
    if (emailFails.value) return { ok: false, error: 'down' };
    sentEmails.push(opts);
    return { ok: true, provider: 'test' };
  },
}));

import { getDb } from '@/lib/db';
import {
  applyAssignmentRules,
  createAssignmentRule,
  createChatConversation,
  createChatMessage,
  createChatWidget,
  deleteChatMessage,
  editChatMessage,
  getChatConversation,
  getChatVisitor,
  getOrCreateChatVisitor,
  getVisitorConversationWithMessages,
  listChatAgents,
  listChatConversations,
  listChatMessagesWithUsers,
  markMessagesRead,
  setChatAgentAway,
  toPublicMessage,
  updateChatWidget,
} from '@/lib/chat-data';
import { listConversationTags, parseBulkRequest } from '@/lib/chat-inbox';
import {
  describeUserAgent,
  mergeVisitorMetadata,
  readVisitorForm,
  readVisitorPage,
  visitorPageContext,
} from '@/lib/chat-visitor-context';
import {
  buildOfflineReplyEmail,
  chatReturnLink,
  dueOfflineGroups,
  sendOfflineReplyEmails,
  type OfflineReplyCandidate,
} from '@/lib/chat-offline-email';
import { POST as visitorPost } from '@/app/api/chat/messages/route';
import { GET as widgetScript } from '@/app/api/chat/widget.js/route';
import { POST as bulkPost } from '@/app/api/chat/conversations/bulk/route';
import { DELETE as messageDelete, PATCH as messagePatch } from '@/app/api/chat/conversations/[id]/messages/[messageId]/route';
import { addMember, createTeam } from '@/lib/teams';
import { makeUser } from './helpers';

async function setup(label: string, email: string | null = null) {
  const owner = await makeUser(label);
  const widget = await createChatWidget(owner.id, null, { name: `${label} widget` });
  const externalId = `ext-${crypto.randomUUID()}`;
  const visitor = await getOrCreateChatVisitor(widget.id, externalId, { email, name: email ? 'Ana' : null });
  const conversation = await createChatConversation(widget.id, visitor.id);
  return { owner, widget, visitor, externalId, conversation };
}

async function backdate(messageId: string, minutesAgo: number, now = Date.now()) {
  await getDb()
    .prepare('UPDATE chat_messages SET created_at = ? WHERE id = ?')
    .run(new Date(now - minutesAgo * 60_000).toISOString(), messageId);
}

const ctx = (params: { id: string; messageId: string }) => ({ params: Promise.resolve(params) });

describe('Chat: respuestas sin leer por email', () => {
  it('manda una vez las respuestas sin leer pasados los minutos del widget, juntas', async () => {
    const { owner, widget, conversation } = await setup('offline1', 'ana@example.com');
    await getDb()
      .prepare('UPDATE chat_visitors SET metadata = ? WHERE id = ?')
      .run(JSON.stringify({ page: { url: 'https://acme.test/precios', language: 'es-AR', seenAt: '' } }), conversation.visitor_id);
    const a = await createChatMessage(conversation.id, 'user', { body: 'Hola Ana', userId: owner.id });
    const b = await createChatMessage(conversation.id, 'user', { body: 'Te paso el precio', userId: owner.id });
    await createChatMessage(conversation.id, 'user', { body: 'nota interna', userId: owner.id, isNote: true });
    const now = Date.now();
    await backdate(a.id, 30, now);
    await backdate(b.id, 12, now);

    sentEmails.length = 0;
    const first = await sendOfflineReplyEmails({ now: new Date(now) });
    const mine = sentEmails.filter((e) => e.to === 'ana@example.com');
    expect(first.sent).toBeGreaterThanOrEqual(1);
    expect(mine).toHaveLength(1);
    expect(mine[0].text).toContain('Hola Ana');
    expect(mine[0].text).toContain('Te paso el precio');
    expect(mine[0].text).not.toContain('nota interna');
    // Idioma del visitante y link de vuelta que abre el widget.
    expect(mine[0].subject).toContain(widget.name);
    expect(mine[0].text).toContain('Seguir en el chat: https://acme.test/precios#zs-chat');

    // El claim evita el segundo envío.
    sentEmails.length = 0;
    await sendOfflineReplyEmails({ now: new Date(now + 60_000) });
    expect(sentEmails.filter((e) => e.to === 'ana@example.com')).toHaveLength(0);
  });

  it('espera desde la respuesta más nueva y no manda lo leído, lo borrado ni con el aviso apagado', async () => {
    const now = Date.now();
    const fresh = await setup('offline2', 'beto@example.com');
    const m1 = await createChatMessage(fresh.conversation.id, 'user', { body: 'uno', userId: fresh.owner.id });
    await backdate(m1.id, 3, now);
    const read = await setup('offline3', 'carla@example.com');
    const m2 = await createChatMessage(read.conversation.id, 'user', { body: 'dos', userId: read.owner.id });
    await backdate(m2.id, 30, now);
    await markMessagesRead(read.conversation.id, 'visitor');
    const off = await setup('offline4', 'dani@example.com');
    await updateChatWidget(off.widget.id, { offlineEmailMinutes: 0 });
    const m3 = await createChatMessage(off.conversation.id, 'user', { body: 'tres', userId: off.owner.id });
    await backdate(m3.id, 30, now);
    const gone = await setup('offline5', 'eva@example.com');
    const m4 = await createChatMessage(gone.conversation.id, 'user', { body: 'cuatro', userId: gone.owner.id });
    await backdate(m4.id, 30, now);
    await deleteChatMessage(gone.conversation.id, m4.id, gone.owner.id);

    sentEmails.length = 0;
    await sendOfflineReplyEmails({ now: new Date(now) });
    const to = sentEmails.map((e) => e.to);
    for (const email of ['beto@example.com', 'carla@example.com', 'dani@example.com', 'eva@example.com']) {
      expect(to).not.toContain(email);
    }
  });

  it('si el envío falla, libera el claim y reintenta en la próxima corrida', async () => {
    const { owner, conversation } = await setup('offline6', 'fede@example.com');
    const m = await createChatMessage(conversation.id, 'user', { body: 'reintento', userId: owner.id });
    const now = Date.now();
    await backdate(m.id, 20, now);
    emailFails.value = true;
    await sendOfflineReplyEmails({ now: new Date(now) });
    emailFails.value = false;
    sentEmails.length = 0;
    await sendOfflineReplyEmails({ now: new Date(now + 60_000) });
    expect(sentEmails.filter((e) => e.to === 'fede@example.com')).toHaveLength(1);
  });

  it('arma el email sin link si no hay página, y agrupa por conversación', () => {
    const base: OfflineReplyCandidate = {
      id: 'm1',
      conversation_id: 'c1',
      body: 'Hola <b>vos</b>',
      attachments: '[{"name":"factura.pdf"}]',
      created_at: '2026-10-20T10:00:00.000Z',
      agent_name: 'Lu',
      visitor_email: 'x@example.com',
      visitor_name: null,
      visitor_metadata: '{}',
      widget_name: 'Acme',
      widget_color: '#ff0000',
      widget_locale: 'en',
      offline_email_minutes: 10,
    };
    const email = buildOfflineReplyEmail({ conversationId: 'c1', messages: [base] });
    expect(email.locale).toBe('en');
    expect(email.subject).toBe('Lu replied to your chat with Acme');
    expect(email.text).toContain('Attachment: factura.pdf');
    expect(email.text).toContain('open the chat on the site where you wrote to us');
    expect(email.html).toContain('Hola &lt;b&gt;vos&lt;/b&gt;');
    expect(chatReturnLink('javascript:alert(1)')).toBeNull();
    expect(chatReturnLink('https://acme.test/a?b=1#x')).toBe('https://acme.test/a?b=1#zs-chat');

    const later = { ...base, id: 'm2', created_at: '2026-10-20T10:08:00.000Z' };
    expect(dueOfflineGroups([base, later], new Date('2026-10-20T10:15:00.000Z'))).toHaveLength(0);
    const due = dueOfflineGroups([later, base], new Date('2026-10-20T10:19:00.000Z'));
    expect(due).toHaveLength(1);
    expect(due[0].messages.map((m) => m.id)).toEqual(['m1', 'm2']);
  });
});

describe('Chat: agente ausente', () => {
  it('el round-robin saltea a los ausentes y reasignar reparte sus conversaciones', async () => {
    const owner = await makeUser('away-owner');
    const member = await makeUser('away-member');
    const team = await createTeam(owner.id, 'Guardia');
    await addMember(team.id, member.id, 'member');
    const widget = await createChatWidget(owner.id, team.id, { name: 'away widget' });
    await createAssignmentRule(widget.id, { name: 'rr', matchType: 'round_robin' });

    await setChatAgentAway(member.id, true);
    const agents = await listChatAgents(widget.user_id, widget.team_id);
    expect(agents.find((a) => a.id === member.id)?.away).toBe(true);

    const assigned: Array<string | null> = [];
    for (let i = 0; i < 3; i++) {
      const v = await getOrCreateChatVisitor(widget.id, `away-${i}-${crypto.randomUUID()}`);
      const c = await createChatConversation(widget.id, v.id);
      assigned.push(await applyAssignmentRules(widget.id, c.id, 'hola', agents));
    }
    expect(assigned).toEqual([owner.id, owner.id, owner.id]);

    // El dueño se va y reasigna: pasan al miembro (que ya volvió).
    await setChatAgentAway(member.id, false);
    const result = await setChatAgentAway(owner.id, true, { reassign: true, widgets: [widget] });
    expect(result.reassigned).toBe(3);
    const rows = await listChatConversations([widget.id]);
    expect(rows.every((r) => r.assigned_to === member.id)).toBe(true);

    // Sin nadie disponible, quedan sin asignar.
    await setChatAgentAway(owner.id, false);
    await setChatAgentAway(owner.id, true);
    const again = await setChatAgentAway(member.id, true, { reassign: true, widgets: [widget] });
    expect(again.reassigned).toBe(3);
    expect((await listChatConversations([widget.id])).every((r) => r.assigned_to === null)).toBe(true);
  });
});

describe('Chat: acciones en lote', () => {
  it('valida el pedido', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    expect(parseBulkRequest({ ids: [], action: { type: 'resolve' } }, now)).toBeNull();
    expect(parseBulkRequest({ ids: ['a'], action: { type: 'delete' } }, now)).toBeNull();
    expect(parseBulkRequest({ ids: ['a'], action: { type: 'snooze', until: '2026-10-19T00:00:00Z' } }, now)).toBeNull();
    expect(parseBulkRequest({ ids: ['a', 'a'], action: { type: 'tag', tag: ' #VIP cliente ' } }, now)).toEqual({
      ids: ['a'],
      action: { type: 'tag', tag: 'vip-cliente' },
    });
    expect(parseBulkRequest({ ids: Array.from({ length: 101 }, (_, i) => `c${i}`), action: { type: 'resolve' } }, now)).toBeNull();
  });

  it('asigna, taguea, pospone y resuelve solo las conversaciones del workspace', async () => {
    const a = await setup('bulk-a');
    const other = await setup('bulk-b');
    const v2 = await getOrCreateChatVisitor(a.widget.id, `ext-${crypto.randomUUID()}`);
    const c2 = await createChatConversation(a.widget.id, v2.id);
    session.user = { id: a.owner.id, email: a.owner.email, name: a.owner.name, team: null };
    const call = async (action: unknown) => {
      const res = await bulkPost(
        new Request('http://localhost/api/chat/conversations/bulk', {
          method: 'POST',
          body: JSON.stringify({ ids: [a.conversation.id, c2.id, other.conversation.id], action }),
        }),
      );
      return (await res.json()) as { updated: number; skipped: number };
    };

    expect(await call({ type: 'assign', assignedTo: a.owner.id })).toEqual({ updated: 2, skipped: 1 });
    expect((await getChatConversation(c2.id))?.assigned_to).toBe(a.owner.id);
    // Alguien que no es agente del widget: se saltea.
    expect(await call({ type: 'assign', assignedTo: other.owner.id })).toEqual({ updated: 0, skipped: 3 });
    expect(await call({ type: 'tag', tag: 'facturación' })).toEqual({ updated: 2, skipped: 1 });
    expect(await listConversationTags(a.conversation.id)).toEqual(['facturación']);
    expect(await listConversationTags(other.conversation.id)).toEqual([]);
    const until = new Date(Date.now() + 3_600_000).toISOString();
    expect(await call({ type: 'snooze', until })).toEqual({ updated: 2, skipped: 1 });
    expect((await getChatConversation(c2.id))?.status).toBe('snoozed');
    expect(await call({ type: 'resolve' })).toEqual({ updated: 2, skipped: 1 });
    expect((await getChatConversation(a.conversation.id))?.status).toBe('resolved');
    expect((await getChatConversation(other.conversation.id))?.status).toBe('open');
    session.user = null;
  });
});

describe('Chat: contexto del visitante', () => {
  it('limpia la página, el idioma y describe el navegador', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    expect(describeUserAgent(ua)).toBe('Chrome 120 · macOS');
    expect(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1')).toBe(
      'Safari 17 · iOS',
    );
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36 Edg/120.0')).toBe('Edge 120 · Windows');
    expect(describeUserAgent('curl/8')).toBeNull();

    const page = visitorPageContext(
      { url: 'javascript:alert(1)', referrer: 'https://google.com/', language: 'es-AR', title: 'Precios\n' },
      null,
      new Date('2026-10-20T00:00:00Z'),
    );
    expect(page).toMatchObject({ url: null, referrer: 'https://google.com/', language: 'es-AR', title: 'Precios' });
    expect(visitorPageContext({ language: '<script>' }, null)).toBeNull();

    // El referrer de la llegada se conserva al navegar; la misma página no se reescribe.
    const first = mergeVisitorMetadata('{"form":{"Empresa":"Acme"}}', { page: { ...page!, url: 'https://acme.test/' } });
    expect(readVisitorForm(JSON.stringify(first))).toEqual([{ label: 'Empresa', value: 'Acme' }]);
    const second = mergeVisitorMetadata(JSON.stringify(first), {
      page: { ...page!, url: 'https://acme.test/b', referrer: null },
    });
    expect(readVisitorPage(JSON.stringify(second))).toMatchObject({ url: 'https://acme.test/b', referrer: 'https://google.com/' });
    expect(mergeVisitorMetadata(JSON.stringify(second), { page: { ...page!, url: 'https://acme.test/b', referrer: null } })).toBeNull();
  });

  it('el script del widget manda el contexto, re-dibuja ediciones y abre con #zs-chat', async () => {
    const owner = await makeUser('ctx-js');
    const widget = await createChatWidget(owner.id, null, { name: 'ctx js' });
    const res = await widgetScript(new Request(`http://localhost/api/chat/widget.js?id=${widget.id}`));
    const js = await res.text();
    expect(() => new Function(js)).not.toThrow();
    expect(js).toContain('payload.context = pageContext()');
    expect(js).toContain("formData.append('context'");
    expect(js).toContain('threadChanged(data.messages)');
    expect(js).toContain("location.hash === '#zs-chat'");
  });

  it('el widget guarda la página y el formulario desde el POST del visitante', async () => {
    const owner = await makeUser('ctx');
    const widget = await createChatWidget(owner.id, null, {
      name: 'ctx widget',
      fields: [{ id: 'f1', name: 'Empresa', required: false, type: 'text' }],
    });
    const externalId = `ext-${crypto.randomUUID()}`;
    const res = await visitorPost(
      new Request('http://localhost/api/chat/messages', {
        method: 'POST',
        headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0' },
        body: JSON.stringify({
          widgetId: widget.id,
          visitorId: externalId,
          body: 'Hola',
          fields: { f1: 'Acme' },
          context: { url: 'https://acme.test/precios', title: 'Precios', referrer: 'https://google.com/', language: 'pt-BR' },
        }),
      }),
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as { visitor: { id: string } };
    const visitor = await getChatVisitor(data.visitor.id);
    expect(readVisitorPage(visitor?.metadata)).toMatchObject({
      url: 'https://acme.test/precios',
      title: 'Precios',
      browser: 'Firefox 121 · Linux',
      language: 'pt-BR',
    });
    expect(readVisitorForm(visitor?.metadata)).toEqual([{ label: 'Empresa', value: 'Acme' }]);
  });
});

describe('Chat: editar y borrar mensajes y notas', () => {
  it('solo el autor edita o borra; el visitante no ve lo borrado y ve la marca de editado', async () => {
    const { owner, widget, externalId, conversation } = await setup('edit');
    const intruder = await makeUser('edit-intruder');
    const visitorMsg = await createChatMessage(conversation.id, 'visitor', { body: 'Hola' });
    const reply = await createChatMessage(conversation.id, 'user', { body: 'Precio: 10', userId: owner.id });
    const note = await createChatMessage(conversation.id, 'user', { body: 'ojo', userId: owner.id, isNote: true });

    expect((await editChatMessage(conversation.id, reply.id, intruder.id, 'x')).error).toBe('forbidden');
    expect((await editChatMessage(conversation.id, visitorMsg.id, owner.id, 'x')).error).toBe('forbidden');
    expect((await editChatMessage(conversation.id, reply.id, owner.id, '   ')).error).toBe('invalid_input');
    const edited = await editChatMessage(conversation.id, reply.id, owner.id, 'Precio: 12');
    expect(edited.message?.body).toBe('Precio: 12');
    expect(edited.message?.edited_at).toBeTruthy();
    expect(toPublicMessage(edited.message!).edited_at).toBe(edited.message?.edited_at);

    const deleted = await deleteChatMessage(conversation.id, note.id, owner.id);
    expect(deleted.message?.deleted_at).toBeTruthy();
    expect(deleted.message?.body).toBe('');
    expect((await editChatMessage(conversation.id, note.id, owner.id, 'vuelve')).error).toBe('deleted');

    await deleteChatMessage(conversation.id, reply.id, owner.id);
    const forVisitor = await getVisitorConversationWithMessages(widget.id, externalId);
    expect(forVisitor?.messages.map((m) => m.body)).toEqual(['Hola']);
    // El inbox sigue mostrando la marca; la vista previa salta lo borrado.
    expect((await listChatMessagesWithUsers(conversation.id)).filter((m) => m.deleted_at)).toHaveLength(2);
    const [row] = await listChatConversations([widget.id]);
    expect(row.last_message_body).toBe('Hola');
  });

  it('las rutas validan acceso y autoría', async () => {
    const { owner, conversation } = await setup('edit-route');
    const reply = await createChatMessage(conversation.id, 'user', { body: 'uno', userId: owner.id });
    const other = await makeUser('edit-route-other');
    const params = ctx({ id: conversation.id, messageId: reply.id });

    session.user = { id: other.id, email: other.email, name: other.name, team: null };
    const blocked = await messagePatch(
      new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ body: 'hack' }) }),
      params,
    );
    expect(blocked.status).toBe(404);

    session.user = { id: owner.id, email: owner.email, name: owner.name, team: null };
    const ok = await messagePatch(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ body: 'dos' }) }), params);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { body: string }).body).toBe('dos');
    const del = await messageDelete(new Request('http://localhost', { method: 'DELETE' }), params);
    expect(del.status).toBe(200);
    const again = await messageDelete(new Request('http://localhost', { method: 'DELETE' }), params);
    expect(again.status).toBe(409);
    session.user = null;
  });
});

describe('cleanHttpUrl', () => {
  it('guarda solo los utm_* del query y descarta hash y credenciales', async () => {
    const { cleanHttpUrl } = await import('@/lib/chat-visitor-context');
    expect(cleanHttpUrl('https://u:p@acme.test/precios?token=abc&utm_source=ads&ref=x#zs-chat')).toBe('https://acme.test/precios?utm_source=ads');
    expect(cleanHttpUrl('javascript:alert(1)')).toBeNull();
  });
});

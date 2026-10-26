import { describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
}));
const sentEmails = vi.hoisted(() => [] as Array<{ to: string; subject: string; text: string; html?: string }>);
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<typeof import('@/lib/email')>()),
  sendEmail: async (opts: { to: string; subject: string; text: string; html?: string }) => {
    sentEmails.push(opts);
    return { ok: true, provider: 'test' };
  },
}));

import { getDb } from '@/lib/db';
import {
  createCannedResponse,
  createChatConversation,
  createChatMessage,
  createChatWidget,
  deleteChatMessage,
  getChatConversation,
  getChatConversationWithVisitor,
  getOrCreateChatVisitor,
  listChatMessagesWithUsers,
  updateChatWidget,
} from '@/lib/chat-data';
import {
  applyAttributePatch,
  missingRequiredAttributes,
  parseAttributeDefs,
  parseAttributeValues,
  type ChatAttributeDef,
} from '@/lib/chat-attributes';
import { addConversationTag, applyCannedMacro, listConversationTags, setCannedActions } from '@/lib/chat-inbox';
import { transcriptEntries, transcriptFilename, transcriptStrings, transcriptText } from '@/lib/chat-transcript';
import { isSameVisitor, listMergeCandidates, mergeChatConversations, mergedStatus } from '@/lib/chat-merge';
import { parseMergeNote } from '@/lib/chat-merge-note';
import { buildAttributeDefs, buildWidgetPayload, hasSelectWithoutOptions, initialValues, parseAttributeFields } from '@/components/chat/widget-form-model';
import { widgetUpdateSchema } from '@/lib/chat-schema';
import { PATCH as conversationPatch } from '@/lib/routes/chat/conversations/[id]/route';
import { POST as bulkPost } from '@/app/api/chat/conversations/bulk/route';
import { GET as transcriptGet, POST as transcriptPost } from '@/lib/routes/chat/conversations/[id]/transcript/route';
import { GET as mergeGet, POST as mergePost } from '@/lib/routes/chat/conversations/[id]/merge/route';
import { GET as visitorGet } from '@/app/api/chat/messages/route';
import { makeUser } from './helpers';

const DEFS: ChatAttributeDef[] = [
  { id: 'reason', name: 'Reason', type: 'select', required: true, options: ['Billing', 'Bug'] },
  { id: 'plan', name: 'Plan', type: 'text', required: false, options: [] },
  { id: 'seats', name: 'Seats', type: 'number', required: false, options: [] },
  { id: 'refund', name: 'Refund', type: 'boolean', required: true, options: [] },
];

async function setup(label: string, email: string | null = null) {
  const owner = await makeUser(label);
  const widget = await createChatWidget(owner.id, null, { name: `${label} widget` });
  const visitor = await getOrCreateChatVisitor(widget.id, `ext-${crypto.randomUUID()}`, { email, name: email ? 'Ana' : null });
  const conversation = await createChatConversation(widget.id, visitor.id);
  session.user = { id: owner.id, email: owner.email, name: owner.name, team: null };
  return { owner, widget, visitor, conversation };
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function patch(id: string, body: unknown) {
  const res = await conversationPatch(
    new Request(`http://localhost/api/chat/conversations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    params(id),
  );
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

describe('Chat: atributos de conversación (puro)', () => {
  it('parsea definiciones y descarta lo inválido', () => {
    const defs = parseAttributeDefs(
      JSON.stringify([
        ...DEFS,
        { id: 'reason', name: 'Duplicado', type: 'text' },
        { id: 'x', name: '  ', type: 'text' },
        { id: 'empty', name: 'Lista vacía', type: 'select', options: [] },
        'basura',
      ]),
    );
    expect(defs.map((d) => d.id)).toEqual(['reason', 'plan', 'seats', 'refund', 'empty']);
    // Un select sin opciones no se puede completar: queda como texto.
    expect(defs.find((d) => d.id === 'empty')?.type).toBe('text');
    expect(parseAttributeDefs('no json')).toEqual([]);
  });

  it('valida valores por tipo, borra con null y marca los obligatorios que faltan', () => {
    const ok = applyAttributePatch(DEFS, { plan: 'Pro', viejo: 'x' }, { reason: 'Bug', seats: '12', refund: false });
    expect(ok).toEqual({ ok: true, values: { plan: 'Pro', reason: 'Bug', seats: 12, refund: false } });
    expect(applyAttributePatch(DEFS, {}, { reason: 'Otro' })).toMatchObject({ ok: false, error: 'invalid_attribute' });
    expect(applyAttributePatch(DEFS, {}, { seats: 'muchos' })).toMatchObject({ ok: false, error: 'invalid_attribute' });
    expect(applyAttributePatch(DEFS, {}, { refund: 'si' })).toMatchObject({ ok: false, error: 'invalid_attribute' });
    expect(applyAttributePatch(DEFS, {}, { nope: 'x' })).toMatchObject({ ok: false, error: 'unknown_attribute' });
    expect(applyAttributePatch(DEFS, { plan: 'Pro' }, { plan: null })).toEqual({ ok: true, values: {} });
    expect(applyAttributePatch(DEFS, {}, { plan: 'x'.repeat(501) })).toMatchObject({ ok: false });

    expect(missingRequiredAttributes(DEFS, {}).map((d) => d.id)).toEqual(['reason', 'refund']);
    // Un boolean obligatorio cuenta respondido con "no".
    expect(missingRequiredAttributes(DEFS, { reason: 'Billing', refund: false })).toEqual([]);
    expect(parseAttributeValues('{"a":1,"b":{"x":1},"c":"t","d":true}')).toEqual({ a: 1, c: 't', d: true });
  });

  it('el editor del widget arma el payload y detecta listas sin opciones', () => {
    const fields = parseAttributeFields(JSON.stringify(DEFS));
    expect(fields[0].optionsText).toBe('Billing\nBug');
    expect(buildAttributeDefs([{ ...fields[0], optionsText: 'A, B\nA\n' }, { ...fields[1], name: ' ' }])).toEqual([
      { id: 'reason', name: 'Reason', type: 'select', required: true, options: ['A', 'B'] },
    ]);
    expect(hasSelectWithoutOptions([{ ...fields[0], optionsText: ' ' }])).toBe(true);
    const payload = buildWidgetPayload(
      initialValues({ name: 'W' } as never),
      [],
      { enabled: false, timezone: 'UTC', days: [] },
      fields,
    );
    expect(widgetUpdateSchema.safeParse(payload).success).toBe(true);
    expect(widgetUpdateSchema.safeParse({ conversationAttributes: [{ id: 'a', name: 'A', type: 'select', options: [] }] }).success).toBe(false);
    // Sin atributos (las otras pestañas viejas): no viajan.
    expect('conversationAttributes' in buildWidgetPayload(initialValues({ name: 'W' } as never), [], { enabled: false, timezone: 'UTC', days: [] })).toBe(false);
  });
});

describe('Chat: atributos obligatorios bloquean resolver', () => {
  it('el PATCH rechaza resolver sin los obligatorios y acepta completarlos y resolver juntos', async () => {
    const { widget, conversation } = await setup('attr1');
    await updateChatWidget(widget.id, { conversationAttributes: DEFS });

    const blocked = await patch(conversation.id, { status: 'resolved' });
    expect(blocked.status).toBe(400);
    expect(blocked.data).toMatchObject({ error: 'missing_attributes', missing: ['Reason', 'Refund'] });
    expect((await getChatConversation(conversation.id))?.status).toBe('open');

    const bad = await patch(conversation.id, { attributes: { reason: 'Nada' } });
    expect(bad.data).toMatchObject({ error: 'invalid_attribute', attributeId: 'reason' });

    const half = await patch(conversation.id, { attributes: { reason: 'Billing' }, status: 'resolved' });
    expect(half.data).toMatchObject({ error: 'missing_attributes', missing: ['Refund'] });
    // El atributo válido quedó guardado aunque resolver falló.
    expect(parseAttributeValues((await getChatConversation(conversation.id))?.attributes)).toEqual({ reason: 'Billing' });

    const done = await patch(conversation.id, { attributes: { refund: true }, status: 'resolved' });
    expect(done.status).toBe(200);
    expect(done.data.status).toBe('resolved');
    expect(JSON.parse(String(done.data.attributes))).toEqual({ reason: 'Billing', refund: true });
    expect(JSON.parse(String(done.data.widget_attributes))).toHaveLength(4);
    session.user = null;
  });

  it('el widget del visitante no recibe los atributos (son internos)', async () => {
    const { widget, visitor, conversation } = await setup('attr4');
    await updateChatWidget(widget.id, { conversationAttributes: DEFS });
    await patch(conversation.id, { attributes: { plan: 'Interno VIP' } });
    const res = await visitorGet(
      new Request(`http://localhost/api/chat/messages?widgetId=${widget.id}&visitorId=${encodeURIComponent(visitor.external_id)}`, {
        headers: { 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.1` },
      }),
    );
    const body = (await res.json()) as { conversation: Record<string, unknown> | null };
    expect(body.conversation?.id).toBe(conversation.id);
    expect(body.conversation && 'attributes' in body.conversation).toBe(false);
    expect(JSON.stringify(body)).not.toContain('Interno VIP');
    session.user = null;
  });

  it('sin atributos definidos se resuelve como siempre', async () => {
    const { conversation } = await setup('attr2');
    expect((await patch(conversation.id, { status: 'resolved' })).status).toBe(200);
    session.user = null;
  });

  it('el lote saltea y cuenta las bloqueadas; la macro aplica el resto sin resolver', async () => {
    const { owner, widget, visitor, conversation } = await setup('attr3');
    await updateChatWidget(widget.id, { conversationAttributes: DEFS });
    const ready = await createChatConversation(widget.id, visitor.id);
    await patch(ready.id, { attributes: { reason: 'Bug', refund: false } });

    const res = await bulkPost(
      new Request('http://localhost/api/chat/conversations/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids: [conversation.id, ready.id], action: { type: 'resolve' } }),
      }),
    );
    expect(await res.json()).toEqual({ updated: 1, skipped: 1, blocked: 1 });
    expect((await getChatConversation(ready.id))?.status).toBe('resolved');
    expect((await getChatConversation(conversation.id))?.status).toBe('open');

    const canned = await createCannedResponse(widget.id, { shortcut: '/fin', title: 'Fin', body: 'Listo' });
    await setCannedActions(canned.id, { status: 'resolved', addTags: ['cerrar'] });
    const fresh = (await getDb().prepare('SELECT * FROM chat_canned_responses WHERE id = ?').get(canned.id)) as typeof canned;
    const result = await applyCannedMacro(conversation.id, fresh, owner.id);
    expect(result?.conversation?.status).toBe('open');
    expect(result?.tags).toEqual(['cerrar']);
    session.user = null;
  });
});

describe('Chat: transcript', () => {
  async function seeded(label: string, email: string | null) {
    const ctx = await setup(label, email);
    const { owner, conversation } = ctx;
    await createChatMessage(conversation.id, 'visitor', { body: 'Hola, mi pedido no llegó' });
    await createChatMessage(conversation.id, 'user', { body: 'Nota: cliente VIP', userId: owner.id, isNote: true });
    await createChatMessage(conversation.id, 'system', { body: 'AI handoff: the bot handed this conversation to a human.' });
    const gone = await createChatMessage(conversation.id, 'user', { body: 'Mensaje equivocado', userId: owner.id });
    await deleteChatMessage(conversation.id, gone.id, owner.id);
    await createChatMessage(conversation.id, 'user', {
      body: 'Ya lo revisamos',
      userId: owner.id,
      attachments: [{ type: 'file', name: 'guia.pdf', url: 'https://x.test/guia.pdf', size: 10, mime: 'application/pdf' }],
    });
    return ctx;
  }

  it('lo del visitante no lleva notas, borrados ni sistema; el del equipo suma notas solo si se piden', async () => {
    const { conversation } = await seeded('tr1', null);
    const messages = await listChatMessagesWithUsers(conversation.id);
    const s = transcriptStrings('es');
    const visitor = transcriptEntries(messages, { audience: 'visitor', visitorName: 'Ana', teamName: 'Soporte', strings: s });
    expect(visitor.map((e) => e.body)).toEqual(['Hola, mi pedido no llegó', 'Ya lo revisamos']);
    expect(visitor[1].attachments).toEqual([{ name: 'guia.pdf', url: 'https://x.test/guia.pdf' }]);
    const team = transcriptEntries(messages, { audience: 'team', visitorName: 'Ana', teamName: 'Soporte', strings: s });
    expect(team.map((e) => e.sender)).toEqual(['visitor', 'system', 'user']);
    const withNotes = transcriptEntries(messages, { audience: 'team', includeNotes: true, visitorName: 'Ana', teamName: 'Soporte', strings: s });
    expect(withNotes.some((e) => e.note && e.body === 'Nota: cliente VIP')).toBe(true);
    expect(withNotes.some((e) => e.body === 'Mensaje equivocado' || e.body === '')).toBe(false);

    const text = transcriptText({ widgetName: 'Soporte', visitorName: 'Ana', startedAt: '2026-10-20T12:00:00.000Z' }, withNotes, 'es');
    expect(text).toContain('Conversación con Soporte');
    expect(text).toContain('(nota interna)');
    expect(text).toContain('Adjunto: guia.pdf');
    expect(transcriptFilename('Soporte Ácme!', '2026-10-20T12:00:00Z', 'txt')).toBe('transcript-soporte-acme-2026-10-20.txt');
  });

  it('descarga en texto y JSON, y manda el email al visitante sin notas', async () => {
    const { conversation } = await seeded('tr2', 'ana@example.com');
    const get = (q: string) => transcriptGet(new Request(`http://localhost/api/chat/conversations/${conversation.id}/transcript${q}`), params(conversation.id));

    const plain = await get('');
    expect(plain.headers.get('content-disposition')).toMatch(/attachment; filename="transcript-tr2-widget-/);
    const body = await plain.text();
    expect(body).toContain('Ya lo revisamos');
    expect(body).not.toContain('cliente VIP');
    expect(body).not.toContain('Mensaje equivocado');

    const json = JSON.parse(await (await get('?format=json&notes=1')).text()) as { messages: Array<{ body: string; note: boolean }> };
    expect(json.messages.find((m) => m.note)?.body).toBe('Nota: cliente VIP');

    sentEmails.length = 0;
    const sent = await transcriptPost(new Request('http://localhost/x', { method: 'POST' }), params(conversation.id));
    expect(await sent.json()).toEqual({ ok: true, to: 'ana@example.com' });
    expect(sentEmails).toHaveLength(1);
    const email = sentEmails[0];
    expect(email.to).toBe('ana@example.com');
    expect(email.text).toContain('Hola, mi pedido no llegó');
    for (const hidden of ['cliente VIP', 'Mensaje equivocado', 'AI handoff']) {
      expect(email.text).not.toContain(hidden);
      expect(email.html).not.toContain(hidden);
    }
    session.user = null;
  });

  it('sin email del visitante no se manda; sin acceso es 404', async () => {
    const { conversation } = await seeded('tr3', null);
    const res = await transcriptPost(new Request('http://localhost/x', { method: 'POST' }), params(conversation.id));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'no_visitor_email' });
    const stranger = await makeUser('tr3-other');
    session.user = { id: stranger.id, email: stranger.email, name: stranger.name, team: null };
    expect((await transcriptGet(new Request('http://localhost/x'), params(conversation.id))).status).toBe(404);
    session.user = null;
  });
});

describe('Chat: unir conversaciones duplicadas', () => {
  it('reglas puras: mismo visitante y estado del hilo unido', () => {
    expect(isSameVisitor({ id: 'a', email: null }, { id: 'a', email: null })).toBe(true);
    expect(isSameVisitor({ id: 'a', email: 'Ana@X.com ' }, { id: 'b', email: 'ana@x.com' })).toBe(true);
    expect(isSameVisitor({ id: 'a', email: null }, { id: 'b', email: null })).toBe(false);
    const resolved = { status: 'resolved' as const, snoozed_until: null, resolved_at: '2026-10-01T00:00:00Z' };
    const open = { status: 'open' as const, snoozed_until: null, resolved_at: null };
    expect(mergedStatus(resolved, open)).toEqual(open);
    expect(mergedStatus(open, resolved)).toEqual(open);
    expect(mergedStatus(resolved, resolved)).toEqual(resolved);
    expect(parseMergeNote('merged:2026-10-01T10:00:00.000Z:3')).toEqual({ startedAt: '2026-10-01T10:00:00.000Z', count: 3 });
    expect(parseMergeNote('hola')).toBeNull();
  });

  it('mueve mensajes, tags y atributos, borra el origen y deja la marca', async () => {
    const { widget, visitor, conversation: target, owner } = await setup('merge1', 'ana@example.com');
    await updateChatWidget(widget.id, { conversationAttributes: DEFS });
    const source = await createChatConversation(widget.id, visitor.id);
    // Mismo email en otro registro de visitante (otro navegador): también es candidata.
    const twin = await getOrCreateChatVisitor(widget.id, `ext-${crypto.randomUUID()}`, { email: 'ANA@example.com', name: null });
    const twinConv = await createChatConversation(widget.id, twin.id);
    const strangerVisitor = await getOrCreateChatVisitor(widget.id, `ext-${crypto.randomUUID()}`, { email: 'beto@example.com', name: null });
    const stranger = await createChatConversation(widget.id, strangerVisitor.id);

    await createChatMessage(target.id, 'visitor', { body: 'primero' });
    await createChatMessage(source.id, 'visitor', { body: 'segundo' });
    await createChatMessage(source.id, 'user', { body: 'respuesta', userId: owner.id });
    await addConversationTag(source.id, 'facturación');
    await addConversationTag(target.id, 'vip');
    await patch(source.id, { attributes: { reason: 'Bug', plan: 'Free' } });
    await patch(target.id, { attributes: { plan: 'Pro' } });

    const list = await mergeGet(new Request('http://localhost/x'), params(target.id));
    const ids = ((await list.json()) as { candidates: Array<{ id: string; message_count: number }> }).candidates.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([source.id, twinConv.id]));
    expect(ids).not.toContain(stranger.id);
    expect((await listMergeCandidates(target.id)).find((c) => c.id === source.id)?.message_count).toBe(2);

    const res = await mergePost(
      new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ sourceId: source.id }) }),
      params(target.id),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { moved: number }).moved).toBe(2);

    expect(await getChatConversation(source.id)).toBeUndefined();
    const messages = await listChatMessagesWithUsers(target.id);
    expect(messages.map((m) => m.body).slice(0, 3)).toEqual(['primero', 'segundo', 'respuesta']);
    const note = messages.find((m) => m.sender_type === 'system');
    expect(note && parseMergeNote(note.body)?.count).toBe(2);
    expect(await listConversationTags(target.id)).toEqual(['facturación', 'vip']);
    const merged = await getChatConversationWithVisitor(target.id);
    // El destino manda; lo que no tenía sale del origen.
    expect(parseAttributeValues(merged?.attributes)).toEqual({ plan: 'Pro', reason: 'Bug' });

    const other = await mergeChatConversations(target.id, stranger.id);
    expect(other).toEqual({ ok: false, error: 'other_visitor' });
    expect(await mergeChatConversations(target.id, target.id)).toEqual({ ok: false, error: 'same_conversation' });
    expect(await mergeChatConversations(target.id, twinConv.id)).toMatchObject({ ok: true, moved: 0 });
    session.user = null;
  });

  it('no une conversaciones de otro workspace', async () => {
    const a = await setup('merge2a', 'ana@example.com');
    const b = await setup('merge2b', 'ana@example.com');
    session.user = { id: a.owner.id, email: a.owner.email, name: a.owner.name, team: null };
    const res = await mergePost(
      new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ sourceId: b.conversation.id }) }),
      params(a.conversation.id),
    );
    expect(res.status).toBe(404);
    expect(await getChatConversation(b.conversation.id)).toBeDefined();
    session.user = null;
  });
});

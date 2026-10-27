import { createHmac } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => {
    void task().catch(() => {});
  },
}));
const sentEmails = vi.hoisted(() => [] as Array<{ to: string; subject: string; text: string; replyTo?: string; from?: string; headers?: Record<string, string> }>);
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<typeof import('@/lib/email')>()),
  sendEmail: async (opts: { to: string; subject: string; text: string; replyTo?: string; from?: string; headers?: Record<string, string> }) => {
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
  getChatConversation,
  getOrCreateChatVisitor,
  listChatAgents,
  listChatConversations,
  countChatConversations,
} from '@/lib/chat-data';
import {
  ChatCollabError,
  cleanViewFilters,
  createChatTeam,
  createChatView,
  deleteChatTeam,
  deleteChatView,
  getChatView,
  listChatTeams,
  listChatViews,
  listPresence,
  setFollowing,
  touchPresence,
  updateChatView,
} from '@/lib/chat-collab';
import { viewListOptions } from '@/lib/chat-views';
import { fillReplyVariables } from '@/lib/chat-reply-variables';
import { WEBHOOK_EVENTS } from '@/lib/webhooks-events';
import { rotateWidgetIdentitySecret, visitorIdentityHash } from '@/lib/chat-identity';
import { getVisitorHistoryConversation, historyVisitorIds, listVisitorHistory } from '@/lib/chat-visitor-history';
import { createOutbound, getOutbound, listPublicOutbound, outboundMatchesUrl, recordOutboundSeen, submitOutboundSurvey, updateOutbound } from '@/lib/chat-outbound';
import {
  addressSignature,
  inboundAddress,
  parseFrom,
  parseInboundAddress,
  processInboundEmail,
  stripQuotedReply,
  verifySvixSignature,
} from '@/lib/chat-email';
import { sendOfflineReplyEmails } from '@/lib/chat-offline-email';
import { getChatBreakdownReport, weekdayHour } from '@/lib/chat-reports';
import { parseReportRange } from '@/lib/chat-inbox';
import { exportConversations, exportToCsv } from '@/lib/chat-export';
import { runCopilot, visitorLanguage } from '@/lib/chat-copilot';
import { AiError } from '@/lib/ai';
import { createIssueFromConversation, linkConversationToIssue, linkedIssues } from '@/lib/chat-track';
import { createProject } from '@/lib/track-data';
import { searchApps } from '@/lib/app-search';
import { POST as visitorPost } from '@/app/api/chat/messages/route';
import { POST as historyPost } from '@/app/api/chat/history/route';
import { GET as outboundGet, POST as outboundPost } from '@/app/api/chat/outbound/route';
import { POST as inboundPost } from '@/app/api/chat/inbound-email/route';
import { addMember, createTeam } from '@/lib/teams';
import { cleanPublicVisitorKey, issueVisitorToken, isReservedVisitorKey, isSignedVisitorToken } from '@/lib/chat-visitor-key';
import { GET as messagesGet } from '@/app/api/chat/messages/route';
import { GET as identifyGet } from '@/app/api/chat/identify/route';
import { POST as visitorTokenPost } from '@/app/api/chat/visitor/route';
import { POST as csatPost } from '@/app/api/chat/csat/route';
import { POST as readPost } from '@/app/api/chat/read/route';
import { GET as typingGet } from '@/app/api/chat/typing/route';
import { GET as exportGet } from '@/app/api/chat/export/route';
import { listChatAudit } from '@/lib/chat-audit';
import { emailChannelVisitor } from '@/lib/chat-email';
import { PATCH as widgetPatch } from '@/lib/routes/chat/widgets/[id]/route';
import { makeUser } from './helpers';

const now = () => new Date().toISOString();
const run = (fn: () => Promise<void>) => fn();
const schedule = (task: () => Promise<void>) => void task().catch(() => {});

async function setup(label: string) {
  const owner = await makeUser(label);
  const widget = await createChatWidget(owner.id, null, { name: `${label} widget` });
  const ext = `ext-${crypto.randomUUID()}`;
  const visitor = await getOrCreateChatVisitor(widget.id, ext, { email: `${label}@visitor.test`, name: 'Ana Pérez' });
  const conversation = await createChatConversation(widget.id, visitor.id, 'Factura');
  return { owner, widget, visitor, ext, conversation };
}

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

afterEach(() => {
  delete process.env.CHAT_INBOUND_DOMAIN;
  delete process.env.CHAT_INBOUND_FAKE;
  delete process.env.RESEND_WEBHOOK_SECRET;
  delete process.env.CHAT_AI_FAKE;
});

describe('Chat: equipos y ruteo', () => {
  it('crea equipos con miembros válidos y la regla asigna el equipo y reparte entre sus miembros', async () => {
    const { owner, widget, conversation } = await setup('teams1');
    const agents = await listChatAgents(owner.id, null);
    await expect(createChatTeam(owner.id, { name: 'Soporte', memberIds: ['otro'] }, agents.map((a) => a.id))).rejects.toBeInstanceOf(ChatCollabError);
    const team = await createChatTeam(owner.id, { name: '  Soporte  ', memberIds: [owner.id] }, agents.map((a) => a.id));
    expect(team.name).toBe('Soporte');
    expect(team.member_ids).toEqual([owner.id]);

    await createAssignmentRule(widget.id, { name: 'Facturas', matchType: 'keyword', matchValue: 'factura', assignTeamId: team.id, teamRoundRobin: true });
    const assigned = await applyAssignmentRules(widget.id, conversation.id, 'Hola, una factura', agents);
    expect(assigned).toBe(owner.id);
    const after = await getChatConversation(conversation.id);
    expect(after?.team_id).toBe(team.id);

    // La bandeja del equipo la lista y cuenta.
    const rows = await listChatConversations([widget.id], { teamId: team.id });
    expect(rows.map((r) => r.id)).toContain(conversation.id);
    expect(rows[0].team_name).toBe('Soporte');
    expect((await listChatTeams(owner.id))[0].open_count).toBe(1);

    // Borrar el equipo deja la conversación sin equipo.
    expect(await deleteChatTeam(owner.id, team.id)).toBe(true);
    expect((await getChatConversation(conversation.id))?.team_id).toBeNull();
  });

  it('una regla con equipo y sin persona solo deja la conversación en la bandeja del equipo', async () => {
    const { owner, widget, conversation } = await setup('teams2');
    const agents = await listChatAgents(owner.id, null);
    const team = await createChatTeam(owner.id, { name: 'Ventas', memberIds: [owner.id] }, agents.map((a) => a.id));
    await createAssignmentRule(widget.id, { name: 'Todo a ventas', matchType: 'all', assignTeamId: team.id });
    expect(await applyAssignmentRules(widget.id, conversation.id, 'precio', agents)).toBeNull();
    const c = await getChatConversation(conversation.id);
    expect(c?.team_id).toBe(team.id);
    expect(c?.assigned_to).toBeNull();
  });
});

describe('Chat: vistas guardadas, seguir y presencia', () => {
  it('vistas propias y compartidas; los filtros raros se descartan', async () => {
    const { owner, widget, conversation } = await setup('views1');
    const other = await makeUser('views1b');
    expect(cleanViewFilters({ status: 'nope', priority: 'urgent', channel: 'fax', q: ' x ', assignee: 'any' })).toEqual({ priority: 'urgent', q: 'x' });
    const mine = await createChatView(owner.id, owner.id, { name: 'Urgentes', filters: { status: 'open', priority: 'urgent' } });
    const shared = await createChatView(owner.id, other.id, { name: 'Del equipo', filters: { status: 'all' }, shared: true });
    await createChatView(owner.id, other.id, { name: 'Privada de otro', filters: {} });
    const visible = await listChatViews(owner.id, owner.id);
    expect(visible.map((v) => v.name).sort()).toEqual(['Del equipo', 'Urgentes']);
    // Solo el autor la vuelve privada.
    await expect(updateChatView(owner.id, owner.id, shared.id, { shared: false })).rejects.toBeInstanceOf(ChatCollabError);
    expect((await updateChatView(owner.id, owner.id, shared.id, { name: 'Todo' }))?.name).toBe('Todo');

    await getDb().prepare("UPDATE chat_conversations SET priority = 'urgent' WHERE id = ?").run(conversation.id);
    expect(await countChatConversations([widget.id], viewListOptions(mine.filters, owner.id))).toBe(1);
    expect(await deleteChatView(owner.id, owner.id, mine.id)).toBe(true);
    expect(await getChatView(owner.id, owner.id, mine.id)).toBeNull();
  });

  it('"mine" en una vista es quien la abre; Siguiendo filtra las que sigue', async () => {
    const { owner, widget, conversation } = await setup('views2');
    expect(viewListOptions({ assignee: 'mine' }, 'yo').assignedTo).toBe('yo');
    await setFollowing(conversation.id, owner.id, true);
    expect((await listChatConversations([widget.id], { followedBy: owner.id })).map((r) => r.id)).toEqual([conversation.id]);
    await setFollowing(conversation.id, owner.id, false);
    expect(await listChatConversations([widget.id], { followedBy: owner.id })).toEqual([]);
  });

  it('el seguidor recibe el aviso de un mensaje nuevo; quien no es agente del widget, no', async () => {
    const owner = await makeUser('follow1');
    const member = await makeUser('follow1m');
    const outsider = await makeUser('follow1x');
    const team = await createTeam(owner.id, 'Guardia');
    await addMember(team.id, member.id, 'member');
    const widget = await createChatWidget(owner.id, team.id, { name: 'follow widget' });
    const ext = `ext-${crypto.randomUUID()}`;
    const visitor = await getOrCreateChatVisitor(widget.id, ext);
    const conversation = await createChatConversation(widget.id, visitor.id);
    await setFollowing(conversation.id, member.id, true);
    await setFollowing(conversation.id, outsider.id, true);
    const res = await visitorPost(post('http://x/api/chat/messages', { widgetId: widget.id, visitorId: ext, body: 'hola de nuevo' }));
    expect(res.status).toBe(201);
    const count = async (userId: string) =>
      Number(((await getDb().prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND source_id = ?').get(userId, conversation.id)) as { c: number }).c);
    expect(await count(member.id)).toBe(1);
    expect(await count(outsider.id)).toBe(0);
  });

  it('presencia: ve a los demás (no a sí mismo) y vence sola', async () => {
    const { owner, conversation } = await setup('presence1');
    const other = await makeUser('presence1b');
    const t0 = Date.now();
    await touchPresence(conversation.id, owner.id, false, t0);
    await touchPresence(conversation.id, other.id, true, t0);
    const seen = await listPresence(conversation.id, owner.id, t0 + 1000);
    expect(seen).toEqual([expect.objectContaining({ user_id: other.id, typing: true })]);
    expect(await listPresence(conversation.id, owner.id, t0 + 60_000)).toEqual([]);
  });
});

describe('Chat: variables en respuestas guardadas', () => {
  it('completa nombre, email, agente, atributos y respaldo; deja lo desconocido', () => {
    const out = fillReplyVariables('Hola {{first_name}}, soy {{agent_first_name}}. Plan: {{plan}}. {{email}} {{otra}} {{ name | amigo }}', {
      visitorName: 'Ana Pérez',
      visitorEmail: 'ana@x.com',
      agentName: 'Beto Ruiz',
      attributes: { plan: 'Pro' },
    });
    expect(out.text).toBe('Hola Ana, soy Beto. Plan: Pro. ana@x.com {{otra}} Ana Pérez');
    expect(out.unknown).toEqual(['otra']);
    const empty = fillReplyVariables('Hola {{first_name}}, ¿todo bien? {{first_name|che}}', {});
    expect(empty.text).toBe('Hola, ¿todo bien? che');
    expect(empty.missing).toEqual(['first_name']);
  });
});

describe('Chat: webhooks nuevos', () => {
  it('conversación creada, tag y CSAT están en la lista de eventos', () => {
    for (const e of ['chat.conversation.created', 'chat.conversation.tagged', 'chat.csat.submitted']) expect(WEBHOOK_EVENTS).toContain(e);
  });
});

describe('Chat: historial del visitante (público)', () => {
  it('solo sus conversaciones, sin notas ni mensajes de sistema; con firma, también las de su email en otros dispositivos', async () => {
    const { owner, widget, ext, conversation } = await setup('history1');
    await createChatMessage(conversation.id, 'visitor', { body: 'mi factura' });
    await createChatMessage(conversation.id, 'user', { body: 'nota secreta', userId: owner.id, isNote: true });
    await createChatMessage(conversation.id, 'system', { body: 'AI handoff: interno' });
    await createChatMessage(conversation.id, 'user', { body: 'Ya te la mando', userId: owner.id });

    // Otro visitante del mismo widget, con el mismo email pero sin verificar.
    const intruder = await getOrCreateChatVisitor(widget.id, `ext-${crypto.randomUUID()}`, { email: 'history1@visitor.test' });
    const theirs = await createChatConversation(widget.id, intruder.id);
    await createChatMessage(theirs.id, 'visitor', { body: 'conversación ajena' });

    const ids = await historyVisitorIds(widget.id, ext);
    const list = await listVisitorHistory(widget.id, ids);
    expect(list.map((c) => c.id)).toEqual([conversation.id]);
    expect(list[0].last_body).toBe('Ya te la mando');
    const one = await getVisitorHistoryConversation(widget.id, ids, conversation.id);
    expect(one?.messages.map((m) => m.body)).toEqual(['mi factura', 'Ya te la mando']);
    expect(await getVisitorHistoryConversation(widget.id, ids, theirs.id)).toBeNull();

    // Por la ruta: otra conversación da 404; email sin firma no suma nada.
    const r404 = await historyPost(post('http://x/api/chat/history', { widgetId: widget.id, visitorId: ext, conversationId: theirs.id }));
    expect(r404.status).toBe(404);
    const unsigned = await historyPost(post('http://x/api/chat/history', { widgetId: widget.id, visitorId: ext, email: 'history1@visitor.test', userHash: 'a'.repeat(64) }));
    expect(((await unsigned.json()) as { conversations: unknown[] }).conversations).toHaveLength(1);

    // Con identidad verificada en dos dispositivos, se juntan.
    const secret = await rotateWidgetIdentitySecret(widget.id);
    const email = 'verificada@visitor.test';
    const hash = visitorIdentityHash(secret, email);
    const a = await getOrCreateChatVisitor(widget.id, 'device-a', { email, verified: true });
    const b = await getOrCreateChatVisitor(widget.id, 'device-b', { email, verified: true });
    const ca = await createChatConversation(widget.id, a.id);
    await createChatMessage(ca.id, 'visitor', { body: 'desde la compu' });
    const cb = await createChatConversation(widget.id, b.id);
    await createChatMessage(cb.id, 'visitor', { body: 'desde el celu' });
    const both = await historyPost(post('http://x/api/chat/history', { widgetId: widget.id, visitorId: 'device-b', email, userHash: hash }));
    expect(((await both.json()) as { conversations: Array<{ id: string }> }).conversations.map((c) => c.id).sort()).toEqual([ca.id, cb.id].sort());
    const other = await historyPost(post('http://x/api/chat/history', { widgetId: widget.id, visitorId: 'device-b' }));
    expect(((await other.json()) as { conversations: Array<{ id: string }> }).conversations.map((c) => c.id)).toEqual([cb.id]);
  });
});

describe('Chat: mensajes salientes y encuestas', () => {
  it('valida, publica solo los activos y cuenta vista y respuesta una vez por visitante', async () => {
    const { owner, widget } = await setup('outbound1');
    await expect(createOutbound(widget.id, owner.id, { name: '' })).rejects.toBeInstanceOf(ChatCollabError);
    const draft = await createOutbound(widget.id, owner.id, { name: 'Sin texto', active: true });
    expect(draft.active).toBe(0);
    await expect(updateOutbound(draft.id, { active: true })).rejects.toBeInstanceOf(ChatCollabError);
    const survey = await createOutbound(widget.id, owner.id, { name: 'NPS', kind: 'survey', body: '¿Cómo te fue?', urlMatch: 'contains', urlValue: '/precios', active: true });
    expect((await listPublicOutbound(widget.id)).map((m) => m.id)).toEqual([survey.id]);
    expect(await recordOutboundSeen(survey.id, 'v1')).toBe(true);
    expect(await recordOutboundSeen(survey.id, 'v1')).toBe(false);
    expect(await submitOutboundSurvey(survey.id, 'v1', 4, 'bien')).toBe(true);
    expect(await submitOutboundSurvey(survey.id, 'v1', 1)).toBe(false);
    const after = await getOutbound(survey.id);
    expect(after?.shown_count).toBe(1);
    expect(after?.responses).toBe(1);
    expect(after?.average).toBe(4);
    expect(outboundMatchesUrl('contains', '/precios', 'https://a.com/precios?x=1#y')).toBe(true);
    expect(outboundMatchesUrl('equals', 'https://a.com/precios', 'https://a.com/precios/')).toBe(true);
    expect(outboundMatchesUrl('equals', 'https://a.com/precios', 'https://a.com/blog')).toBe(false);

    // Ruta pública: GET lista; un evento de otro widget o inactivo da 404; score fuera de rango, 400.
    const listed = await outboundGet(new Request(`http://x/api/chat/outbound?widgetId=${widget.id}`));
    expect(((await listed.json()) as { messages: unknown[] }).messages).toHaveLength(1);
    const bad = await outboundPost(post('http://x', { widgetId: widget.id, visitorId: 'v2', outboundId: draft.id, event: 'seen' }));
    expect(bad.status).toBe(404);
    // Un id inventado no cuenta (403); una clave emitida por el servidor sí.
    const made = await outboundPost(post('http://x', { widgetId: widget.id, visitorId: 'inventado-1', outboundId: survey.id, event: 'seen' }));
    expect(made.status).toBe(403);
    const token = issueVisitorToken(widget.id);
    const oob = await outboundPost(post('http://x', { widgetId: widget.id, visitorId: token, outboundId: survey.id, event: 'survey', score: 9 }));
    expect(oob.status).toBe(400);
    const seen = await outboundPost(post('http://x', { widgetId: widget.id, visitorId: token, outboundId: survey.id, event: 'seen' }));
    expect(seen.status).toBe(200);
    // La firma es por widget.
    const other = await outboundPost(post('http://x', { widgetId: widget.id, visitorId: issueVisitorToken('otro-widget'), outboundId: survey.id, event: 'seen' }));
    expect(other.status).toBe(403);
  });

  it('responder un mensaje saliente arranca la conversación con ese mensaje del equipo', async () => {
    const { owner, widget } = await setup('outbound2');
    const other = await setup('outbound2b');
    const hello = await createOutbound(widget.id, owner.id, { name: 'Hola', body: '¿Dudas con los planes?', active: true });
    const foreign = await createOutbound(other.widget.id, other.owner.id, { name: 'Ajeno', body: 'otro widget', active: true });

    const res = await visitorPost(post('http://x/api/chat/messages', { widgetId: widget.id, visitorId: 'ob-visitor', body: 'Sí, el Pro', outboundId: hello.id }));
    const data = (await res.json()) as { conversation: { id: string; outbound_id: string } };
    expect(data.conversation.outbound_id).toBe(hello.id);
    const bodies = (await getDb().prepare('SELECT sender_type, body FROM chat_messages WHERE conversation_id = ? ORDER BY created_at').all(data.conversation.id)) as Array<{
      sender_type: string;
      body: string;
    }>;
    expect(bodies).toEqual([
      { sender_type: 'user', body: '¿Dudas con los planes?' },
      { sender_type: 'visitor', body: 'Sí, el Pro' },
    ]);
    expect((await getOutbound(hello.id))?.reply_count).toBe(1);

    // Un mensaje de otro widget no se cuela.
    const res2 = await visitorPost(post('http://x/api/chat/messages', { widgetId: widget.id, visitorId: 'ob-visitor-2', body: 'hola', outboundId: foreign.id }));
    const d2 = (await res2.json()) as { conversation: { id: string; outbound_id: string | null } };
    expect(d2.conversation.outbound_id ?? null).toBeNull();
  });
});

describe('Chat: canal email (Resend Inbound)', () => {
  it('firma Svix, direcciones firmadas, remitente y texto citado', () => {
    const secret = `whsec_${Buffer.from('k'.repeat(24)).toString('base64')}`;
    const body = '{"type":"email.received"}';
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', Buffer.from('k'.repeat(24))).update(`msg_1.${ts}.${body}`).digest('base64');
    expect(verifySvixSignature(body, { id: 'msg_1', timestamp: ts, signature: `v1,${sig}` }, secret)).toBe(true);
    expect(verifySvixSignature(body + ' ', { id: 'msg_1', timestamp: ts, signature: `v1,${sig}` }, secret)).toBe(false);
    expect(verifySvixSignature(body, { id: 'msg_1', timestamp: String(Number(ts) - 3600), signature: `v1,${sig}` }, secret)).toBe(false);

    process.env.CHAT_INBOUND_DOMAIN = 'in.zerosoft.test';
    const id = crypto.randomUUID();
    const addr = inboundAddress('reply', id)!;
    expect(parseInboundAddress([`Soporte <${addr}>`])).toEqual({ kind: 'reply', id });
    expect(parseInboundAddress([`reply+${id}.${'0'.repeat(16)}@in.zerosoft.test`])).toBeNull();
    expect(addressSignature('inbox', id)).not.toBe(addressSignature('reply', id));
    expect(parseFrom('"Ana Pérez" <Ana@Mail.com>')).toEqual({ email: 'ana@mail.com', name: 'Ana Pérez' });
    expect(stripQuotedReply('Gracias!\n\nEl lun, 1 ene 2026 escribió:\n> hola')).toBe('Gracias!');
    expect(stripQuotedReply('Ok\n-- \nAna')).toBe('Ok');
  });

  it('la respuesta al email vuelve a la conversación; otro remitente no; el mismo email no entra dos veces', async () => {
    process.env.CHAT_INBOUND_DOMAIN = 'in.zerosoft.test';
    const { conversation } = await setup('inbound1');
    await getDb().prepare("UPDATE chat_conversations SET status = 'resolved' WHERE id = ?").run(conversation.id);
    const to = [inboundAddress('reply', conversation.id)!];
    // Con el email solo declarado (sin firma del sitio) la respuesta no entra.
    const unverified = await processInboundEmail({ emailId: `e-${crypto.randomUUID()}`, from: 'inbound1@visitor.test', to, subject: 'Re', text: 'hola' }, schedule);
    expect(unverified).toEqual({ status: 'ignored', reason: 'unverified_email' });
    await getDb().prepare('UPDATE chat_visitors SET email_verified = 1 WHERE id = ?').run(conversation.visitor_id);
    const spoof = await processInboundEmail({ emailId: `e-${crypto.randomUUID()}`, from: 'otro@x.com', to, subject: 'Re', text: 'hola' }, schedule);
    expect(spoof).toEqual({ status: 'ignored', reason: 'sender_mismatch' });
    const emailId = `e-${crypto.randomUUID()}`;
    const ok = await processInboundEmail({ emailId, from: 'Ana <inbound1@visitor.test>', to, subject: 'Re: Factura', text: 'Llegó, gracias\n\nOn Mon wrote:\n> viejo' }, schedule);
    expect(ok).toMatchObject({ status: 'added', conversationId: conversation.id, created: false });
    expect((await getChatConversation(conversation.id))?.status).toBe('open');
    const dup = await processInboundEmail({ emailId, from: 'inbound1@visitor.test', to, subject: 'Re', text: 'otra vez' }, schedule);
    expect(dup.status).toBe('duplicate');
    const last = (await getDb().prepare("SELECT body FROM chat_messages WHERE conversation_id = ? AND sender_type = 'visitor' ORDER BY created_at DESC LIMIT 1").get(conversation.id)) as { body: string };
    expect(last.body).toBe('Llegó, gracias');
  });

  it('un email a la dirección del widget abre una conversación de email y la respuesta sale por email enseguida', async () => {
    process.env.CHAT_INBOUND_DOMAIN = 'in.zerosoft.test';
    const { owner, widget } = await setup('inbound2');
    // Reenviado desde soporte@: el To es el del cliente y nuestra dirección llega en received_for.
    const res = await processInboundEmail(
      {
        emailId: `e-${crypto.randomUUID()}`,
        from: 'Carla <carla@cliente.test>',
        to: ['soporte@cliente.test', inboundAddress('inbox', widget.id)!],
        subject: 'Fwd: No puedo entrar',
        text: 'Me da error',
        messageId: '<abc-1@cliente.test>',
        attachments: [{ filename: 'captura.png', contentType: 'image/png', data: Buffer.from('89504e470d0a1a0a', 'hex') }],
      },
      schedule,
    );
    expect(res).toMatchObject({ status: 'added', created: true });
    const convId = (res as { conversationId: string }).conversationId;
    const conv = await getChatConversation(convId);
    expect(conv?.channel).toBe('email');
    expect(conv?.subject).toBe('No puedo entrar');
    expect(await listChatConversations([widget.id], { channel: 'email' })).toHaveLength(1);
    // No responde el bot por email.
    const bots = (await getDb().prepare("SELECT COUNT(*) AS c FROM chat_messages WHERE conversation_id = ? AND sender_type = 'bot'").get(convId)) as { c: number };
    expect(Number(bots.c)).toBe(0);

    await createChatMessage(convId, 'user', { body: 'Probá restablecer la clave', userId: owner.id });
    sentEmails.length = 0;
    await sendOfflineReplyEmails({ now: new Date(Date.now() + 1000) });
    const mine = sentEmails.filter((e) => e.to === 'carla@cliente.test');
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toBe('Re: No puedo entrar');
    expect(mine[0].replyTo).toBe(inboundAddress('reply', convId));
    expect(mine[0].text).toContain('Probá restablecer la clave');
    expect(mine[0].text).toContain('answered your email');
    expect(mine[0].from).toBe('"inbound2 widget via zerosoft" <notifications@zerosoft.ai>');
    expect(mine[0].headers).toEqual({ 'In-Reply-To': '<abc-1@cliente.test>', References: '<abc-1@cliente.test>' });
    // El adjunto quedó en el mensaje del visitante.
    const first = (await getDb().prepare("SELECT attachments FROM chat_messages WHERE conversation_id = ? AND sender_type = 'visitor'").get(convId)) as { attachments: string };
    expect(JSON.parse(first.attachments)).toEqual([expect.objectContaining({ name: 'captura.png', type: 'image' })]);
    // El visitante del canal email tiene una clave reservada y aleatoria.
    const v = (await getDb().prepare('SELECT external_id FROM chat_visitors WHERE id = ?').get(conv!.visitor_id)) as { external_id: string };
    expect(v.external_id).toMatch(/^mail\.[0-9a-f-]{36}$/);
  });

  it('al email declarado sin verificar se le avisa sin Reply-To a la conversación', async () => {
    process.env.CHAT_INBOUND_DOMAIN = 'in.zerosoft.test';
    const { owner, conversation } = await setup('inbound5');
    const m = await createChatMessage(conversation.id, 'user', { body: 'Respuesta', userId: owner.id });
    await getDb().prepare('UPDATE chat_messages SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 30 * 60_000).toISOString(), m.id);
    sentEmails.length = 0;
    await sendOfflineReplyEmails();
    const mine = sentEmails.filter((e) => e.to === 'inbound5@visitor.test');
    expect(mine).toHaveLength(1);
    expect(mine[0].replyTo).toBeUndefined();
    expect(mine[0].text).not.toContain('You can reply to this email');
  });

  it('los adjuntos que no se guardan dejan una nota para el equipo', async () => {
    process.env.CHAT_INBOUND_DOMAIN = 'in.zerosoft.test';
    const { widget } = await setup('inbound6');
    const r = await processInboundEmail(
      {
        emailId: `e-${crypto.randomUUID()}`,
        from: 'eva@c.test',
        to: [inboundAddress('inbox', widget.id)!],
        subject: 'Archivos',
        text: 'van dos',
        attachments: [{ filename: 'virus.exe', contentType: 'application/x-msdownload', data: Buffer.from('MZ') }],
        skippedAttachments: ['type'],
      },
      schedule,
    );
    const convId = (r as { conversationId: string }).conversationId;
    const notes = (await getDb().prepare("SELECT body FROM chat_messages WHERE conversation_id = ? AND sender_type = 'system'").all(convId)) as Array<{ body: string }>;
    expect(notes.map((n) => n.body)).toEqual(['Attachments not saved: 2 (type)']);
  });

  it('descarta respuestas automáticas, rebotes, nuestro propio dominio y fallas de DMARC', async () => {
    process.env.CHAT_INBOUND_DOMAIN = 'in.zerosoft.test';
    const { widget } = await setup('inbound4');
    const to = [inboundAddress('inbox', widget.id)!];
    const base = { to, subject: 'x', text: 'hola' };
    const id = () => `e-${crypto.randomUUID()}`;
    expect(await processInboundEmail({ ...base, emailId: id(), from: 'a@c.test', headers: { 'auto-submitted': 'auto-replied' } }, schedule)).toEqual({ status: 'ignored', reason: 'auto_submitted' });
    expect(await processInboundEmail({ ...base, emailId: id(), from: 'MAILER-DAEMON@c.test' }, schedule)).toEqual({ status: 'ignored', reason: 'bounce' });
    expect(await processInboundEmail({ ...base, emailId: id(), from: 'x@in.zerosoft.test' }, schedule)).toEqual({ status: 'ignored', reason: 'own_sender' });
    expect(await processInboundEmail({ ...base, emailId: id(), from: 'a@c.test', authentication: { spf: 'pass', dkim: 'pass', dmarc: 'fail' } }, schedule)).toEqual({ status: 'ignored', reason: 'auth_failed' });
    expect(await processInboundEmail({ ...base, emailId: id(), from: 'a@c.test', authentication: { spf: 'fail', dkim: 'fail', dmarc: 'gray' } }, schedule)).toEqual({ status: 'ignored', reason: 'auth_failed' });
    expect((await processInboundEmail({ ...base, emailId: id(), from: 'a@c.test', headers: { 'auto-submitted': 'no' }, authentication: { spf: 'pass', dkim: 'gray', dmarc: 'pass' } }, schedule)).status).toBe('added');
  });

  it('el webhook exige firma (o el modo de prueba) y procesa email.received', async () => {
    process.env.CHAT_INBOUND_DOMAIN = 'in.zerosoft.test';
    const { widget } = await setup('inbound3');
    // Forma del payload de la doc de Resend (to del cliente, nuestra dirección en received_for).
    const event = {
      type: 'email.received',
      created_at: '2026-02-22T23:41:12.126Z',
      data: {
        email_id: `e-${crypto.randomUUID()}`,
        created_at: '2026-02-22T23:41:11.894Z',
        from: 'dani@c.test',
        to: ['soporte@c.test'],
        bcc: [],
        cc: [],
        received_for: [inboundAddress('inbox', widget.id)],
        message_id: '<111-222-333@c.test>',
        subject: 'Hola',
        attachments: [],
        text: 'Consulta',
      },
    };
    expect((await inboundPost(post('http://x/api/chat/inbound-email', event))).status).toBe(503);
    process.env.RESEND_WEBHOOK_SECRET = `whsec_${Buffer.from('s'.repeat(24)).toString('base64')}`;
    expect((await inboundPost(post('http://x/api/chat/inbound-email', event))).status).toBe(401);
    delete process.env.RESEND_WEBHOOK_SECRET;
    process.env.CHAT_INBOUND_FAKE = '1';
    const okRes = await inboundPost(post('http://x/api/chat/inbound-email', event));
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toMatchObject({ status: 'added', created: true });
  });
});

describe('Chat: reportes por desglose y export', () => {
  it('cuenta deflexión del bot, tags, horas y SLA', async () => {
    const { owner, widget, conversation } = await setup('reports1');
    await createChatMessage(conversation.id, 'visitor', { body: 'hola' });
    await createChatMessage(conversation.id, 'bot', { body: 'Respuesta del bot' });
    await getDb().prepare("UPDATE chat_conversations SET status = 'resolved', resolved_at = ? WHERE id = ?").run(now(), conversation.id);
    await getDb().prepare('INSERT INTO chat_conversation_tags (conversation_id, tag) VALUES (?, ?)').run(conversation.id, 'factura');
    const second = await createChatConversation(widget.id, conversation.visitor_id);
    await createChatMessage(second.id, 'visitor', { body: 'otra' });
    await createChatMessage(second.id, 'user', { body: 'humano', userId: owner.id });
    await getDb().prepare('UPDATE chat_conversations SET first_response_at = ? WHERE id = ?').run(now(), second.id);

    const range = parseReportRange(null, null);
    const r = await getChatBreakdownReport([widget.id], range, { timeZone: 'America/Argentina/Buenos_Aires' });
    expect(r.bot).toMatchObject({ botConversations: 1, botResolved: 1, resolutionRate: 1 });
    expect(r.tags).toEqual([expect.objectContaining({ key: 'factura', conversations: 1, resolved: 1 })]);
    expect(r.widgets[0].conversations).toBe(2);
    expect(r.hours.flat().reduce((a, b) => a + b, 0)).toBe(2);
    expect(r.sla.firstResponseMet).toBe(1);
    expect(weekdayHour(new Date('2026-01-05T03:00:00Z'), 'America/Argentina/Buenos_Aires')).toEqual({ day: 1, hour: 0 });

    await getDb().prepare("UPDATE chat_visitors SET name = '=HYPERLINK(1)' WHERE id = ?").run(conversation.visitor_id);
    const list = await exportConversations([widget.id], range, { withMessages: true });
    expect(list).toHaveLength(2);
    expect(list.find((c) => c.id === conversation.id)?.messages?.map((m) => m.from)).toEqual(['visitor', 'bot']);
    expect(exportToCsv(list)).toContain("'=HYPERLINK(1)");
    await getDb().prepare("UPDATE chat_visitors SET name = ? WHERE id = ?").run('\t=cmd', conversation.visitor_id);
    expect(exportToCsv(await exportConversations([widget.id], range))).toContain("'\t=cmd");
  });
});

describe('Chat: AI del agente', () => {
  it('sin AI tira ai_disabled; con el modelo falso resume, traduce y redacta solo con Docs publicados', async () => {
    const { owner, widget, visitor, conversation } = await setup('copilot1');
    await createChatMessage(conversation.id, 'visitor', { body: 'Cuál es la política de reembolsos?' });
    await expect(runCopilot({ ws: owner.id, widget, conversationId: conversation.id, action: 'summarize' })).rejects.toBeInstanceOf(AiError);

    process.env.CHAT_AI_FAKE = '1';
    const sum = await runCopilot({ ws: owner.id, widget, conversationId: conversation.id, action: 'summarize' });
    expect(sum.text).toContain('Summary');
    const tr = await runCopilot({ ws: owner.id, widget, conversationId: conversation.id, action: 'translate', text: 'Hola', visitorMetadata: JSON.stringify({ page: { language: 'pt-BR' } }) });
    expect(tr.text).toBe('[pt] Hola');
    expect(visitorLanguage(visitor.metadata)).toBeNull();

    const content = (text: string) => JSON.stringify([{ id: crypto.randomUUID(), type: 'paragraph', content: text }]);
    await getDb()
      .prepare('INSERT INTO docs_pages (id, user_id, title, content, is_public) VALUES (?, ?, ?, ?, 0)')
      .run(crypto.randomUUID(), owner.id, 'Reembolsos borrador interno', content('reembolsos política secreta'));
    const noDocs = await runCopilot({ ws: owner.id, widget, conversationId: conversation.id, action: 'draft' });
    expect(noDocs.sources).toEqual([]);
    await getDb()
      .prepare('INSERT INTO docs_pages (id, user_id, title, content, is_public) VALUES (?, ?, ?, ?, 1)')
      .run(crypto.randomUUID(), owner.id, 'Política de reembolsos', content('Los reembolsos se piden hasta 30 días después de la compra.'));
    const draft = await runCopilot({ ws: owner.id, widget, conversationId: conversation.id, action: 'draft' });
    expect(draft.sources).toEqual(['Política de reembolsos']);
    const usage = (await getDb().prepare("SELECT COUNT(*) AS c FROM ai_usage WHERE user_id = ? AND feature LIKE 'chat_copilot_%'").get(owner.id)) as { c: number };
    expect(Number(usage.c)).toBeGreaterThanOrEqual(3);
  });
});

describe('Chat → Track y ⌘K', () => {
  it('crea un issue desde la conversación, vincula otra al mismo issue y ⌘K encuentra conversaciones', async () => {
    const { owner, conversation } = await setup('track1');
    const project = await createProject(owner.id, null, { name: 'Web', color: '#5e6ad2' });
    const linked = await createIssueFromConversation({ conversation, projectId: project.id, title: 'No llega la factura', teamId: null, ownerId: owner.id, personId: owner.id });
    expect(linked.title).toBe('No llega la factura');
    const second = await createChatConversation(conversation.widget_id, conversation.visitor_id);
    const again = await linkConversationToIssue({ conversation: second, identifier: linked.identifier.toLowerCase(), teamId: null, ownerId: owner.id, personId: owner.id });
    expect(again.issueId).toBe(linked.issueId);
    await expect(linkConversationToIssue({ conversation: second, identifier: linked.identifier, teamId: null, ownerId: owner.id, personId: owner.id })).rejects.toThrow('already_linked');
    const requests = (await getDb().prepare("SELECT COUNT(*) AS c FROM track_customer_requests WHERE issue_id = ? AND source = 'chat'").get(linked.issueId)) as { c: number };
    expect(Number(requests.c)).toBe(2);
    expect((await linkedIssues(conversation.id, { teamId: null, ownerId: owner.id })).map((i) => i.identifier)).toEqual([linked.identifier]);
    // Otro workspace no ve el issue vinculado (proyecto ajeno) ni el título en la nota de sistema.
    expect(await linkedIssues(conversation.id, { teamId: null, ownerId: 'otro' })).toEqual([]);
    const system = (await getDb().prepare("SELECT body FROM chat_messages WHERE conversation_id = ? AND sender_type = 'system'").all(conversation.id)) as Array<{ body: string }>;
    expect(system.map((m) => m.body)).toEqual([`Track: ${linked.identifier}`]);

    // Otro workspace no puede vincular ese issue.
    const stranger = await setup('track1b');
    await expect(
      linkConversationToIssue({ conversation: stranger.conversation, identifier: linked.identifier, teamId: null, ownerId: stranger.owner.id, personId: stranger.owner.id }),
    ).rejects.toThrow('issue_not_found');

    const found = await searchApps({ id: owner.id, team: null, role: 'owner' }, 'Ana Pérez');
    expect(found.some((i) => i.group === 'chatConversations' && i.href === `/app/chat/inbox/${conversation.id}`)).toBe(true);
    expect(found.some((i) => i.group === 'chatPeople')).toBe(true);
    const foreign = await searchApps({ id: stranger.owner.id, team: null, role: 'owner' }, 'track1@visitor');
    expect(foreign.some((i) => i.group === 'chatConversations')).toBe(false);
  });
});

void run;

describe('Chat: el widget no puede usar visitantes del canal email', () => {
  it('ninguna ruta pública acepta claves reservadas ni deja leer, escribir o cambiar la identidad del visitante de email', async () => {
    process.env.CHAT_INBOUND_DOMAIN = 'in.zerosoft.test';
    const { owner, widget } = await setup('hijack1');
    const r = await processInboundEmail(
      { emailId: `e-${crypto.randomUUID()}`, from: 'victima@cliente.test', to: [inboundAddress('inbox', widget.id)!], subject: 'Factura', text: 'mi factura' },
      schedule,
    );
    const convId = (r as { conversationId: string }).conversationId;
    await createChatMessage(convId, 'user', { body: 'link secreto', userId: owner.id });
    const visitor = (await getDb().prepare('SELECT * FROM chat_visitors WHERE id = (SELECT visitor_id FROM chat_conversations WHERE id = ?)').get(convId)) as { id: string; external_id: string; email: string };

    for (const key of ['email:victima@cliente.test', visitor.external_id, ' MAIL.x ']) {
      expect(isReservedVisitorKey(key)).toBe(true);
      expect(cleanPublicVisitorKey(key)).toBeNull();
      const q = `widgetId=${widget.id}&visitorId=${encodeURIComponent(key)}`;
      expect((await messagesGet(new Request(`http://x/api/chat/messages?${q}`))).status).toBe(400);
      expect((await visitorPost(post('http://x', { widgetId: widget.id, visitorId: key, body: 'mandalo a evil@x.test', email: 'evil@x.test' }))).status).toBe(400);
      expect((await historyPost(post('http://x', { widgetId: widget.id, visitorId: key }))).status).toBe(400);
      expect((await identifyGet(new Request(`http://x/api/chat/identify?widgetId=${widget.id}&externalId=${encodeURIComponent(key)}`))).status).toBe(400);
      expect((await csatPost(post('http://x', { widgetId: widget.id, visitorId: key, conversationId: convId, score: 1 }))).status).toBe(400);
      expect((await readPost(post('http://x', { widgetId: widget.id, visitorId: key, conversationId: convId }))).status).toBe(400);
      expect((await typingGet(new Request(`http://x/api/chat/typing?${q}&conversationId=${convId}`))).status).toBe(400);
    }
    // Ni por la capa de datos: crear o tomar un visitante con clave reservada falla.
    await expect(getOrCreateChatVisitor(widget.id, visitor.external_id, { email: 'evil@x.test' })).rejects.toThrow('reserved_visitor_key');
    const after = (await getDb().prepare('SELECT email FROM chat_visitors WHERE id = ?').get(visitor.id)) as { email: string };
    expect(after.email).toBe('victima@cliente.test');
    // El mismo email vuelve al mismo visitante, sin pasar por las rutas públicas.
    expect((await emailChannelVisitor(widget.id, 'VICTIMA@cliente.test', null)).id).toBe(visitor.id);
  });

  it('una identidad declarada no pisa el email de un visitante verificado', async () => {
    const { widget } = await setup('hijack2');
    const v = await getOrCreateChatVisitor(widget.id, 'dev-1', { email: 'real@x.test', verified: true });
    const again = await getOrCreateChatVisitor(widget.id, 'dev-1', { email: 'otro@x.test', name: 'Otro' });
    expect(again.email).toBe('real@x.test');
    expect(again.id).toBe(v.id);
  });

  it('el servidor emite claves firmadas por widget', async () => {
    const { widget } = await setup('token1');
    const res = await visitorTokenPost(post('http://x/api/chat/visitor', { widgetId: widget.id }));
    expect(res.status).toBe(201);
    const { visitorId } = (await res.json()) as { visitorId: string };
    expect(visitorId).toMatch(/^v1\./);
    expect(isSignedVisitorToken(widget.id, visitorId)).toBe(true);
    expect(isSignedVisitorToken('otro', visitorId)).toBe(false);
    expect(isSignedVisitorToken(widget.id, visitorId.slice(0, -1) + (visitorId.endsWith('A') ? 'B' : 'A'))).toBe(false);
    expect(cleanPublicVisitorKey(visitorId)).toBe(visitorId);
    expect((await visitorTokenPost(post('http://x', { widgetId: 'no-existe' }))).status).toBe(404);
  });
});

describe('Chat: export solo para admins, con auditoría', () => {
  it('un miembro recibe 403; el admin exporta y queda registrado', async () => {
    const owner = await makeUser('exp1');
    const widget = await createChatWidget(owner.id, null, { name: 'exp widget' });
    session.user = { id: owner.id, email: owner.email, role: 'member' };
    expect((await exportGet(new Request('http://x/api/chat/export?format=json&notes=1'))).status).toBe(403);
    session.user = { id: owner.id, email: owner.email, role: 'owner' };
    const ok = await exportGet(new Request('http://x/api/chat/export?format=csv'));
    expect(ok.status).toBe(200);
    const log = await listChatAudit(owner.id);
    expect(log.map((e) => e.action)).toEqual(['export.csv']);
    void widget;
    session.user = null;
  });
});

describe('Chat: el nombre del widget (remitente de los emails) lo cambian solo admins', () => {
  it('un miembro no lo renombra; puede guardar otros campos con el mismo nombre', async () => {
    const owner = await makeUser('rename1');
    const widget = await createChatWidget(owner.id, null, { name: 'Soporte' });
    const ctx = { params: Promise.resolve({ id: widget.id }) };
    const patch = (body: unknown) => new Request('http://x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    session.user = { id: owner.id, email: owner.email, role: 'member' };
    expect((await widgetPatch(patch({ name: 'Banco Nación' }), ctx)).status).toBe(403);
    expect((await widgetPatch(patch({ name: 'Soporte', color: '#112233' }), ctx)).status).toBe(200);
    session.user = { id: owner.id, email: owner.email, role: 'owner' };
    expect((await widgetPatch(patch({ name: 'Soporte Acme' }), ctx)).status).toBe(200);
    session.user = null;
  });
});

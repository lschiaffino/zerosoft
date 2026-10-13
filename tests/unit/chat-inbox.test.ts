import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import {
  createCannedResponse,
  createChatConversation,
  createChatMessage,
  createChatWidget,
  getChatConversation,
  getOrCreateChatVisitor,
  getVisitorConversationWithMessages,
  listChatConversations,
  listChatMessages,
  listChatMessagesWithUsers,
  markMessagesRead,
} from '@/lib/chat-data';
import { humanHasReplied, recentMessages } from '@/lib/chat-bot-ai';
import {
  addConversationTag,
  applyCannedMacro,
  chatReportToCsv,
  getChatRangeReport,
  listConversationTags,
  listWorkspaceTags,
  normalizeTag,
  parseReportRange,
  removeConversationTag,
  setCannedActions,
} from '@/lib/chat-inbox';
import { GET as visitorMessages } from '@/app/api/chat/messages/route';
import { addMember, createTeam } from '@/lib/teams';
import { makeUser } from './helpers';

async function setup(label = 'inbox') {
  const owner = await makeUser(label);
  const widget = await createChatWidget(owner.id, null, { name: `${label} widget` });
  const externalId = `ext-${crypto.randomUUID()}`;
  const visitor = await getOrCreateChatVisitor(widget.id, externalId);
  const conversation = await createChatConversation(widget.id, visitor.id);
  return { owner, widget, visitor, externalId, conversation };
}

describe('Chat: notas internas', () => {
  it('el visitante, el widget, el bot y el CRM nunca ven las notas', async () => {
    const { owner, widget, externalId, conversation } = await setup('notes');
    await createChatMessage(conversation.id, 'visitor', { body: 'Hola' });
    await createChatMessage(conversation.id, 'user', { body: 'Cliente VIP, ojo', userId: owner.id, isNote: true });

    const forVisitor = await getVisitorConversationWithMessages(widget.id, externalId);
    expect(forVisitor?.messages.map((m) => m.body)).toEqual(['Hola']);
    expect((await listChatMessages(conversation.id)).map((m) => m.body)).toEqual(['Hola']);
    expect((await recentMessages(conversation.id)).map((m) => m.body)).toEqual(['Hola']);
    // Una nota no cuenta como "un humano ya respondió" (el bot sigue activo).
    expect(await humanHasReplied(conversation.id)).toBe(false);

    const agentView = await listChatMessagesWithUsers(conversation.id);
    expect(agentView.map((m) => [m.body, m.is_note])).toEqual([
      ['Hola', 0],
      ['Cliente VIP, ojo', 1],
    ]);

    // API pública del widget.
    const res = await visitorMessages(
      new Request(`http://localhost/api/chat/messages?widgetId=${widget.id}&visitorId=${externalId}`),
    );
    const body = (await res.json()) as { messages: Array<{ body: string }> };
    expect(body.messages.map((m) => m.body)).toEqual(['Hola']);
    expect(JSON.stringify(body)).not.toContain('VIP');
  });

  it('marcar leído desde el visitante no toca las notas; la vista previa del inbox las ignora', async () => {
    const { owner, widget, conversation } = await setup('notes2');
    await createChatMessage(conversation.id, 'user', { body: 'Respuesta', userId: owner.id });
    await createChatMessage(conversation.id, 'user', { body: 'nota privada', userId: owner.id, isNote: true });
    await markMessagesRead(conversation.id, 'visitor');
    const all = await listChatMessagesWithUsers(conversation.id);
    expect(all.find((m) => m.is_note === 1)?.read_at).toBeNull();
    const [row] = await listChatConversations([widget.id]);
    expect(row.last_message_body).toBe('Respuesta');
  });

  it('isNote solo aplica a mensajes de agente', async () => {
    const { conversation } = await setup('notes3');
    const m = await createChatMessage(conversation.id, 'visitor', { body: 'x', isNote: true });
    expect(m.is_note).toBe(0);
  });
});

describe('Chat: tags', () => {
  it('normaliza, agrega, quita y filtra el inbox por tag', async () => {
    const { widget, conversation, visitor } = await setup('tags');
    const other = await createChatConversation(widget.id, visitor.id);
    expect(normalizeTag('  #Facturación  Urgente ')).toBe('facturación-urgente');
    expect(await addConversationTag(conversation.id, 'Billing')).toEqual(['billing']);
    await addConversationTag(conversation.id, 'billing');
    await addConversationTag(conversation.id, 'vip');
    expect(await listConversationTags(conversation.id)).toEqual(['billing', 'vip']);
    const filtered = await listChatConversations([widget.id], { tag: 'billing' });
    expect(filtered.map((c) => c.id)).toEqual([conversation.id]);
    expect(filtered[0].tags).toBe('billing,vip');
    expect((await listChatConversations([widget.id])).map((c) => c.id).sort()).toEqual([conversation.id, other.id].sort());
    expect(await listWorkspaceTags([widget.id])).toEqual([
      { tag: 'billing', count: 1 },
      { tag: 'vip', count: 1 },
    ]);
    expect(await removeConversationTag(conversation.id, 'VIP')).toEqual(['billing']);
  });

  it('los tags de otro workspace no aparecen', async () => {
    const a = await setup('tagsa');
    const b = await setup('tagsb');
    await addConversationTag(b.conversation.id, 'ajeno');
    expect(await listWorkspaceTags([a.widget.id])).toEqual([]);
    expect(await listChatConversations([a.widget.id], { tag: 'ajeno' })).toEqual([]);
  });
});

describe('Chat: macros', () => {
  it('aplica estado, asignación, tags y snooze', async () => {
    const { owner, widget, conversation } = await setup('macro');
    const canned = await createCannedResponse(widget.id, { shortcut: '/refund', title: 'Refund', body: 'Te devolvemos el dinero.' });
    await setCannedActions(canned.id, { status: 'resolved', assignTo: 'me', addTags: ['Refund', 'billing'] });
    const row = (await getDb().prepare('SELECT * FROM chat_canned_responses WHERE id = ?').get(canned.id)) as typeof canned;
    const result = await applyCannedMacro(conversation.id, row, owner.id);
    expect(result?.conversation?.status).toBe('resolved');
    expect(result?.conversation?.assigned_to).toBe(owner.id);
    expect(result?.tags).toEqual(['billing', 'refund']);

    await setCannedActions(canned.id, { snoozeHours: 4, assignTo: '' });
    const row2 = (await getDb().prepare('SELECT * FROM chat_canned_responses WHERE id = ?').get(canned.id)) as typeof canned;
    const snoozed = await applyCannedMacro(conversation.id, row2, owner.id);
    expect(snoozed?.conversation?.status).toBe('snoozed');
    expect(snoozed?.conversation?.assigned_to).toBeNull();
    const until = Date.parse(snoozed!.conversation!.snoozed_until!);
    expect(until - Date.now()).toBeGreaterThan(3.9 * 3_600_000);
  });

  it('no asigna a alguien fuera del workspace del widget ni aplica macros de otro widget', async () => {
    const { owner, widget, conversation } = await setup('macro2');
    const stranger = await makeUser('stranger');
    const canned = await createCannedResponse(widget.id, { shortcut: '/x', title: 'x', body: 'x' });
    await setCannedActions(canned.id, { assignTo: stranger.id });
    const row = (await getDb().prepare('SELECT * FROM chat_canned_responses WHERE id = ?').get(canned.id)) as typeof canned;
    await applyCannedMacro(conversation.id, row, owner.id);
    expect((await getChatConversation(conversation.id))?.assigned_to).toBeNull();

    const other = await setup('macro3');
    const foreign = await createCannedResponse(other.widget.id, { shortcut: '/y', title: 'y', body: 'y' });
    expect(await applyCannedMacro(conversation.id, foreign, owner.id)).toBeNull();
  });

  it('en un team asigna a un miembro', async () => {
    const owner = await makeUser('tmacro');
    const member = await makeUser('tmember');
    const team = await createTeam(owner.id, 'Soporte');
    await addMember(team.id, member.id, 'member');
    const widget = await createChatWidget(owner.id, team.id, { name: 'team widget' });
    const visitor = await getOrCreateChatVisitor(widget.id, `ext-${crypto.randomUUID()}`);
    const conversation = await createChatConversation(widget.id, visitor.id);
    const canned = await createCannedResponse(widget.id, { shortcut: '/esc', title: 'esc', body: 'Escalo' });
    await setCannedActions(canned.id, { assignTo: member.id, status: 'pending' });
    const row = (await getDb().prepare('SELECT * FROM chat_canned_responses WHERE id = ?').get(canned.id)) as typeof canned;
    const res = await applyCannedMacro(conversation.id, row, owner.id);
    expect(res?.conversation?.assigned_to).toBe(member.id);
    expect(res?.conversation?.status).toBe('pending');
  });
});

describe('Chat: reportes por rango', () => {
  it('parseReportRange: default 30 días, to inclusive, fechas inválidas', () => {
    const now = new Date('2026-10-13T15:00:00Z');
    const d = parseReportRange(null, null, now);
    expect(d.fromDate).toBe('2026-09-14');
    expect(d.toDate).toBe('2026-10-13');
    expect(d.to).toBe('2026-10-14T00:00:00.000Z');
    const custom = parseReportRange('2026-10-01', '2026-10-05', now);
    expect(custom.from).toBe('2026-10-01T00:00:00.000Z');
    expect(custom.to).toBe('2026-10-06T00:00:00.000Z');
    expect(parseReportRange('nope', '2026-10-05', now).fromDate).toBe('2026-09-06');
    expect(parseReportRange('2026-10-09', '2026-10-05', now).fromDate).toBe('2026-10-05');
  });

  it('cuenta solo conversaciones creadas en el rango, por agente', async () => {
    const { owner, widget, visitor } = await setup('report');
    const db = getDb();
    const mk = async (createdAt: string, opts: { assigned?: string | null; firstMin?: number; resolveMin?: number; csat?: number }) => {
      const c = await createChatConversation(widget.id, visitor.id);
      const created = Date.parse(createdAt);
      await db
        .prepare(
          'UPDATE chat_conversations SET created_at = ?, assigned_to = ?, first_response_at = ?, resolved_at = ?, csat_score = ? WHERE id = ?',
        )
        .run(
          createdAt,
          opts.assigned ?? null,
          opts.firstMin != null ? new Date(created + opts.firstMin * 60_000).toISOString() : null,
          opts.resolveMin != null ? new Date(created + opts.resolveMin * 60_000).toISOString() : null,
          opts.csat ?? null,
          c.id,
        );
    };
    await mk('2026-03-02T10:00:00.000Z', { assigned: owner.id, firstMin: 10, resolveMin: 60, csat: 5 });
    await mk('2026-03-03T23:59:00.000Z', { assigned: owner.id, firstMin: 20, csat: 3 });
    await mk('2026-03-04T08:00:00.000Z', { assigned: null });
    await mk('2026-02-28T10:00:00.000Z', { assigned: owner.id, firstMin: 999 }); // fuera
    await mk('2026-03-06T00:00:00.000Z', { assigned: owner.id }); // fuera (to exclusivo)

    const range = parseReportRange('2026-03-01', '2026-03-05');
    const report = await getChatRangeReport([widget.id], range);
    expect(report.totals.conversations).toBe(3);
    expect(report.totals.avgFirstResponseMinutes).toBe(15);
    expect(report.totals.avgResolutionMinutes).toBe(60);
    expect(report.totals.csatAverage).toBe(4);
    expect(report.agents.map((a) => [a.agentId, a.conversations])).toEqual([
      [owner.id, 2],
      [null, 1],
    ]);
    const csv = chatReportToCsv(report, { unassigned: 'Unassigned', total: 'Total' });
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('avg_first_response_min');
    expect(lines).toHaveLength(4);
    expect(lines[3]).toMatch(/^Total,,3,2,15,1,60,4,2$/);

    // Otro workspace: no suma nada.
    const other = await setup('report2');
    expect((await getChatRangeReport([other.widget.id], range)).totals.conversations).toBe(0);
  });

  it('el CSV neutraliza fórmulas', async () => {
    const csv = chatReportToCsv(
      {
        totals: { conversations: 0, firstResponseCount: 0, avgFirstResponseMinutes: null, resolvedCount: 0, avgResolutionMinutes: null, csatAverage: null, csatCount: 0 },
        agents: [
          { agentId: 'x', name: '=HYPERLINK("evil")', email: 'a@b.c', conversations: 1, firstResponseCount: 0, avgFirstResponseMinutes: null, resolvedCount: 0, avgResolutionMinutes: null, csatAverage: null, csatCount: 0 },
        ],
      },
      { unassigned: 'U', total: 'T' },
    );
    expect(csv.split('\n')[1].startsWith('"\'=HYPERLINK(""evil"")"')).toBe(true);
  });
});

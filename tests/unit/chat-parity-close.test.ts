import { describe, expect, it } from 'vitest';
import { canAccessWidget, listAccessibleChatWidgets, setWidgetAccess } from '@/lib/chat-access';
import { createChatConversation, createChatWidget, getChatWidget, getOrCreateChatVisitor, pickRoundRobinAgent, applyAssignmentRules, createAssignmentRule, type ChatAgent } from '@/lib/chat-data';
import { aggregateReport, weekStart } from '@/lib/chat-custom-reports';
import { cleanAudience, fillCampaignText, unsubscribeToken, verifyUnsubscribeToken, createCampaign, startCampaign, processChatCampaigns, getCampaign, unsubscribeVisitor } from '@/lib/chat-campaigns';
import { conversationCxScore, topTopics } from '@/lib/chat-insights';
import { importConversations, parseImport, stripHtml } from '@/lib/chat-import';
import { cleanVisitorAttributes, normalizeDomain } from '@/lib/chat-companies';
import { conversationFingerprint, inboxFingerprint } from '@/lib/chat-realtime';
import { createChatMessage } from '@/lib/chat-data';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';

const agent = (id: string): ChatAgent => ({ id, email: `${id}@x.io`, name: id, image: null, away: false });

async function setup() {
  const owner = await makeUser('owner');
  const widget = await createChatWidget(owner.id, null, { name: 'W' } as never);
  return { owner, widget };
}

describe('permisos por bandeja', () => {
  it('una bandeja restringida la ven admins y la lista, nadie más', async () => {
    const { owner, widget } = await setup();
    const allowed = await makeUser('in');
    const other = await makeUser('out');
    const as = (id: string, role: 'member' | 'admin') => ({ id: owner.id, actingUser: { id }, role });
    expect(await canAccessWidget(widget, as(other.id, 'member'))).toBe(true);
    await setWidgetAccess(widget.id, true, [allowed.id]);
    const w = (await getChatWidget(widget.id))!;
    expect(await canAccessWidget(w, as(allowed.id, 'member'))).toBe(true);
    expect(await canAccessWidget(w, as(other.id, 'member'))).toBe(false);
    expect(await canAccessWidget(w, as(other.id, 'admin'))).toBe(true);
    expect((await listAccessibleChatWidgets(as(other.id, 'member'))).map((x) => x.id)).not.toContain(w.id);
    expect((await listAccessibleChatWidgets(as(allowed.id, 'member'))).map((x) => x.id)).toContain(w.id);
    // Otro workspace no entra ni siendo admin.
    expect(await canAccessWidget(w, { id: other.id, role: 'admin' })).toBe(false);
  });

  it('las reglas no asignan a quien no ve la bandeja', async () => {
    const { owner, widget } = await setup();
    const a = await makeUser('a');
    const b = await makeUser('b');
    await setWidgetAccess(widget.id, true, [b.id]);
    await createAssignmentRule(widget.id, { name: 'rr', matchType: 'round_robin' });
    const v = await getOrCreateChatVisitor(widget.id, 'k1', {});
    const c = await createChatConversation(widget.id, v.id);
    expect(await applyAssignmentRules(widget.id, c.id, 'hola', [agent(a.id), agent(b.id)])).toBe(b.id);
    expect(owner.id).toBeTruthy();
  });
});

describe('ruteo por habilidad y carga', () => {
  it('la regla con habilidad reparte solo entre quienes la tienen', async () => {
    const { owner, widget } = await setup();
    const a = await makeUser('a');
    const b = await makeUser('b');
    await getDb().prepare('INSERT INTO chat_agent_routing (workspace_id, user_id, skills) VALUES (?, ?, ?)').run(owner.id, b.id, '["billing"]');
    await createAssignmentRule(widget.id, { name: 's', matchType: 'keyword', matchValue: 'factura', requiredSkill: 'Billing' });
    const v = await getOrCreateChatVisitor(widget.id, 'k2', {});
    const c = await createChatConversation(widget.id, v.id);
    expect(await applyAssignmentRules(widget.id, c.id, 'mi factura', [agent(a.id), agent(b.id)])).toBe(b.id);
  });

  it('quien llegó a su carga máxima no recibe más', async () => {
    const { owner, widget } = await setup();
    const a = await makeUser('a');
    const b = await makeUser('b');
    await getDb().prepare('INSERT INTO chat_agent_routing (workspace_id, user_id, capacity) VALUES (?, ?, 1)').run(owner.id, a.id);
    const v = await getOrCreateChatVisitor(widget.id, 'k3', {});
    const c1 = await createChatConversation(widget.id, v.id);
    await getDb().prepare('UPDATE chat_conversations SET assigned_to = ? WHERE id = ?').run(a.id, c1.id);
    const c2 = await createChatConversation(widget.id, v.id);
    expect(await pickRoundRobinAgent(widget.id, c2.id, [agent(a.id)])).toBeNull();
    expect(await pickRoundRobinAgent(widget.id, c2.id, [agent(a.id), agent(b.id)])).toBe(b.id);
  });
});

describe('reportes propios', () => {
  const base = { first_response_at: null, resolved_at: null, csat_score: null, status: 'open', priority: 'low', channel: null, widget_id: 'w', widget_name: 'W', team_id: null, team_name: null, assigned_to: null, assignee_name: null, company_id: null, company_name: null, tags: null, messages: 2 };
  it('agrupa por tag, día y calcula promedios', () => {
    const rows = [
      { ...base, id: '1', created_at: '2026-10-01T10:00:00.000Z', first_response_at: '2026-10-01T10:10:00.000Z', tags: 'a,b' },
      { ...base, id: '2', created_at: '2026-10-02T10:00:00.000Z', first_response_at: '2026-10-02T10:30:00.000Z', tags: 'a', resolved_at: '2026-10-02T11:00:00.000Z' },
    ];
    expect(aggregateReport(rows, 'conversations', 'tag')).toEqual([
      { key: 'a', label: 'a', value: 2, conversations: 2 },
      { key: 'b', label: 'b', value: 1, conversations: 1 },
    ]);
    expect(aggregateReport(rows, 'first_response', 'widget')[0].value).toBe(20);
    expect(aggregateReport(rows, 'resolution_rate', 'widget')[0].value).toBe(50);
    expect(aggregateReport(rows, 'messages', 'day').map((r) => r.key)).toEqual(['2026-10-01', '2026-10-02']);
  });
  it('la semana arranca el lunes', () => {
    expect(weekStart('2026-10-30T12:00:00.000Z')).toBe('2026-10-26');
    expect(weekStart('2026-10-26T00:00:00.000Z')).toBe('2026-10-26');
  });
});

describe('campañas', () => {
  it('el token de baja no se falsifica', () => {
    const t = unsubscribeToken('abc');
    expect(verifyUnsubscribeToken(t)).toBe('abc');
    expect(verifyUnsubscribeToken(`xyz.${t.split('.')[1]}`)).toBeNull();
    expect(verifyUnsubscribeToken('nada')).toBeNull();
  });
  it('variables y audiencia', () => {
    expect(fillCampaignText('Hola {{first_name|che}} ({{email}})', { name: 'Ana Pérez', email: 'a@x.io' })).toBe('Hola Ana (a@x.io)');
    expect(fillCampaignText('Hola {{first_name|che}}', { name: null, email: 'a@x.io' })).toBe('Hola che');
    expect(cleanAudience('company:abc')).toBe('company:abc');
    expect(() => cleanAudience('x; DROP')).toThrow();
  });
  it('manda una vez por email, saltea bajas y dos corridas no duplican', async () => {
    const { owner, widget } = await setup();
    const a = await getOrCreateChatVisitor(widget.id, 'c1', { email: 'one@x.io', name: 'One' });
    await getOrCreateChatVisitor(widget.id, 'c2', { email: 'ONE@x.io' });
    const out = await getOrCreateChatVisitor(widget.id, 'c3', { email: 'out@x.io' });
    await getOrCreateChatVisitor(widget.id, 'c4', {});
    await unsubscribeVisitor(out.id);
    const c = await createCampaign(owner.id, owner.id, { name: 'Novedades', subject: 'Hola', body: 'Texto', widget_id: widget.id });
    await expect(startCampaign(owner.id, (await createCampaign(owner.id, owner.id, { name: 'vacía', widget_id: widget.id })).id)).rejects.toThrow('missing_body');
    const started = await startCampaign(owner.id, c.id);
    expect(started.total).toBe(1);
    await expect(startCampaign(owner.id, c.id)).rejects.toThrow('already_sent');
    const [r1, r2] = await Promise.all([processChatCampaigns({ campaignId: c.id }), processChatCampaigns({ campaignId: c.id })]);
    expect(r1.sent + r2.sent).toBe(1);
    const done = await getCampaign(owner.id, c.id);
    expect(done?.status).toBe('sent');
    expect(done?.sent).toBe(1);
    expect(a.id).toBeTruthy();
  });
});

describe('importar', () => {
  const intercom = {
    id: '123',
    created_at: 1700000000,
    state: 'closed',
    source: { body: '<p>Hola &amp; chau</p>', subject: 'Ayuda', author: { type: 'user', email: 'Ana@x.io', name: 'Ana' } },
    conversation_parts: {
      conversation_parts: [
        { part_type: 'comment', body: '<p>Respuesta</p>', created_at: 1700000100, author: { type: 'admin' } },
        { part_type: 'note', body: 'interna', created_at: 1700000200, author: { type: 'admin' } },
        { part_type: 'assignment', body: null, created_at: 1700000300, author: { type: 'admin' } },
      ],
    },
  };
  const crisp = {
    session_id: 'session_1',
    state: 'pending',
    created_at: 1700000000000,
    meta: { email: 'b@x.io', nickname: 'Beto' },
    messages: [
      { type: 'text', from: 'user', content: 'Hola', timestamp: 1700000000000 },
      { type: 'text', from: 'operator', content: 'Buenas', timestamp: 1700000001000 },
      { type: 'file', from: 'user', content: { url: 'x' }, timestamp: 1700000002000 },
    ],
  };
  it('entiende Intercom y Crisp y deja afuera las notas', () => {
    const [a, b] = parseImport({ conversations: [intercom, crisp, { foo: 1 }] });
    expect(a.messages.map((m) => [m.sender, m.body])).toEqual([['visitor', 'Hola & chau'], ['user', 'Respuesta']]);
    expect(a.open).toBe(false);
    expect(b.messages).toHaveLength(2);
    expect(b.open).toBe(true);
    expect(stripHtml('<b>x</b><br>y')).toBe('x\ny');
  });
  it('importar dos veces no duplica', async () => {
    const { widget } = await setup();
    const list = parseImport([intercom, crisp]);
    expect(await importConversations(widget.id, list)).toEqual({ imported: 2, skipped: 0, messages: 4 });
    expect(await importConversations(widget.id, list)).toEqual({ imported: 0, skipped: 2, messages: 0 });
  });
});

describe('insights, empresas y tiempo real', () => {
  it('CX score: CSAT manda, si no velocidad y resolución', () => {
    expect(conversationCxScore({ firstResponseMinutes: 1, resolved: false, csat: 5 })).toBe(100);
    expect(conversationCxScore({ firstResponseMinutes: 3, resolved: true, csat: null })).toBe(100);
    expect(conversationCxScore({ firstResponseMinutes: null, resolved: false, csat: null })).toBe(20);
  });
  it('temas: por conversación, sin palabras vacías', () => {
    const topics = topTopics(['problema con factura factura', 'mi factura no llega', 'hola']);
    expect(topics[0]).toEqual({ term: 'factura', conversations: 2 });
  });
  it('dominio y atributos limpios', () => {
    expect(normalizeDomain('https://www.Acme.com/x')).toBe('acme.com');
    expect(normalizeDomain('no es')).toBeNull();
    expect(cleanVisitorAttributes({ plan: 'pro', n: 3, x: {}, '': 'a' })).toEqual({ plan: 'pro', n: '3' });
    expect(() => cleanVisitorAttributes([])).toThrow();
  });
  it('la huella cambia con un mensaje nuevo', async () => {
    const { widget } = await setup();
    const v = await getOrCreateChatVisitor(widget.id, 'k9', {});
    const c = await createChatConversation(widget.id, v.id);
    const before = await conversationFingerprint(c.id);
    expect(await conversationFingerprint(c.id)).toBe(before);
    await createChatMessage(c.id, 'visitor', { body: 'hola' });
    expect(await conversationFingerprint(c.id)).not.toBe(before);
    expect(await inboxFingerprint([widget.id])).toContain('1|');
    expect(await inboxFingerprint([])).toBe('');
  });
});

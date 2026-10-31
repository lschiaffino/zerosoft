import { describe, expect, it, vi } from 'vitest';
import { canAccessWidget, getApiConversation, listAccessibleChatWidgets, setWidgetAccess } from '@/lib/chat-access';
import { createChatConversation, createChatWidget, getChatWidget, getOrCreateChatVisitor, pickRoundRobinAgent, applyAssignmentRules, createAssignmentRule, type ChatAgent } from '@/lib/chat-data';
import { aggregateReport, weekStart } from '@/lib/chat-custom-reports';
import { campaignCap, campaignPending, deleteCampaign, isRetryableSend, cleanAudience, fillCampaignText, unsubscribeToken, verifyUnsubscribeToken, createCampaign, startCampaign, processChatCampaigns, getCampaign, unsubscribeVisitor } from '@/lib/chat-campaigns';
import { conversationCxScore, topTopics } from '@/lib/chat-insights';
import { cleanImportEmail, importConversations, parseImport, stripHtml } from '@/lib/chat-import';
import { cleanVisitorAttributes, normalizeDomain, setCampaignOptIn } from '@/lib/chat-companies';
import { filterBatch, pruneChatEvents } from '@/lib/chat-realtime';
import { createChatMessage } from '@/lib/chat-data';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';

const sendMock = vi.hoisted(() => ({ fail: null as null | { ok: false; status?: number; error?: string } }));
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<typeof import('@/lib/email')>()),
  sendEmail: async () => sendMock.fail ?? { ok: true },
}));

const agent = (id: string): ChatAgent => ({ id, email: `${id}@x.io`, name: id, image: null, away: false });

async function seedConversation(widgetId: string) {
  const v = await getOrCreateChatVisitor(widgetId, `s-${crypto.randomUUID()}`, {});
  return createChatConversation(widgetId, v.id);
}

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
    // Key de un miembro: mismo criterio que la sesión.
    expect(await getApiConversation({ user: owner, personId: other.id, role: 'member' }, (await seedConversation(w.id)).id)).toBeNull();
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

describe('carga por persona', () => {
  it('cuenta las abiertas de todos los widgets del workspace', async () => {
    const { owner, widget } = await setup();
    const other = await createChatWidget(owner.id, null, { name: 'W2' } as never);
    const a = await makeUser('a');
    await getDb().prepare('INSERT INTO chat_agent_routing (workspace_id, user_id, capacity) VALUES (?, ?, 1)').run(owner.id, a.id);
    const v = await getOrCreateChatVisitor(other.id, 'k5', {});
    const open = await createChatConversation(other.id, v.id);
    await getDb().prepare('UPDATE chat_conversations SET assigned_to = ? WHERE id = ?').run(a.id, open.id);
    const v2 = await getOrCreateChatVisitor(widget.id, 'k6', {});
    const c = await createChatConversation(widget.id, v2.id);
    expect(await pickRoundRobinAgent(widget.id, c.id, [agent(a.id)])).toBeNull();
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
    const b = await getOrCreateChatVisitor(widget.id, 'c2', { email: 'ONE@x.io' });
    const out = await getOrCreateChatVisitor(widget.id, 'c3', { email: 'out@x.io' });
    await getOrCreateChatVisitor(widget.id, 'c4', {});
    // Sin consentimiento no entra; este no lo tiene.
    await getOrCreateChatVisitor(widget.id, 'c5', { email: 'nooptin@x.io' });
    for (const v of [a, b, out]) await setCampaignOptIn(v.id, true);
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

describe('envío con reintentos', () => {
  it('429 y 5xx se reintentan; 4xx no', () => {
    expect(isRetryableSend({ status: 429 })).toBe(true);
    expect(isRetryableSend({ status: 503 })).toBe(true);
    expect(isRetryableSend({})).toBe(true);
    expect(isRetryableSend({ status: 422 })).toBe(false);
  });
  it('un error transitorio deja al destinatario pendiente con espera y sin duplicar', async () => {
    const { owner, widget } = await setup();
    await getDb().prepare("UPDATE users SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(owner.id);
    await setCampaignOptIn((await getOrCreateChatVisitor(widget.id, 'r1', { email: 'r1@x.io' })).id, true);
    const c = await createCampaign(owner.id, owner.id, { name: 'R', subject: 'S', body: 'B', widget_id: widget.id });
    await startCampaign(owner.id, c.id);
    sendMock.fail = { ok: false, status: 503, error: 'x' };
    expect((await processChatCampaigns({ campaignId: c.id, gapMs: 0 })).retried).toBe(1);
    // Todavía en espera: la próxima corrida no lo toca.
    sendMock.fail = null;
    expect((await processChatCampaigns({ campaignId: c.id, gapMs: 0 })).sent).toBe(0);
    expect((await getCampaign(owner.id, c.id))?.status).toBe('sending');
    await getDb().prepare('UPDATE chat_campaign_recipients SET next_attempt_at = NULL WHERE campaign_id = ?').run(c.id);
    expect((await processChatCampaigns({ campaignId: c.id, gapMs: 0 })).sent).toBe(1);
    expect((await getCampaign(owner.id, c.id))?.status).toBe('sent');
  });
  it('el tope manda hasta el cupo, deja el resto pendiente, y borrar no libera', async () => {
    const { owner, widget } = await setup();
    expect((await campaignCap(owner.id)).limit).toBe(50);
    await getDb().prepare("UPDATE users SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(owner.id);
    expect((await campaignCap(owner.id)).limit).toBe(500);
    await getDb().prepare("UPDATE users SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(owner.id);
    expect((await campaignCap(owner.id)).limit).toBe(500);
    const day = new Date().toISOString().slice(0, 10);
    await getDb().prepare('INSERT INTO chat_campaign_usage (workspace_id, day, used) VALUES (?, ?, 499)').run(owner.id, day);
    for (const k of ['a', 'b', 'c']) await setCampaignOptIn((await getOrCreateChatVisitor(widget.id, `t${k}`, { email: `${k}@x.io` })).id, true);
    const c = await createCampaign(owner.id, owner.id, { name: 'X', subject: 'S', body: 'B', widget_id: widget.id });
    await startCampaign(owner.id, c.id);
    expect((await processChatCampaigns({ campaignId: c.id, gapMs: 0 })).sent).toBe(1);
    expect((await processChatCampaigns({ campaignId: c.id, gapMs: 0 })).sent).toBe(0);
    const after = (await getCampaign(owner.id, c.id))!;
    expect(after.status).toBe('sending');
    expect(after.sent).toBe(1);
    expect(await campaignPending(c.id)).toBe(2);
    expect((await campaignCap(owner.id)).remaining).toBe(0);
    await deleteCampaign(owner.id, c.id);
    expect((await campaignCap(owner.id)).remaining).toBe(0);
    // Al día siguiente sigue.
    const next = new Date(Date.now() + 86_400_000);
    expect((await campaignCap(owner.id, next)).remaining).toBe(500);
  });
  it('una campaña de otro workspace sin cupo no le ocupa el lote a los demás', async () => {
    const full = await setup();
    await getDb().prepare('INSERT INTO chat_campaign_usage (workspace_id, day, used) VALUES (?, ?, 50)').run(full.owner.id, new Date().toISOString().slice(0, 10));
    await setCampaignOptIn((await getOrCreateChatVisitor(full.widget.id, 'f', { email: 'f@x.io' })).id, true);
    await startCampaign(full.owner.id, (await createCampaign(full.owner.id, full.owner.id, { name: 'F', subject: 'S', body: 'B', widget_id: full.widget.id })).id);
    const free = await setup();
    await setCampaignOptIn((await getOrCreateChatVisitor(free.widget.id, 'g', { email: 'g@x.io' })).id, true);
    const c = await createCampaign(free.owner.id, free.owner.id, { name: 'G', subject: 'S', body: 'B', widget_id: free.widget.id });
    await startCampaign(free.owner.id, c.id);
    expect((await processChatCampaigns({ limit: 1, gapMs: 0 })).sent).toBe(1);
    expect((await getCampaign(free.owner.id, c.id))?.sent).toBe(1);
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
  it('no explota con basura: timestamp enorme, id objeto, session_id largo, email inválido', () => {
    const parsed = parseImport([
      { id: 'a1', created_at: 1e20, source: { body: 'x', author: { type: 'user', email: 'not an email <script>' } } },
      { id: { o: 1 }, source: { body: 'x', author: { type: 'user' } } },
      { session_id: 'y'.repeat(500), messages: [{ type: 'text', from: 'user', content: 'x' }] },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].email).toBeNull();
    expect(cleanImportEmail('ana@x.io')).toBe('ana@x.io');
  });
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
    expect(await importConversations(widget.id, list)).toEqual({ imported: 2, skipped: 0, failed: 0, messages: 4 });
    expect(await importConversations(widget.id, list)).toEqual({ imported: 0, skipped: 2, failed: 0, messages: 0 });
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
  it('los triggers anotan cada cambio y el filtro deja una vez por conversación', async () => {
    const { widget } = await setup();
    const v = await getOrCreateChatVisitor(widget.id, 'k9', {});
    const c = await createChatConversation(widget.id, v.id);
    const count = async () => Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM chat_events WHERE conversation_id = ?').get(c.id)) as { n: number }).n);
    const before = await count();
    await createChatMessage(c.id, 'visitor', { body: 'hola' });
    expect(await count()).toBeGreaterThan(before);
    const rows = [
      { id: 1, conversation_id: 'a', widget_id: 'w' },
      { id: 2, conversation_id: 'a', widget_id: 'w' },
      { id: 3, conversation_id: 'b', widget_id: 'x' },
    ];
    expect(filterBatch(rows, (e) => e.widget_id === 'w')).toEqual([{ id: 2, conversationId: 'a' }]);
    expect(await pruneChatEvents(new Date(Date.now() + 7_200_000))).toBeGreaterThan(0);
  });
});

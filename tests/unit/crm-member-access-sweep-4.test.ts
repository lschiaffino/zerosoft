/**
 * CRM, cuarta pasada: el número de tareas de la sidebar cuenta solo las
 * tareas que la persona puede abrir; una vista de tareas compartida no lleva
 * el id de una cola que quien mira no ve (y no se puede guardar una así);
 * task.*, email.* y quote.* salen con el acceso de quien creó la suscripción;
 * y el paso de IA de un workflow arma su contexto con lo que ve cualquiera
 * que pueda abrir el registro. Miradas: owner, admin, miembro con "mine",
 * miembro de un equipo de ventas y otro workspace. Datos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { MockLanguageModelV4 } from 'ai/test';
import { countDueTasks, createActivity, createCompany, createContact, createCustomField, createDeal, createPipeline, createStage, updateActivity } from '@/lib/crm';
import { MEMBER_SUBJECT, setFieldPermissions } from '@/lib/crm-field-perms';
import { createSalesTeam, ownerScopeFor, setMemberVisibility } from '@/lib/crm-visibility';
import { crmPersonalizer, deliveryPayloadFor } from '@/lib/crm-event-privacy';
import { createQueue } from '@/lib/crm-task-queues';
import { createView, sessionViewViewer } from '@/lib/crm-views';
import { createWorkflow, runWorkflowsForEvent } from '@/lib/crm-workflows';
import { setAiModelOverride } from '@/lib/ai';
import { addMember, setMemberRole } from '@/lib/teams';
import { getDb } from '@/lib/db';
import { seal } from '@/lib/secret-box';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const dueCountRoute = await import('@/app/api/crm/tasks/due-count/route');
const viewsRoute = await import('@/app/api/crm/views/route');
const viewRoute = await import('@/lib/routes/crm/views/[id]/route');

beforeEach(() => {
  session.user = null;
});
afterEach(() => {
  setAiModelOverride(null);
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async <T,>(res: Response) => (await res.json()) as T;
const PAST = '2020-01-02 10:00:00';

/**
 * Workspace con un admin de verdad, `secret` (contactos, empresas, deals)
 * oculto para el rol member, un equipo de ventas con `friend` y visibilidad
 * "mine". Un contacto de cada persona y uno del owner.
 */
async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  const adminPerson = await makeUser(`${label}-admin`);
  await addMember(w.team.id, adminPerson.id, 'admin');
  await setMemberVisibility(ws, 'mine');
  for (const entity of ['contacts', 'companies', 'deals']) {
    const f = await createCustomField(ws, { entity, name: 'secret', label: 'Secret', type: 'text' });
    await setFieldPermissions(ws, f.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
  }
  const team = await createSalesTeam(ws, { name: 'Field', members: [w.friend.id] });
  const memberContact = await createContact(ws, { firstName: 'Zeta', lastName: 'Member', ownerId: w.member.id, custom: { secret: 'mc-secret' } });
  const friendContact = await createContact(ws, { firstName: 'Zeta', lastName: 'Friend', ownerId: w.friend.id });
  const ownerContact = await createContact(ws, { firstName: 'Hidden', lastName: 'Person', ownerId: ws });
  return { w, ws, adminPerson, team, memberContact, friendContact, ownerContact };
}

type Setup = Awaited<ReturnType<typeof setup>>;
const owner = (s: Setup) => asOwner(s.w.owner);
const admin = (s: Setup) => asMember(s.w.owner, s.adminPerson, 'admin');
const member = (s: Setup) => asMember(s.w.owner, s.w.member);
const teamMember = (s: Setup) => asMember(s.w.owner, s.w.friend);
const stranger = (s: Setup) => asOwner(s.w.stranger);

async function dueCount(user: SessionUser): Promise<number> {
  session.user = user;
  const res = await dueCountRoute.GET();
  expect(res.status).toBe(200);
  return (await json<{ count: number }>(res)).count;
}

// ---------- 1. Número de tareas de la sidebar ----------

describe('número de tareas vencidas (sidebar)', () => {
  it('cuenta solo las tareas que la persona puede abrir, como el índice de Tareas', async () => {
    const s = await setup('p4-due');
    const task = (contactId: string | null, ownerId: string | null, subject: string) =>
      createActivity(s.ws, { type: 'task', subject, dueAt: PAST, contactId, ownerId });
    await task(s.memberContact.id, s.w.member.id, 'Call back');
    await task(s.ownerContact.id, s.w.member.id, 'Owner record task');
    await task(s.friendContact.id, s.w.friend.id, 'Friend task');
    await task(null, s.w.member.id, 'Loose member task');
    await task(null, s.ws, 'Loose owner task');
    // Una tarea hecha no cuenta para nadie.
    const done = await task(s.memberContact.id, s.w.member.id, 'Done');
    await updateActivity(s.ws, done.id, { done: true });

    expect(await dueCount(owner(s))).toBe(5);
    expect(await dueCount(admin(s))).toBe(5);
    // "mine": su contacto y su tarea suelta; no la de un registro del owner aunque la tarea sea suya.
    expect(await dueCount(member(s))).toBe(2);
    expect(await dueCount(teamMember(s))).toBe(1);
    expect(await dueCount(stranger(s))).toBe(0);

    // Con "equipo", el miembro que entra al equipo de ventas ve también lo de su compañero.
    await setMemberVisibility(s.ws, 'team');
    const { setSalesTeamMembers } = await import('@/lib/crm-visibility');
    await setSalesTeamMembers(s.ws, s.team.id, [s.w.friend.id, s.w.member.id]);
    expect(await dueCount(member(s))).toBe(3);
    expect(await dueCount(teamMember(s))).toBe(3);

    // Sin alcance (llamada interna de un admin) cuenta todo; sin sesión, 401.
    expect(await countDueTasks(s.ws, null)).toBe(5);
    expect(await countDueTasks(s.ws, await ownerScopeFor({ workspaceId: s.ws, personId: s.w.friend.id, role: 'member' }))).toBe(3);
    session.user = null;
    expect((await dueCountRoute.GET()).status).toBe(401);
  });
});

// ---------- 2. Vistas de tareas con una cola privada ----------

describe('vistas de tareas y colas privadas', () => {
  it('quien no ve la cola recibe la vista sin ese filtro; guardar una cola ajena se rechaza', async () => {
    const s = await setup('p4-views');
    const mineQ = await createQueue({ workspaceId: s.ws, personId: s.w.member.id, role: 'member' }, { name: 'Morning calls' });
    const sharedQ = await createQueue({ workspaceId: s.ws, personId: s.ws, role: 'owner' }, { name: 'Team calls', shared: true });
    if (!mineQ.ok || !sharedQ.ok) throw new Error('queue');

    // El miembro comparte con todos una vista filtrada por su cola privada (la ve, se guarda).
    session.user = member(s);
    let res = await viewsRoute.POST(
      new NextRequest('http://x/api/crm/views', {
        method: 'POST',
        body: JSON.stringify({ entity: 'tasks', name: 'My queue', visibility: 'everyone', query: { queue: mineQ.queue.id, bucket: 'today' } }),
      }),
    );
    expect(res.status).toBe(201);
    const view = await json<{ id: string; query: Record<string, string>; partial: boolean }>(res);
    expect(view.query.queue).toBe(mineQ.queue.id);
    expect(view.partial).toBe(false);
    const shared = await createView(await sessionViewViewer(owner(s)), {
      entity: 'tasks',
      name: 'Team queue',
      visibility: 'everyone',
      query: { queue: sharedQ.queue.id },
    });
    if (!shared.ok) throw new Error('view');

    const list = async (user: SessionUser) => {
      session.user = user;
      const r = await viewsRoute.GET(new NextRequest('http://x/api/crm/views?entity=tasks'));
      return (await json<{ rows: Array<{ id: string; query: Record<string, string>; partial: boolean }> }>(r)).rows;
    };
    for (const user of [owner(s), admin(s), teamMember(s)]) {
      const rows = await list(user);
      const mine = rows.find((r) => r.id === view.id)!;
      expect(mine.query).toEqual({ bucket: 'today' });
      expect(mine.partial).toBe(true);
      expect(JSON.stringify(rows)).not.toContain(mineQ.queue.id);
      // La cola compartida sí la ve todo el workspace.
      expect(rows.find((r) => r.id === shared.view.id)!.query.queue).toBe(sharedQ.queue.id);
      // Por id, igual.
      const one = await json<{ query: Record<string, string> }>(await viewRoute.GET(new NextRequest('http://x'), ctx(view.id)));
      expect(one.query.queue).toBeUndefined();
    }
    expect((await list(member(s))).find((r) => r.id === view.id)!.query.queue).toBe(mineQ.queue.id);
    expect(await list(stranger(s))).toEqual([]);

    // Guardar una vista (nueva o editada) con una cola que quien guarda no ve: 400, nada guardado.
    session.user = teamMember(s);
    res = await viewsRoute.POST(
      new NextRequest('http://x/api/crm/views', { method: 'POST', body: JSON.stringify({ entity: 'tasks', name: 'Peek', query: { queue: mineQ.queue.id } }) }),
    );
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toBe('invalid_queue');
    const before = (await getDb().prepare('SELECT COUNT(*) AS c FROM crm_saved_views WHERE user_id = ?').get(s.ws)) as { c: number };
    expect(Number(before.c)).toBe(2);
    session.user = owner(s);
    res = await viewRoute.PATCH(
      new NextRequest('http://x', { method: 'PATCH', body: JSON.stringify({ query: { queue: mineQ.queue.id } }) }),
      ctx(shared.view.id),
    );
    expect(res.status).toBe(400);
    // Un admin no reescribe la vista que filtra por una cola que no ve (borraría el filtro sin verlo); renombrarla sí.
    res = await viewRoute.PATCH(new NextRequest('http://x', { method: 'PATCH', body: JSON.stringify({ query: { bucket: 'all' } }) }), ctx(view.id));
    expect(res.status).toBe(403);
    res = await viewRoute.PATCH(new NextRequest('http://x', { method: 'PATCH', body: JSON.stringify({ name: 'Renamed' }) }), ctx(view.id));
    expect(res.status).toBe(200);
    const stored = (await getDb().prepare('SELECT query FROM crm_saved_views WHERE id = ?').get(view.id)) as { query: string };
    expect(JSON.parse(stored.query).queue).toBe(mineQ.queue.id);
  });
});

// ---------- 3. task.*, email.*, quote.* ----------

async function hook(userId: string, createdBy: string | null, events: string[]): Promise<string> {
  const id = crypto.randomUUID();
  await getDb()
    .prepare('INSERT INTO webhooks (id, user_id, url, events, secret, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, 'https://127.0.0.1/hook', JSON.stringify(events), seal('whsec_test'), createdBy);
  return id;
}

async function deliveries(hookId: string): Promise<Array<{ event: string; body: Record<string, unknown> }>> {
  const rows = (await getDb()
    .prepare('SELECT event, payload FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at, rowid')
    .all(hookId)) as Array<{ event: string; payload: string }>;
  return rows.map((r) => ({ event: r.event, body: JSON.parse(r.payload) as Record<string, unknown> }));
}

async function hooksFor(s: Setup, events: string[]) {
  return {
    owner: await hook(s.ws, s.ws, events),
    admin: await hook(s.ws, s.adminPerson.id, events),
    member: await hook(s.ws, s.w.member.id, events),
    team: await hook(s.ws, s.w.friend.id, events),
    stranger: await hook(s.ws, s.w.stranger.id, events),
    legacy: await hook(s.ws, null, events),
  };
}

const subjects = async (hookId: string) =>
  (await deliveries(hookId)).map((d) => `${d.event}:${((d.body.data as { task: { subject: string } }).task).subject}`).sort();

describe('task.*, email.* y quote.* con el acceso de quien creó la suscripción', () => {
  it('task.created y task.completed: solo las tareas que ve, también al reenviar', async () => {
    const s = await setup('p4-task');
    const h = await hooksFor(s, ['task.created', 'task.completed']);
    const mine = await createActivity(s.ws, { type: 'task', subject: 'Member task', contactId: s.memberContact.id, ownerId: s.w.member.id });
    await createActivity(s.ws, { type: 'task', subject: 'Owner record task', contactId: s.ownerContact.id, ownerId: s.w.member.id });
    await createActivity(s.ws, { type: 'task', subject: 'Friend task', contactId: s.friendContact.id, ownerId: s.w.friend.id });
    await updateActivity(s.ws, mine.id, { done: true });

    const all = ['task.completed:Member task', 'task.created:Friend task', 'task.created:Member task', 'task.created:Owner record task'];
    expect(await subjects(h.owner)).toEqual(all);
    expect(await subjects(h.admin)).toEqual(all);
    expect(await subjects(h.member)).toEqual(['task.completed:Member task', 'task.created:Member task']);
    expect(await subjects(h.team)).toEqual(['task.created:Friend task']);
    expect(await deliveries(h.stranger)).toEqual([]);
    expect(await deliveries(h.legacy)).toEqual([]);

    // Al reenviar, con el acceso de hoy: el admin que pasó a miembro con "mine" ya no recibe la tarea del miembro.
    const [created] = (await deliveries(h.admin)).filter((d) => d.event === 'task.created');
    const body = JSON.stringify(created.body);
    expect(await deliveryPayloadFor(s.ws, s.adminPerson.id, 'task.created', body)).toBe(body);
    await setMemberRole(s.w.team.id, s.adminPerson.id, 'member');
    expect(await deliveryPayloadFor(s.ws, s.adminPerson.id, 'task.created', body)).toBeNull();
    expect(await deliveryPayloadFor(s.ws, s.w.member.id, 'task.created', body)).toBe(body);
  });

  it('task.due (flows): con el alcance de quien creó el flow', async () => {
    const s = await setup('p4-task-due');
    const t = await createActivity(s.ws, { type: 'task', subject: 'Owner due', contactId: s.ownerContact.id, dueAt: PAST });
    const { taskEventPayload } = await import('@/lib/crm');
    const p = crmPersonalizer(s.ws, 'task.due', taskEventPayload(t));
    expect((await p(s.ws))?.data).toEqual(taskEventPayload(t));
    expect((await p(s.adminPerson.id))?.data).toEqual(taskEventPayload(t));
    expect(await p(s.w.member.id)).toBeNull();
    expect(await p(s.w.friend.id)).toBeNull();
    expect(await p(s.w.stranger.id)).toBeNull();
    expect(await p(null)).toBeNull();
  });

  it('email.*: solo si ve algún contacto del email, y solo con los contactos que ve', async () => {
    const s = await setup('p4-email');
    const received = {
      email: { id: crypto.randomUUID(), subject: 'Re: proposal', from: 'someone@example.test', threadId: 't-1' },
      contactIds: [s.memberContact.id, s.ownerContact.id],
    };
    const p = crmPersonalizer(s.ws, 'email.received', received);
    expect((await p(s.ws))?.data).toEqual(received);
    expect((await p(s.adminPerson.id))?.data).toEqual(received);
    expect((await p(s.w.member.id))?.data).toEqual({ ...received, contactIds: [s.memberContact.id] });
    expect(await p(s.w.friend.id)).toBeNull();
    expect(await p(s.w.stranger.id)).toBeNull();
    expect(await p(null)).toBeNull();

    const sent = { email: { id: crypto.randomUUID(), subject: 'Proposal', to: 'x@example.test', threadId: 't-2' }, contactId: s.ownerContact.id, sequence: null };
    for (const event of ['email.sent', 'email.opened', 'email.clicked']) {
      const q = crmPersonalizer(s.ws, event, sent);
      expect((await q(s.ws))?.data).toEqual(sent);
      expect(await q(s.w.member.id)).toBeNull();
      expect(await q(s.w.friend.id)).toBeNull();
    }
    // Un email de varios contactos guardado en la base: alcanza con ver uno; el que no ve sale vacío.
    const emailId = crypto.randomUUID();
    await getDb()
      .prepare('INSERT INTO crm_emails (id, user_id, contact_id, gmail_id) VALUES (?, ?, ?, ?)')
      .run(emailId, s.ws, s.ownerContact.id, `g-${emailId}`);
    for (const c of [s.ownerContact.id, s.friendContact.id]) {
      await getDb().prepare('INSERT INTO crm_email_contacts (email_id, contact_id, user_id) VALUES (?, ?, ?)').run(emailId, c, s.ws);
    }
    const linked = { email: { id: emailId, subject: 'Hi', to: 'x@example.test', threadId: 't-3' }, contactId: s.ownerContact.id, sequence: null };
    const r = crmPersonalizer(s.ws, 'email.sent', linked);
    expect((await r(s.w.friend.id))?.data).toEqual({ ...linked, contactId: null });
    expect(await r(s.w.member.id)).toBeNull();
  });

  it('quote.*: solo si ve el deal del quote', async () => {
    const s = await setup('p4-quote');
    const pl = await createPipeline(s.ws, 'Sales');
    const stage = (await createStage(s.ws, pl.id, { name: 'Open' }))!;
    const memberDeal = await createDeal(s.ws, { name: 'Member deal', pipelineId: pl.id, stageId: stage.id, ownerId: s.w.member.id });
    const ownerDeal = await createDeal(s.ws, { name: 'Owner deal', pipelineId: pl.id, stageId: stage.id, ownerId: s.ws });
    if (!memberDeal.ok || !ownerDeal.ok) throw new Error('deal');
    const quote = (dealId: string, name: string) => ({ id: crypto.randomUUID(), number: 'Q-1', title: 'Plan', total: 100, currency: 'USD', dealId, dealName: name });
    for (const event of ['quote.accepted', 'quote.paid']) {
      const theirs = crmPersonalizer(s.ws, event, quote(ownerDeal.deal.id, 'Owner deal'));
      expect(await theirs(s.ws)).not.toBeNull();
      expect(await theirs(s.adminPerson.id)).not.toBeNull();
      expect(await theirs(s.w.member.id)).toBeNull();
      expect(await theirs(s.w.friend.id)).toBeNull();
      expect(await theirs(s.w.stranger.id)).toBeNull();
      const own = quote(memberDeal.deal.id, 'Member deal');
      expect((await crmPersonalizer(s.ws, event, own)(s.w.member.id))?.data).toEqual(own);
    }
    // Reenvío de un quote.paid guardado: el mismo criterio.
    const body = JSON.stringify({ id: 'evt', type: 'quote.paid', data: quote(ownerDeal.deal.id, 'Owner deal') });
    expect(await deliveryPayloadFor(s.ws, s.ws, 'quote.paid', body)).toBe(body);
    expect(await deliveryPayloadFor(s.ws, s.w.member.id, 'quote.paid', body)).toBeNull();
  });
});

// ---------- 4. Paso de IA de un workflow ----------

/** Modelo que devuelve el prompt que recibió: la nota muestra exactamente el contexto. */
function echoModel() {
  return new MockLanguageModelV4({
    modelId: 'echo',
    doGenerate: async (opts) => ({
      content: [{ type: 'text', text: JSON.stringify(opts.prompt) }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 5, text: 5, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

describe('paso de IA de un workflow', () => {
  it('el contexto es lo que ve cualquiera que abre el registro: sin asociados de otro owner ni campos propios', async () => {
    const s = await setup('p4-ai');
    const pl = await createPipeline(s.ws, 'Sales');
    const stage = (await createStage(s.ws, pl.id, { name: 'Open' }))!;
    await createDeal(s.ws, { name: 'Member visible deal', pipelineId: pl.id, stageId: stage.id, ownerId: s.w.member.id, contactIds: [s.memberContact.id] });
    await createDeal(s.ws, {
      name: 'Owner only deal',
      pipelineId: pl.id,
      stageId: stage.id,
      ownerId: s.ws,
      contactIds: [s.memberContact.id],
      custom: { secret: 'deal-secret' },
    });
    const co = await createCompany(s.ws, { name: 'Owner only company', ownerId: s.ws, custom: { secret: 'co-secret' } });
    await createActivity(s.ws, { type: 'note', body: 'Owner side note', contactId: s.memberContact.id, companyId: co.id });
    await createActivity(s.ws, { type: 'note', body: 'Member note', contactId: s.memberContact.id });
    await createWorkflow(s.ws, {
      name: 'Classify',
      triggers: [{ type: 'manual' }],
      actions: [{ type: 'ai_step', config: { mode: 'prompt', prompt: 'Classify this lead', output: 'note' } }],
    });
    setAiModelOverride(echoModel());

    const lastNote = async () =>
      ((await getDb()
        .prepare("SELECT body FROM crm_activities WHERE user_id = ? AND contact_id = ? AND type = 'note' AND subject = 'AI' ORDER BY created_at DESC, rowid DESC LIMIT 1")
        .get(s.ws, s.memberContact.id)) as { body: string }).body;

    await runWorkflowsForEvent(s.ws, { type: 'manual', entity: 'contact', entityId: s.memberContact.id });
    const note = await lastNote();
    expect(note).toContain('Zeta Member');
    expect(note).toContain('Member visible deal');
    expect(note).toContain('Member note');
    for (const hidden of ['Owner only deal', 'Owner only company', 'Owner side note', 'mc-secret', 'deal-secret', 'co-secret']) expect(note).not.toContain(hidden);

    // Con "todo visible" todos ven los asociados; los campos propios siguen sin salir.
    await setMemberVisibility(s.ws, 'all');
    await runWorkflowsForEvent(s.ws, { type: 'manual', entity: 'contact', entityId: s.memberContact.id });
    const open = await lastNote();
    expect(open).toContain('Owner only deal');
    for (const hidden of ['mc-secret', 'deal-secret', 'co-secret']) expect(open).not.toContain(hidden);
  });
});

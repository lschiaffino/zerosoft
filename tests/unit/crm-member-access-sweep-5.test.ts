/**
 * CRM, quinta pasada: una tarea de un lead o de un registro de objeto propio
 * se ve solo si se ve ese lead o registro (índice, ficha, email diario y
 * recordatorios con la misma regla); los borradores del agente de
 * prospección y el enriquecimiento de contactos se arman con lo que ve
 * cualquiera que abre el registro; el borrador de email y la vista previa de
 * plantillas usan lo que ve quien pide; y las escrituras y lecturas que
 * revisó la pasada (asociaciones al escribir, vínculos de un registro de
 * objeto, usos de playbooks, reglas de score, envío de emails). Miradas:
 * owner, admin, miembro con "mine", miembro de un equipo de ventas y otro
 * workspace. Datos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { MockLanguageModelV4 } from 'ai/test';
import { addListMembers, createActivity, createCompany, createContact, createCustomField, createDeal, createList, createPipeline, createStage, getActivity } from '@/lib/crm';
import { MEMBER_SUBJECT, redactRow, setFieldPermissions } from '@/lib/crm-field-perms';
import { activityScopeSql, assertVisibleRefs, canSeeActivity, createSalesTeam, ownerScopeFor, setMemberVisibility, setSalesTeamMembers } from '@/lib/crm-visibility';
import { createLead } from '@/lib/crm-leads';
import { createObject, createRecord, linkRecord, recordLinks } from '@/lib/crm-objects';
import { listTaskIndex } from '@/lib/crm-tasks-index';
import { digestTasksFor } from '@/lib/crm-task-digest';
import { reminderRecipientSees } from '@/lib/crm-task-reminders';
import { createRun, getRun, listRuns, searchRuns, stepRun, type OutreachOutput, type EnrichOutput } from '@/lib/crm-ai-agents';
import { loadTemplateContext, renderEmailTemplate } from '@/lib/crm-email';
import { createPlaybook, listPlaybookRuns, runPlaybook, runsForViewer } from '@/lib/crm-playbooks';
import { createScoreRule, listScoreRules, scoreRulesForViewer } from '@/lib/crm-scoring';
import { setAiModelOverride } from '@/lib/ai';
import { addMember } from '@/lib/teams';
import { getDb } from '@/lib/db';
import { CrmRefError } from '@/lib/crm-refs';
import type { SessionUser } from '@/lib/session';
import type { CrmActivityRow } from '@/lib/schema/types';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const activityRoute = await import('@/lib/routes/crm/activities/[id]/route');
const draftRoute = await import('@/app/api/crm/emails/draft/route');
const previewRoute = await import('@/app/api/crm/email-templates/preview/route');
const dealsRoute = await import('@/app/api/crm/deals/route');
const contactsRoute = await import('@/app/api/crm/contacts/route');
const linksRoute = await import('@/lib/routes/crm/records/[id]/links/route');
const playbookRunsRoute = await import('@/lib/routes/crm/playbooks/[id]/runs/route');
const scoreRulesRoute = await import('@/app/api/crm/scoring/rules/route');
const emailsRoute = await import('@/app/api/crm/emails/route');
const runsRoute = await import('@/app/api/crm/ai/runs/route');
const runRoute = await import('@/lib/routes/crm/ai/runs/[id]/route');

beforeEach(() => {
  session.user = null;
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});
afterEach(() => {
  setAiModelOverride(null);
  vi.unstubAllEnvs();
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async <T,>(res: Response) => (await res.json()) as T;
const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const PAST = '2020-01-02 10:00:00';

/**
 * Workspace con un admin, `secret` (contactos, empresas, deals) oculto para
 * el rol member, un equipo de ventas con `friend` y visibilidad "mine".
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
  const memberContact = await createContact(ws, { firstName: 'Zeta', lastName: 'Member', email: 'zeta.member@gmail.com', ownerId: w.member.id, custom: { secret: 'mc-secret' } });
  const ownerContact = await createContact(ws, { firstName: 'Hidden', lastName: 'Person', ownerId: ws });
  return { w, ws, adminPerson, team, memberContact, ownerContact };
}

type Setup = Awaited<ReturnType<typeof setup>>;
const owner = (s: Setup) => asOwner(s.w.owner);
const admin = (s: Setup) => asMember(s.w.owner, s.adminPerson, 'admin');
const member = (s: Setup) => asMember(s.w.owner, s.w.member);
const teamMember = (s: Setup) => asMember(s.w.owner, s.w.friend);
const stranger = (s: Setup) => asOwner(s.w.stranger);
const scopeOf = (s: Setup, personId: string, role: SessionUser['role'] = 'member') => ownerScopeFor({ workspaceId: s.ws, personId, role });

/** Modelo que devuelve el prompt que recibió (texto, o un objeto {subject, body} con el prompt en body). */
function echoModel(asObject = false) {
  return new MockLanguageModelV4({
    modelId: 'echo',
    doGenerate: async (opts) => ({
      content: [{ type: 'text', text: asObject ? JSON.stringify({ subject: 'Hello', body: JSON.stringify(opts.prompt) }) : JSON.stringify(opts.prompt) }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 5, text: 5, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

// ---------- 1. Tareas de leads y registros de objetos ----------

describe('tareas vinculadas a un lead o a un registro de objeto', () => {
  async function seed(label: string) {
    const s = await setup(label);
    const ownerLead = await createLead(s.ws, { name: 'Owner lead', ownerId: s.ws });
    const obj = await createObject(s.ws, { singular: 'Project', plural: 'Projects' });
    if (!obj.ok) throw new Error('object');
    const ownerRecord = await createRecord(s.ws, obj.object.id, { name: 'Owner project', ownerId: s.ws });
    const memberLead = await createLead(s.ws, { name: 'Member lead', ownerId: s.w.member.id });
    // Tareas del miembro (owner de la tarea), con un registro que no ve o con uno suyo.
    const t = (subject: string, extra: Partial<Record<'leadId' | 'objectRecordId' | 'contactId', string>>) =>
      createActivity(s.ws, { type: 'task', subject, dueAt: PAST, ownerId: s.w.member.id, ...extra });
    const onOwnerLead = await t('Lead follow-up', { leadId: ownerLead.id });
    const onOwnerRecord = await t('Project follow-up', { objectRecordId: ownerRecord.id });
    const onOwnLead = await t('Own lead follow-up', { leadId: memberLead.id });
    const mixed = await t('Mixed follow-up', { contactId: s.memberContact.id, leadId: ownerLead.id });
    return { ...s, ownerLead, ownerRecord, memberLead, onOwnerLead, onOwnerRecord, onOwnLead, mixed };
  }

  const indexFor = async (s: Setup, personId: string, role: SessionUser['role']) => {
    const scope = await scopeOf(s, personId, role);
    const { rows } = await listTaskIndex(
      { bucket: 'all', sort: 'due' },
      { workspaceId: s.ws, viewer: { workspaceId: s.ws, personId, role }, ownerScope: scope, timeZone: 'UTC' },
      1,
      200,
    );
    return rows.map((r) => r.subject).sort();
  };

  it('el índice, la ficha, el email diario y los recordatorios aplican la misma regla', async () => {
    const s = await seed('p5-tasks');
    const all = ['Lead follow-up', 'Mixed follow-up', 'Own lead follow-up', 'Project follow-up'];
    expect(await indexFor(s, s.ws, 'owner')).toEqual(all);
    expect(await indexFor(s, s.adminPerson.id, 'admin')).toEqual(all);
    // "mine": solo la de su propio lead (la mixta tiene un lead del owner).
    expect(await indexFor(s, s.w.member.id, 'member')).toEqual(['Own lead follow-up']);
    expect(await indexFor(s, s.w.friend.id, 'member')).toEqual([]);

    // Ficha de la tarea (la página y sus rutas usan canSeeActivity); editarla tampoco.
    for (const id of [s.onOwnerLead.id, s.onOwnerRecord.id, s.mixed.id]) {
      expect(await canSeeActivity(s.ws, id, await scopeOf(s, s.w.member.id))).toBe(false);
      expect(await canSeeActivity(s.ws, id, null)).toBe(true);
      session.user = member(s);
      const patch = new NextRequest('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ priority: 'high' }), headers: { 'content-type': 'application/json' } });
      expect((await activityRoute.PATCH(patch, ctx(id))).status).toBe(404);
    }
    expect(await canSeeActivity(s.ws, s.onOwnLead.id, await scopeOf(s, s.w.member.id))).toBe(true);
    expect(await canSeeActivity(s.w.stranger.id, s.onOwnLead.id, null)).toBe(false);

    // Email diario: las tareas del miembro que hoy ve.
    const digest = await digestTasksFor(s.ws, s.w.member.id, 'UTC', new Date(), 'en');
    expect(digest?.map((d) => d.subject)).toEqual(['Own lead follow-up']);

    // Recordatorios: misma respuesta que la ficha.
    const row = async (id: string) => (await getActivity(s.ws, id)) as unknown as CrmActivityRow;
    expect(await reminderRecipientSees(await row(s.onOwnerLead.id), s.w.member.id)).toBe(false);
    expect(await reminderRecipientSees(await row(s.onOwnerRecord.id), s.w.member.id)).toBe(false);
    expect(await reminderRecipientSees(await row(s.onOwnLead.id), s.w.member.id)).toBe(true);
    expect(await reminderRecipientSees(await row(s.onOwnerLead.id), s.adminPerson.id)).toBe(true);
    expect(await reminderRecipientSees(await row(s.onOwnLead.id), s.w.stranger.id)).toBe(false);

    // Equipo de ventas: con "equipo" y el owner en el equipo, su compañero ve lo del owner.
    await setMemberVisibility(s.ws, 'team');
    await setSalesTeamMembers(s.ws, s.team.id, [s.w.friend.id, s.ws]);
    expect(await canSeeActivity(s.ws, s.onOwnerLead.id, await scopeOf(s, s.w.friend.id))).toBe(true);
    expect(await canSeeActivity(s.ws, s.onOwnerRecord.id, await scopeOf(s, s.w.friend.id))).toBe(true);
    expect(await canSeeActivity(s.ws, s.onOwnerLead.id, await scopeOf(s, s.w.member.id))).toBe(false);
  });

  it('un lead o registro de otro workspace no cuenta como visible', async () => {
    const s = await seed('p5-tasks-ws');
    // Un lead del workspace ajeno con un owner que sí está en el alcance del miembro.
    const foreignLead = await createLead(s.w.stranger.id, { name: 'Foreign' });
    await getDb().prepare('UPDATE crm_leads SET owner_id = ? WHERE id = ?').run(s.w.member.id, foreignLead.id);
    await getDb().prepare('UPDATE crm_activities SET lead_id = ? WHERE id = ?').run(foreignLead.id, s.onOwnLead.id);
    const scope = await scopeOf(s, s.w.member.id);
    expect(await canSeeActivity(s.ws, s.onOwnLead.id, scope)).toBe(false);
    const vis = activityScopeSql('a', scope);
    const rows = (await getDb()
      .prepare(`SELECT a.id FROM crm_activities a WHERE a.user_id = ? AND a.id = ? AND ${vis.sql}`)
      .all(s.ws, s.onOwnLead.id, ...vis.args)) as unknown[];
    expect(rows).toHaveLength(0);
  });
});

// ---------- 2. Agentes de prospección y datos ----------

describe('agente de prospección y de datos', () => {
  async function seed(label: string) {
    const s = await setup(label);
    const pl = await createPipeline(s.ws, 'Sales');
    const stage = (await createStage(s.ws, pl.id, { name: 'Open' }))!;
    await createDeal(s.ws, { name: 'Member visible deal', pipelineId: pl.id, stageId: stage.id, ownerId: s.w.member.id, contactIds: [s.memberContact.id] });
    await createDeal(s.ws, { name: 'Owner only deal', pipelineId: pl.id, stageId: stage.id, ownerId: s.ws, contactIds: [s.memberContact.id], custom: { secret: 'deal-secret' } });
    const co = await createCompany(s.ws, { name: 'Owner only company', domain: 'owner-only.example', ownerId: s.ws, custom: { secret: 'co-secret' } });
    await createActivity(s.ws, { type: 'note', body: 'Owner side note', contactId: s.memberContact.id, companyId: co.id });
    await createActivity(s.ws, { type: 'note', body: 'Member note', contactId: s.memberContact.id });
    const list = await createList(s.ws, { name: 'Outbound', entity: 'contacts', kind: 'static' });
    await addListMembers(s.ws, list.id, [s.memberContact.id]);
    return { ...s, co, list };
  }

  it('el borrador usa lo que ve cualquiera que abre el contacto, sin campos propios', async () => {
    const s = await seed('p5-outreach');
    setAiModelOverride(echoModel(true));
    const run = await createRun({
      workspaceId: s.ws,
      personId: s.w.member.id,
      scope: await scopeOf(s, s.w.member.id),
      input: { agent: 'outreach', listId: s.list.id, locale: 'en' },
      defaultName: 'Outreach',
    });
    await stepRun(s.ws, run.id, 20_000);
    const full = (await getRun(s.ws, run.id))!;
    expect(full.items).toHaveLength(1);
    expect(full.items[0].status).toBe('ready');
    const body = (full.items[0].output as OutreachOutput).body;
    expect(body).toContain('Zeta Member');
    expect(body).toContain('Member visible deal');
    expect(body).toContain('Member note');
    for (const hidden of ['Owner only deal', 'Owner only company', 'Owner side note', 'mc-secret', 'deal-secret', 'co-secret']) expect(body).not.toContain(hidden);

    // Quien no ve el contacto no ve la corrida (ni por la lista, ni por id, ni por búsqueda); owner y admin sí.
    const viewer = (personId: string, scope: string[] | null) => ({ personId, scope });
    expect((await listRuns(s.ws, viewer(s.w.friend.id, await scopeOf(s, s.w.friend.id)))).map((r) => r.id)).not.toContain(run.id);
    expect(await getRun(s.ws, run.id, viewer(s.w.friend.id, await scopeOf(s, s.w.friend.id)))).toBeNull();
    expect(await searchRuns(s.ws, 'Outreach', 5, viewer(s.w.friend.id, await scopeOf(s, s.w.friend.id)))).toEqual([]);
    expect((await listRuns(s.ws, viewer(s.w.member.id, await scopeOf(s, s.w.member.id)))).map((r) => r.id)).toContain(run.id);
    session.user = admin(s);
    expect((await json<{ rows: Array<{ id: string }> }>(await runsRoute.GET())).rows.map((r) => r.id)).toContain(run.id);
    session.user = teamMember(s);
    expect((await json<{ rows: Array<{ id: string }> }>(await runsRoute.GET())).rows.map((r) => r.id)).not.toContain(run.id);
    expect((await runRoute.GET(new NextRequest('http://localhost/x'), ctx(run.id))).status).toBe(404);
    expect((await runRoute.DELETE(new NextRequest('http://localhost/x'), ctx(run.id))).status).toBe(404);
    session.user = stranger(s);
    expect((await runRoute.GET(new NextRequest('http://localhost/x'), ctx(run.id))).status).toBe(404);
  });

  it('si quien creó la corrida ya no ve el contacto, el ítem no se arma', async () => {
    const s = await seed('p5-outreach-gone');
    setAiModelOverride(echoModel(true));
    const run = await createRun({
      workspaceId: s.ws,
      personId: s.w.member.id,
      scope: await scopeOf(s, s.w.member.id),
      input: { agent: 'outreach', listId: s.list.id, locale: 'en' },
      defaultName: 'Outreach',
    });
    await getDb().prepare('UPDATE crm_contacts SET owner_id = ? WHERE id = ?').run(s.ws, s.memberContact.id);
    await stepRun(s.ws, run.id, 20_000);
    const item = (await getRun(s.ws, run.id))!.items[0];
    expect(item.status).toBe('failed');
    expect(item.error).toBe('not_found');
  });

  it('el agente de datos no vincula ni nombra una empresa que no ve cualquiera que abre el contacto', async () => {
    const s = await seed('p5-enrich');
    const c = await createContact(s.ws, { email: 'someone@owner-only.example', ownerId: s.w.member.id });
    const run = await createRun({
      workspaceId: s.ws,
      personId: s.w.member.id,
      scope: await scopeOf(s, s.w.member.id),
      input: { agent: 'enrich_contacts' },
      defaultName: 'Enrich',
    });
    await stepRun(s.ws, run.id, 20_000);
    const item = (await getRun(s.ws, run.id))!.items.find((i) => i.entityId === c.id)!;
    const out = item.output as EnrichOutput;
    expect(JSON.stringify(out)).not.toContain(s.co.id);
    expect(JSON.stringify(out)).not.toContain('Owner only company');

    // Con "todo visible" la empresa (ya vinculada por el dominio al crear el contacto) sí se nombra.
    await setMemberVisibility(s.ws, 'all');
    const run2 = await createRun({ workspaceId: s.ws, personId: s.w.member.id, scope: null, input: { agent: 'enrich_contacts' }, defaultName: 'Enrich' });
    await stepRun(s.ws, run2.id, 20_000);
    const item2 = (await getRun(s.ws, run2.id))!.items.find((i) => i.entityId === c.id)!;
    expect((item2.output as EnrichOutput).source).toBe('Owner only company');
  });
});

// ---------- 3. Borrador de email y plantillas ----------

describe('borrador de email y vista previa de plantillas', () => {
  it('el borrador solo sale para un contacto que quien pide ve, sin su empresa o deal ocultos', async () => {
    const s = await setup('p5-draft');
    const co = await createCompany(s.ws, { name: 'Owner only company', ownerId: s.ws });
    await getDb().prepare('UPDATE crm_contacts SET company_id = ? WHERE id = ?').run(co.id, s.memberContact.id);
    const pl = await createPipeline(s.ws, 'Sales');
    const stage = (await createStage(s.ws, pl.id, { name: 'Open' }))!;
    await createDeal(s.ws, { name: 'Owner only deal', pipelineId: pl.id, stageId: stage.id, ownerId: s.ws, contactIds: [s.memberContact.id] });
    setAiModelOverride(echoModel());

    session.user = member(s);
    expect((await draftRoute.POST(post('/api/crm/emails/draft', { contactId: s.ownerContact.id }))).status).toBe(404);
    const res = await draftRoute.POST(post('/api/crm/emails/draft', { contactId: s.memberContact.id }));
    expect(res.status).toBe(200);
    const body = (await json<{ body: string }>(res)).body;
    expect(body).toContain('Zeta');
    expect(body).not.toContain('Owner only company');
    expect(body).not.toContain('Owner only deal');

    session.user = owner(s);
    const full = (await json<{ body: string }>(await draftRoute.POST(post('/api/crm/emails/draft', { contactId: s.memberContact.id })))).body;
    expect(full).toContain('Owner only company');
    session.user = stranger(s);
    expect((await draftRoute.POST(post('/api/crm/emails/draft', { contactId: s.memberContact.id }))).status).toBe(404);
  });

  it('la vista previa no resuelve campos ocultos ni registros que la persona no ve', async () => {
    const s = await setup('p5-preview');
    const tpl = { subject: 'Hi', body: '[{{contact.first_name}}|{{contact.custom.secret}}]' };
    const render = async (user: SessionUser, contactId: string) => {
      session.user = user;
      return (await json<{ body: string }>(await previewRoute.POST(post('/x', { ...tpl, contactId })))).body;
    };
    expect(await render(owner(s), s.memberContact.id)).toBe('[Zeta|mc-secret]');
    expect(await render(admin(s), s.memberContact.id)).toBe('[Zeta|mc-secret]');
    expect(await render(member(s), s.memberContact.id)).toBe('[Zeta|]');
    expect(await render(member(s), s.ownerContact.id)).toBe('[|]');
    expect(await render(teamMember(s), s.memberContact.id)).toBe('[|]');
    expect(await render(stranger(s), s.memberContact.id)).toBe('[|]');

    // Envío ya decidido (secuencia): el destinatario sale, sin campos ocultos de quien envía.
    const ctxSeq = await loadTemplateContext(s.ws, {
      contactId: s.ownerContact.id,
      access: { scope: await scopeOf(s, s.w.member.id), viewer: { workspaceId: s.ws, personId: s.w.member.id, role: 'member' }, recipient: true },
    });
    expect(renderEmailTemplate('{{contact.first_name}}', ctxSeq).text).toBe('Hidden');
  });
});

// ---------- 4. Escrituras, vínculos, playbooks, score y envío ----------

describe('escrituras y lecturas de la pasada', () => {
  it('no se puede vincular al escribir un registro que la persona no ve', async () => {
    const s = await setup('p5-writes');
    const pl = await createPipeline(s.ws, 'Sales');
    const stage = (await createStage(s.ws, pl.id, { name: 'Open' }))!;
    const ownerCo = await createCompany(s.ws, { name: 'Owner co', ownerId: s.ws });
    session.user = member(s);
    const deal = await dealsRoute.POST(post('/api/crm/deals', { name: 'X', pipelineId: pl.id, stageId: stage.id, contactIds: [s.ownerContact.id] }));
    expect(deal.status).toBe(400);
    expect((await json<{ error: string }>(deal)).error).toBe('invalid_contact');
    const contact = await contactsRoute.POST(post('/api/crm/contacts', { firstName: 'New', companyId: ownerCo.id }));
    expect(contact.status).toBe(400);
    session.user = owner(s);
    expect((await dealsRoute.POST(post('/api/crm/deals', { name: 'X', pipelineId: pl.id, stageId: stage.id, contactIds: [s.ownerContact.id] }))).status).toBe(201);

    const lead = await createLead(s.ws, { name: 'L', ownerId: s.ws });
    const memberScope = await scopeOf(s, s.w.member.id);
    await expect(assertVisibleRefs(s.ws, { leadId: lead.id }, memberScope)).rejects.toBeInstanceOf(CrmRefError);
    await expect(assertVisibleRefs(s.ws, { contactIds: [s.memberContact.id] }, memberScope)).resolves.toBeUndefined();
    await expect(assertVisibleRefs(s.ws, { leadId: lead.id }, null)).resolves.toBeUndefined();
  });

  it('los vínculos de un registro de objeto no nombran registros que la persona no ve', async () => {
    const s = await setup('p5-links');
    const obj = await createObject(s.ws, { singular: 'Project', plural: 'Projects' });
    if (!obj.ok) throw new Error('object');
    const rec = await createRecord(s.ws, obj.object.id, { name: 'P', ownerId: s.w.member.id });
    await linkRecord(s.ws, rec.id, 'contact', s.memberContact.id);
    await linkRecord(s.ws, rec.id, 'contact', s.ownerContact.id);
    session.user = member(s);
    const res = await json<{ contacts: Array<{ id: string; first_name: string }> }>(await linksRoute.GET(new NextRequest('http://localhost/x'), ctx(rec.id)));
    expect(res.contacts.map((c) => c.id)).toEqual([s.memberContact.id]);
    session.user = owner(s);
    const full = await json<{ contacts: Array<{ id: string }> }>(await linksRoute.GET(new NextRequest('http://localhost/x'), ctx(rec.id)));
    expect(full.contacts).toHaveLength(2);
    expect((await recordLinks(s.ws, rec.id, await scopeOf(s, s.w.friend.id))).contacts).toEqual([]);
    session.user = stranger(s);
    expect((await linksRoute.GET(new NextRequest('http://localhost/x'), ctx(rec.id))).status).toBe(404);
  });

  it('los usos de un playbook y sus escrituras respetan alcance y campos', async () => {
    const s = await setup('p5-playbook');
    const pb = await createPlaybook(
      s.ws,
      {
        name: 'Discovery',
        entities: ['contact'],
        questions: [
          { id: 'q1', label: 'Budget', type: 'text', options: [], property: 'contact:custom.secret' },
          { id: 'q2', label: 'Notes', type: 'text', options: [], property: '' },
        ],
      },
      s.ws,
    );
    await runPlaybook(s.ws, pb.id, { entity: 'contact', entityId: s.ownerContact.id, answers: { q1: 'owner-answer', q2: 'n' }, logAs: 'note' } as never, { id: s.ws, email: 'o@example.com' });
    await runPlaybook(s.ws, pb.id, { entity: 'contact', entityId: s.memberContact.id, answers: { q1: 'admin-answer', q2: 'n2' }, logAs: 'note' } as never, { id: s.ws, email: 'o@example.com' });

    // La nota del timeline la lee todo quien ve el contacto: sin la respuesta al campo oculto.
    const notes = (await getDb().prepare("SELECT body FROM crm_activities WHERE user_id = ? AND type = 'note'").all(s.ws)) as Array<{ body: string }>;
    for (const n of notes) expect(n.body).not.toContain('answer');

    session.user = member(s);
    const rows = (await json<{ rows: Array<{ entity_id: string; answers: string }> }>(await playbookRunsRoute.GET(new NextRequest('http://localhost/x'), ctx(pb.id)))).rows;
    expect(rows.map((r) => r.entity_id)).toEqual([s.memberContact.id]);
    expect(JSON.parse(rows[0].answers)).toEqual({ q2: 'n2' });
    session.user = owner(s);
    expect((await json<{ rows: unknown[] }>(await playbookRunsRoute.GET(new NextRequest('http://localhost/x'), ctx(pb.id)))).rows).toHaveLength(2);
    const adminRows = await runsForViewer({ workspaceId: s.ws, personId: s.adminPerson.id, role: 'admin' }, null, await listPlaybookRuns(s.ws, { playbookId: pb.id }));
    expect(adminRows).toHaveLength(2);

    // Un miembro que responde no escribe un campo que tiene oculto.
    session.user = member(s);
    const res = await playbookRunsRoute.POST(post('/x', { entity: 'contact', entityId: s.memberContact.id, answers: { q1: 'overwrite' }, logAs: 'note' }), ctx(pb.id));
    expect(res.status).toBe(201);
    expect((await json<{ updated: string[] }>(res)).updated).not.toContain('custom.secret');
    const c = (await getDb().prepare('SELECT custom FROM crm_contacts WHERE id = ?').get(s.memberContact.id)) as { custom: string };
    // Conserva lo que había escrito el owner con el playbook.
    expect(JSON.parse(c.custom).secret).toBe('admin-answer');
  });

  it('las reglas de score y el desglose no muestran campos ocultos', async () => {
    const s = await setup('p5-score');
    await createScoreRule(s.ws, { kind: 'property', name: 'Secret rule', config: { field: 'custom.secret', op: 'equals', value: 'mc-secret' }, points: 5 });
    await createScoreRule(s.ws, { kind: 'property', name: 'Title rule', config: { field: 'jobTitle', op: 'equals', value: 'CEO' }, points: 5 });
    session.user = member(s);
    const rules = (await json<{ rules: Array<{ name: string }> }>(await scoreRulesRoute.GET())).rules.map((r) => r.name);
    expect(rules).toEqual(['Title rule']);
    session.user = owner(s);
    expect((await json<{ rules: unknown[] }>(await scoreRulesRoute.GET())).rules).toHaveLength(2);
    expect(await scoreRulesForViewer({ workspaceId: s.ws, personId: s.w.friend.id, role: 'member' }, await listScoreRules(s.ws))).toHaveLength(1);
    // Desglose guardado en la fila: sin detalles para quien tiene campos ocultos.
    const row = { custom: '{}', score_breakdown: JSON.stringify([{ ruleId: 'r', name: 'Secret rule', points: 5, detail: 'mc-secret' }]) };
    expect(redactRow(row, new Set(['secret'])).score_breakdown).not.toContain('mc-secret');
    expect(redactRow(row, new Set()).score_breakdown).toContain('mc-secret');
  });

  it('no se manda ni se registra un email en un registro que la persona no ve', async () => {
    const s = await setup('p5-send');
    session.user = member(s);
    const res = await emailsRoute.POST(post('/api/crm/emails', { recordType: 'contact', recordId: s.ownerContact.id, to: 'x@example.com', subject: 'S', body: 'B' }));
    expect(res.status).toBe(404);
    session.user = stranger(s);
    expect((await emailsRoute.POST(post('/api/crm/emails', { recordType: 'contact', recordId: s.memberContact.id, to: 'x@example.com', subject: 'S', body: 'B' }))).status).not.toBe(201);
  });
});

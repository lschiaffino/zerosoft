import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb, type UserRow } from '@/lib/db';
import {
  createActivity,
  createCompany,
  createContact,
  createDeal,
  createPipeline,
  createStage,
  exportRows,
  getCrmOverview,
  getCrmReports,
  listContacts,
  listDeals,
  listTimeline,
  searchAll,
  updateStage,
} from '@/lib/crm';
import { addMember, createTeam, type TeamRole } from '@/lib/teams';
import {
  createSalesTeam,
  ownerScopeFor,
  setMemberVisibility,
  visibleIds,
} from '@/lib/crm-visibility';
import { createApiKey } from '@/lib/api-auth';
import { hasScope, parseScopes, serializeScopes, API_SCOPES } from '@/lib/api-scopes';
import { assignNewLead, listAssignmentHistory, pickNextOwner, saveAssignmentRule, setAvailability } from '@/lib/crm-assignment';
import { createForm, submitForm } from '@/lib/crm-forms';
import { addLineItem, createQuote, listQuotes } from '@/lib/crm-products';
import { associateContactCompany, listAssociations } from '@/lib/crm-assoc';
import { applyTag, createTag, tagsForRecords } from '@/lib/crm-tags';
import { canSeeQuote } from '@/lib/crm-visibility';
import { periodRange, quotaMath, quotaProgress, upsertQuota } from '@/lib/crm-quotas';
import { reportKpis, reportRange } from '@/lib/crm-reports';
import { makeUser } from './helpers';

/** Sesión simulada: owner del workspace + persona real + rol (como lib/session). */
const session = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
}));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role: string }) => u.role === 'owner' || u.role === 'admin',
}));

const contactsRoute = await import('@/app/api/crm/contacts/route');
const contactRoute = await import('@/lib/routes/crm/contacts/[id]/route');
const searchRoute = await import('@/app/api/search/route');
const crmSearchRoute = await import('@/app/api/crm/search/route');
const exportRoute = await import('@/app/api/crm/export/route');
const activitiesRoute = await import('@/app/api/crm/activities/route');
const v1Contacts = await import('@/app/api/v1/crm/contacts/route');
const v1Contact = await import('@/lib/routes/v1/crm/contacts/[id]/route');
const v1Deals = await import('@/app/api/v1/crm/deals/route');
const v1Activities = await import('@/app/api/v1/crm/activities/route');
const v1Links = await import('@/app/api/v1/links/route');
const v1EventTypes = await import('@/app/api/v1/calendar/event-types/route');
const assocRoute = await import('@/app/api/crm/associations/route');
const v1Assoc = await import('@/app/api/v1/crm/associations/route');
const tagApplyRoute = await import('@/app/api/crm/tags/apply/route');
const tagRecordRoute = await import('@/app/api/crm/tags/record/route');
const tagsRoute = await import('@/app/api/crm/tags/route');
const v1TagRecords = await import('@/lib/routes/v1/crm/tags/[id]/records/route');
const assocActions = await import('@/components/crm/associationActions');

beforeEach(() => {
  session.user = null;
});

function actAs(owner: UserRow, person: UserRow, role: TeamRole) {
  session.user =
    person.id === owner.id ? { ...owner, role: 'owner', team: null } : { ...owner, actingUser: person, role, team: null };
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (url: string, key?: string) =>
  new Request(url, { headers: key ? { authorization: `Bearer ${key}` } : {} }) as never;
const send = (url: string, method: string, body: unknown, key?: string) =>
  new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  }) as never;
/** Los handlers de listas usan req.nextUrl: NextRequest lo provee. */
const nextReq = (url: string, key?: string) =>
  new NextRequest(url, { headers: key ? { authorization: `Bearer ${key}` } : {} }) as never;

/** Workspace con owner, dos members y un admin; un contacto/deal/empresa de cada uno. */
async function workspace() {
  const owner = await makeUser('own');
  const m1 = await makeUser('m1');
  const m2 = await makeUser('m2');
  const adm = await makeUser('adm');
  const team = await createTeam(owner.id, 'Sales');
  await addMember(team.id, m1.id, 'member');
  await addMember(team.id, m2.id, 'member');
  await addMember(team.id, adm.id, 'admin');
  const c1 = await createContact(owner.id, { firstName: 'Mine', lastName: 'One', email: 'one@acme.io', ownerId: m1.id, lifecycleStage: 'lead' });
  const c2 = await createContact(owner.id, { firstName: 'Mate', lastName: 'Two', email: 'two@acme.io', ownerId: m2.id, lifecycleStage: 'sql' });
  const c3 = await createContact(owner.id, { firstName: 'Boss', lastName: 'Three', email: 'three@acme.io', lifecycleStage: 'customer' });
  const co2 = await createCompany(owner.id, { name: 'Acme Two', ownerId: m2.id });
  const pipeline = await createPipeline(owner.id, 'Sales');
  const stage = (await createStage(owner.id, pipeline.id, { name: 'New' }))!;
  const d1 = await createDeal(owner.id, { name: 'Deal One', pipelineId: pipeline.id, stageId: stage.id, ownerId: m1.id, amount: 100 });
  const d2 = await createDeal(owner.id, { name: 'Deal Two', pipelineId: pipeline.id, stageId: stage.id, ownerId: m2.id, amount: 200 });
  if (!d1.ok || !d2.ok) throw new Error('deal');
  await createActivity(owner.id, { type: 'note', subject: 'note on two', contactId: c2.id });
  await createActivity(owner.id, { type: 'note', subject: 'note on one', contactId: c1.id });
  return { owner, m1, m2, adm, team, c1, c2, c3, co2, pipeline, stage, d1: d1.deal, d2: d2.deal };
}

describe('visibilidad por owner', () => {
  it('scope: admins/owner ven todo; members según el setting (all / mine / team)', async () => {
    const w = await workspace();
    const v = (p: UserRow, role: TeamRole) => ownerScopeFor({ workspaceId: w.owner.id, personId: p.id, role });
    expect(await v(w.m1, 'member')).toBeNull();
    await setMemberVisibility(w.owner.id, 'mine');
    expect(await v(w.m1, 'member')).toEqual([w.m1.id]);
    expect(await v(w.adm, 'admin')).toBeNull();
    expect(await v(w.owner, 'owner')).toBeNull();
    await setMemberVisibility(w.owner.id, 'team');
    expect(await v(w.m1, 'member')).toEqual([w.m1.id]);
    await createSalesTeam(w.owner.id, { name: 'East', members: [w.m1.id, w.m2.id, 'not-a-member'] });
    expect((await v(w.m1, 'member'))!.sort()).toEqual([w.m1.id, w.m2.id].sort());
  });

  it("'mine': listas, búsqueda, export, reportes, timeline y lotes no filtran registros ajenos", async () => {
    const w = await workspace();
    await setMemberVisibility(w.owner.id, 'mine');
    const scope = await ownerScopeFor({ workspaceId: w.owner.id, personId: w.m1.id, role: 'member' });
    expect((await listContacts(w.owner.id, { ownerScope: scope })).rows.map((r) => r.id)).toEqual([w.c1.id]);
    expect((await listDeals(w.owner.id, { pipelineId: w.pipeline.id, ownerScope: scope })).rows.map((r) => r.id)).toEqual([w.d1.id]);
    const found = await searchAll(w.owner.id, 'acme', scope);
    expect(found.contacts.map((c) => c.id)).toEqual([w.c1.id]);
    expect(found.companies).toEqual([]);
    expect((await exportRows(w.owner.id, 'contacts', scope)).map((r) => r.id)).toEqual([w.c1.id]);
    expect((await exportRows(w.owner.id, 'deals', scope)).map((r) => r.id)).toEqual([w.d1.id]);
    const acts = await exportRows(w.owner.id, 'activities', scope);
    expect(acts.every((a) => (a as { contact_id: string | null }).contact_id !== w.c2.id)).toBe(true);
    const timeline = await listTimeline(w.owner.id, { ownerScope: scope });
    expect(timeline.map((a) => a.subject)).toContain('note on one');
    expect(timeline.map((a) => a.subject)).not.toContain('note on two');
    const reports = await getCrmReports(w.owner.id, scope);
    expect(reports.contactsByLifecycle).toEqual([{ lifecycle: 'lead', count: 1 }]);
    expect(reports.dealsBySource.reduce((s, r) => s + r.amount, 0)).toBe(100);
    const overview = await getCrmOverview(w.owner.id, scope);
    expect(overview.totalContacts).toBe(1);
    expect(overview.openDealsAmount).toBe(100);
    const kpis = await reportKpis(w.owner.id, reportRange('30d'), { ownerIds: scope! });
    expect(kpis.newContacts).toBe(1);
    expect(await visibleIds(w.owner.id, 'crm_contacts', [w.c1.id, w.c2.id, w.c3.id], scope)).toEqual([w.c1.id]);
    // Admin: todo.
    expect((await listContacts(w.owner.id, {})).total).toBe(3);
  });

  it('rutas de sesión: lista, GET/PATCH/DELETE ajenos dan 404, búsqueda ⌘K y export respetan el scope', async () => {
    const w = await workspace();
    await setMemberVisibility(w.owner.id, 'mine');
    actAs(w.owner, w.m1, 'member');
    const list = (await (await contactsRoute.GET(nextReq('http://x/api/crm/contacts'))).json()) as { rows: Array<{ id: string }> };
    expect(list.rows.map((r) => r.id)).toEqual([w.c1.id]);
    expect((await contactRoute.GET(get('http://x'), ctx(w.c1.id))).status).toBe(200);
    expect((await contactRoute.GET(get('http://x'), ctx(w.c2.id))).status).toBe(404);
    expect((await contactRoute.PATCH(send('http://x', 'PATCH', { firstName: 'Hacked' }), ctx(w.c2.id))).status).toBe(404);
    expect((await contactRoute.DELETE(get('http://x'), ctx(w.c3.id))).status).toBe(404);
    const c2 = (await getDb().prepare('SELECT first_name FROM crm_contacts WHERE id = ?').get(w.c2.id)) as { first_name: string };
    expect(c2.first_name).toBe('Mate');

    const k = (await (await searchRoute.GET(nextReq('http://x/api/search?q=acme'))).json()) as { items: Array<{ id: string; group: string }> };
    expect(k.items.filter((i) => i.group === 'contacts').map((i) => i.id)).toEqual([w.c1.id]);
    expect(k.items.some((i) => i.id === w.co2.id)).toBe(false);
    const s = (await (await crmSearchRoute.GET(nextReq('http://x/api/crm/search?q=Deal'))).json()) as { deals: Array<{ id: string }> };
    expect(s.deals.map((d) => d.id)).toEqual([w.d1.id]);

    const tl = (await (await activitiesRoute.GET(nextReq(`http://x/api/crm/activities?contactId=${w.c2.id}`))).json()) as { rows: unknown[] };
    expect(tl.rows).toEqual([]);
    // No puede colgar una actividad de un contacto que no ve.
    expect((await activitiesRoute.POST(send('http://x', 'POST', { type: 'note', subject: 'x', contactId: w.c2.id }))).status).toBe(404);

    // Export: solo admins; el admin exporta todo.
    expect((await exportRoute.GET(nextReq('http://x/api/crm/export?entity=contacts&format=json'))).status).toBe(403);
    actAs(w.owner, w.adm, 'admin');
    const all = (await (await exportRoute.GET(nextReq('http://x/api/crm/export?entity=contacts&format=json'))).json()) as unknown[];
    expect(all).toHaveLength(3);

    // Un member crea un contacto: queda como owner y lo sigue viendo.
    actAs(w.owner, w.m2, 'member');
    const created = (await (await contactsRoute.POST(send('http://x', 'POST', { firstName: 'New' }))).json()) as { id: string; owner_id: string };
    expect(created.owner_id).toBe(w.m2.id);
    expect((await contactRoute.GET(get('http://x'), ctx(created.id))).status).toBe(200);
  });

  it('API v1: la key actúa como su creador (sin fugas) y la del admin ve todo', async () => {
    const w = await workspace();
    await setMemberVisibility(w.owner.id, 'team');
    await createSalesTeam(w.owner.id, { name: 'Pair', members: [w.m1.id, w.m2.id] });
    const memberKey = (await createApiKey(w.owner.id, 'm1', w.m1.id)).key;
    const adminKey = (await createApiKey(w.owner.id, 'adm', w.adm.id)).key;

    const asMember = (await (await v1Contacts.GET(nextReq('http://x/api/v1/crm/contacts', memberKey))).json()) as {
      contacts: Array<{ id: string }>;
    };
    expect(asMember.contacts.map((c) => c.id).sort()).toEqual([w.c1.id, w.c2.id].sort());
    expect((await v1Contact.GET(get('http://x', memberKey), ctx(w.c3.id))).status).toBe(404);
    expect((await v1Contact.DELETE(get('http://x', memberKey), ctx(w.c3.id))).status).toBe(404);
    expect((await v1Contact.GET(get('http://x', memberKey), ctx(w.c2.id))).status).toBe(200);
    const deals = (await (await v1Deals.GET(nextReq(`http://x/api/v1/crm/deals?pipelineId=${w.pipeline.id}`, memberKey))).json()) as {
      deals: Array<{ id: string }>;
    };
    expect(deals.deals.map((d) => d.id).sort()).toEqual([w.d1.id, w.d2.id].sort());
    const acts = (await (await v1Activities.GET(nextReq('http://x/api/v1/crm/activities', memberKey))).json()) as {
      activities?: Array<{ subject: string }>;
    };
    expect(JSON.stringify(acts)).not.toContain(w.c3.id);

    const asAdmin = (await (await v1Contacts.GET(nextReq('http://x/api/v1/crm/contacts', adminKey))).json()) as { contacts: unknown[] };
    expect(asAdmin.contacts).toHaveLength(3);

    // 'mine': el compañero de equipo deja de verse.
    await setMemberVisibility(w.owner.id, 'mine');
    const mine = (await (await v1Contacts.GET(nextReq('http://x/api/v1/crm/contacts', memberKey))).json()) as { contacts: Array<{ id: string }> };
    expect(mine.contacts.map((c) => c.id)).toEqual([w.c1.id]);
    // Lo que crea con la key queda a su nombre.
    const created = (await (await v1Contacts.POST(send('http://x', 'POST', { email: 'api@acme.io' }, memberKey))).json()) as { owner_id: string };
    expect(created.owner_id).toBe(w.m1.id);
  });
});

describe('visibilidad: quotes', () => {
  it('un member restringido no lista ni abre quotes de deals ajenos', async () => {
    const w = await workspace();
    for (const d of [w.d1, w.d2]) await addLineItem(w.owner.id, d.id, { name: 'Seat', quantity: 1, unitPrice: 10 });
    const q1 = await createQuote(w.owner.id, w.d1.id, {});
    const q2 = await createQuote(w.owner.id, w.d2.id, {});
    if (!q1.ok || !q2.ok) throw new Error('quote');
    await setMemberVisibility(w.owner.id, 'mine');
    const scope = await ownerScopeFor({ workspaceId: w.owner.id, personId: w.m1.id, role: 'member' });
    expect((await listQuotes(w.owner.id, { ownerScope: scope })).rows.map((q) => q.id)).toEqual([q1.quote.id]);
    expect(await canSeeQuote(w.owner.id, q2.quote.id, scope)).toBe(false);
    expect(await canSeeQuote(w.owner.id, q1.quote.id, scope)).toBe(true);
    expect((await listQuotes(w.owner.id, {})).total).toBe(2);
  });
});

describe('visibilidad: asociaciones y tags', () => {
  it('un member restringido no lee ni modifica asociaciones/tags de registros que no ve (sesión, server actions y v1)', async () => {
    const w = await workspace();
    const co1 = await createCompany(w.owner.id, { name: 'Mine Co', ownerId: w.m1.id });
    // c1 (visible) asociado a una empresa visible y a una ajena.
    await associateContactCompany(w.owner.id, w.c1.id, co1.id, {});
    await associateContactCompany(w.owner.id, w.c1.id, w.co2.id, {});
    await associateContactCompany(w.owner.id, w.c2.id, co1.id, {});
    const tagRes = await createTag(w.owner.id, { name: 'VIP' });
    if (!tagRes.ok) throw new Error('tag');
    const tag = tagRes.tag;
    await applyTag(w.owner.id, tag.id, 'contact', [w.c1.id, w.c2.id, w.c3.id], 'add');
    await setMemberVisibility(w.owner.id, 'mine');
    actAs(w.owner, w.m1, 'member');
    const memberKey = (await createApiKey(w.owner.id, 'm1', w.m1.id)).key;

    // --- Asociaciones (sesión)
    expect((await assocRoute.GET(nextReq(`http://x/api/crm/associations?type=contact&id=${w.c2.id}`))).status).toBe(404);
    const own = (await (await assocRoute.GET(nextReq(`http://x/api/crm/associations?type=contact&id=${w.c1.id}`))).json()) as {
      companies: Array<{ id: string }>;
    };
    expect(own.companies.map((c) => c.id)).toEqual([co1.id]);
    const coList = (await (await assocRoute.GET(nextReq(`http://x/api/crm/associations?type=company&id=${co1.id}`))).json()) as {
      contacts: Array<{ id: string }>;
    };
    expect(coList.contacts.map((c) => c.id)).toEqual([w.c1.id]);
    const link = (from: string, to: string) => ({ fromType: 'contact', fromId: from, toType: 'company', toId: to });
    expect((await assocRoute.POST(send('http://x', 'POST', link(w.c2.id, co1.id)))).status).toBe(404);
    expect((await assocRoute.POST(send('http://x', 'POST', link(w.c1.id, w.co2.id)))).status).toBe(404);
    expect((await assocRoute.DELETE(send('http://x', 'DELETE', link(w.c1.id, w.co2.id)))).status).toBe(404);
    expect((await assocRoute.DELETE(send('http://x', 'DELETE', link(w.c2.id, co1.id)))).status).toBe(404);
    // Server actions de los paneles de asociación.
    await expect(assocActions.removeCompanyFromContact(w.c2.id, co1.id)).rejects.toThrow('not_found');
    await expect(assocActions.associateCompanyToContact(w.c1.id, w.co2.id)).rejects.toThrow('not_found');
    await expect(assocActions.addDealContact(w.d2.id, w.c1.id)).rejects.toThrow('not_found');
    // Nada cambió.
    const intact = (await listAssociations(w.owner.id, 'contact', w.c1.id))!;
    expect(intact.companies!.map((c) => c.id).sort()).toEqual([co1.id, w.co2.id].sort());
    expect((await listAssociations(w.owner.id, 'contact', w.c2.id))!.companies!.map((c) => c.id)).toEqual([co1.id]);
    // Lo propio sí se puede.
    expect((await assocRoute.DELETE(send('http://x', 'DELETE', link(w.c1.id, co1.id)))).status).toBe(204);

    // --- Asociaciones (v1)
    expect((await v1Assoc.GET(nextReq(`http://x/api/v1/crm/associations?type=contact&id=${w.c3.id}`, memberKey))).status).toBe(404);
    const v1Own = (await (await v1Assoc.GET(nextReq(`http://x/api/v1/crm/associations?type=contact&id=${w.c1.id}`, memberKey))).json()) as {
      companies: Array<{ id: string }>;
    };
    expect(v1Own.companies.map((c) => c.id)).toEqual([]);
    expect((await v1Assoc.POST(send('http://x', 'POST', link(w.c1.id, w.co2.id), memberKey))).status).toBe(404);
    expect(
      (await v1Assoc.DELETE(nextReq(`http://x/api/v1/crm/associations?fromType=contact&fromId=${w.c1.id}&toType=company&toId=${w.co2.id}`, memberKey)))
        .status,
    ).toBe(404);

    // --- Tags (sesión): bulk ignora ocultos, editor del registro da 404, conteos solo visibles
    const bulk = (await (await tagApplyRoute.POST(send('http://x', 'POST', { tagId: tag.id, entity: 'contact', ids: [w.c1.id, w.c2.id, w.c3.id], action: 'remove' }))).json()) as {
      count: number;
    };
    expect(bulk.count).toBe(1);
    expect((await tagRecordRoute.PUT(send('http://x', 'PUT', { entity: 'contact', recordId: w.c2.id, tagIds: [] }))).status).toBe(404);
    expect((await tagRecordRoute.PUT(send('http://x', 'PUT', { entity: 'contact', recordId: w.c1.id, tagIds: [tag.id] }))).status).toBe(200);
    const tagged = await tagsForRecords(w.owner.id, 'contact', [w.c1.id, w.c2.id, w.c3.id]);
    expect([w.c1.id, w.c2.id, w.c3.id].map((id) => (tagged.get(id) ?? []).length)).toEqual([1, 1, 1]);
    const tagList = (await (await tagsRoute.GET()).json()) as { rows: Array<{ id: string; contacts: number }> };
    expect(tagList.rows.find((r) => r.id === tag.id)?.contacts).toBe(1);

    // --- Tags (v1)
    const v1Bulk = (await (await v1TagRecords.POST(
      send('http://x', 'POST', { entity: 'contact', ids: [w.c2.id, w.c3.id], action: 'remove' }, memberKey),
      ctx(tag.id),
    )).json()) as { changed: number };
    expect(v1Bulk.changed).toBe(0);
    const after = await tagsForRecords(w.owner.id, 'contact', [w.c2.id, w.c3.id]);
    expect([w.c2.id, w.c3.id].map((id) => (after.get(id) ?? []).length)).toEqual([1, 1]);

    // Admin ve y toca todo.
    actAs(w.owner, w.adm, 'admin');
    expect((await assocRoute.GET(nextReq(`http://x/api/crm/associations?type=contact&id=${w.c2.id}`))).status).toBe(200);
  });
});

describe('scopes de API keys', () => {
  it('parse / serialize / hasScope', () => {
    expect(parseScopes('*')).toEqual([...API_SCOPES]);
    expect(parseScopes('crm:read links:write bogus')).toEqual(['crm:read', 'links:write']);
    expect(serializeScopes([...API_SCOPES])).toBe('*');
    expect(serializeScopes(['links:write', 'crm:read'])).toBe('crm:read links:write');
    expect(hasScope(['crm:write'], 'crm:read')).toBe(true);
    expect(hasScope(['crm:read'], 'crm:write')).toBe(false);
    expect(hasScope(['links:write'], 'crm:read')).toBe(false);
  });

  it('las rutas v1 exigen el scope (403 insufficient_scope); las keys viejas tienen todos', async () => {
    const owner = await makeUser('scope');
    const readOnly = (await createApiKey(owner.id, 'ro', owner.id, ['crm:read'])).key;
    const linksOnly = (await createApiKey(owner.id, 'links', owner.id, ['links:write'])).key;
    const legacy = (await createApiKey(owner.id, 'legacy')).key;

    expect((await v1Contacts.GET(nextReq('http://x/api/v1/crm/contacts', readOnly))).status).toBe(200);
    const denied = await v1Contacts.POST(send('http://x', 'POST', { email: 'x@y.co' }, readOnly));
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe('insufficient_scope');

    expect((await v1Contacts.GET(nextReq('http://x/api/v1/crm/contacts', linksOnly))).status).toBe(403);
    expect((await v1Links.GET(nextReq('http://x/api/v1/links', linksOnly))).status).toBe(200);
    expect((await v1EventTypes.GET(nextReq('http://x/api/v1/calendar/event-types', linksOnly))).status).toBe(403);

    expect((await v1Contacts.POST(send('http://x', 'POST', { email: 'legacy@y.co' }, legacy))).status).toBe(201);
    expect((await v1EventTypes.GET(nextReq('http://x/api/v1/calendar/event-types', legacy))).status).toBe(200);
  });
});

describe('round-robin de leads', () => {
  it('reparte parejo, saltea a quien está fuera de oficina y registra el historial', async () => {
    const w = await workspace();
    await saveAssignmentRule(w.owner.id, { enabled: true, sources: ['form', 'api'], pool: [w.m1.id, w.m2.id, w.adm.id, 'stranger'] });
    const counts: Record<string, number> = {};
    for (let i = 0; i < 9; i++) {
      const c = await createContact(w.owner.id, { email: `rr${i}@lead.io` });
      const p = await assignNewLead(w.owner.id, c.id, 'form');
      counts[p!] = (counts[p!] ?? 0) + 1;
    }
    expect(counts).toEqual({ [w.m1.id]: 3, [w.m2.id]: 3, [w.adm.id]: 3 });

    await setAvailability(w.owner.id, w.m2.id, false);
    const picks: string[] = [];
    for (let i = 0; i < 4; i++) picks.push((await pickNextOwner(w.owner.id))!);
    expect(picks).not.toContain(w.m2.id);
    expect(picks.filter((p) => p === w.m1.id)).toHaveLength(2);

    // Fuente no habilitada: no asigna.
    const chat = await createContact(w.owner.id, { email: 'chat@lead.io' });
    expect(await assignNewLead(w.owner.id, chat.id, 'chat')).toBeNull();

    const history = await listAssignmentHistory(w.owner.id, 100);
    expect(history).toHaveLength(9);
    expect(history.every((h) => h.source === 'form')).toBe(true);
  });

  it('los envíos de formulario sin owner fijo se asignan por round-robin', async () => {
    const w = await workspace();
    await saveAssignmentRule(w.owner.id, { enabled: true, sources: ['form'], pool: [w.m1.id, w.m2.id] });
    const form = await createForm(w.owner.id, { name: 'RR', settings: { minSubmitSeconds: 0 } });
    const a = await submitForm(form.token, { values: { email: 'a@rr.io' } });
    const b = await submitForm(form.token, { values: { email: 'b@rr.io' } });
    const owners = await Promise.all(
      [a, b].map(async (r) => {
        const id = (r as { contactId: string }).contactId;
        return ((await getDb().prepare('SELECT owner_id FROM crm_contacts WHERE id = ?').get(id)) as { owner_id: string }).owner_id;
      }),
    );
    expect(owners).toEqual([w.m1.id, w.m2.id]);
    // Owner fijo en el form: no hay round-robin.
    const fixed = await createForm(w.owner.id, { name: 'Fixed', settings: { minSubmitSeconds: 0, ownerId: w.adm.id } });
    const c = (await submitForm(fixed.token, { values: { email: 'c@rr.io' } })) as { contactId: string };
    const row = (await getDb().prepare('SELECT owner_id FROM crm_contacts WHERE id = ?').get(c.contactId)) as { owner_id: string };
    expect(row.owner_id).toBe(w.adm.id);
  });
});

describe('cuotas', () => {
  it('períodos y matemática de progreso', () => {
    const now = new Date(Date.UTC(2026, 10, 16, 12)); // 16 nov 2026
    const m = periodRange('month', now);
    expect(m).toMatchObject({ start: '2026-11-01 00:00:00', end: '2026-12-01 00:00:00', label: '2026-11' });
    expect(m.elapsed).toBeCloseTo((15.5 * 24) / (30 * 24), 3);
    const q = periodRange('quarter', now);
    expect(q).toMatchObject({ start: '2026-10-01 00:00:00', end: '2027-01-01 00:00:00', label: '2026-Q4' });
    expect(quotaMath(1000, 250, 0.5)).toEqual({ pct: 25, remaining: 750, expectedPct: 50, onTrack: false });
    expect(quotaMath(10, 12, 0.9)).toMatchObject({ pct: 120, remaining: 0, onTrack: true });
    expect(quotaMath(0, 0, 0.3)).toMatchObject({ pct: 0 });
  });

  it('progreso real: valor y deals ganados en el período, reuniones; filtra por visibilidad', async () => {
    const w = await workspace();
    const won = (await createStage(w.owner.id, w.pipeline.id, { name: 'Won' }))!;
    await updateStage(w.owner.id, won.id, { isWon: true });
    const inPeriod = await createDeal(w.owner.id, { name: 'Won now', pipelineId: w.pipeline.id, stageId: won.id, ownerId: w.m1.id, amount: 700 });
    const old = await createDeal(w.owner.id, { name: 'Won before', pipelineId: w.pipeline.id, stageId: won.id, ownerId: w.m1.id, amount: 5000 });
    if (!inPeriod.ok || !old.ok) throw new Error('deal');
    const now = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
    await getDb().prepare('UPDATE crm_deals SET closed_at = ? WHERE id = ?').run(fmt(now), inPeriod.deal.id);
    await getDb()
      .prepare('UPDATE crm_deals SET closed_at = ? WHERE id = ?')
      .run(fmt(new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 15))), old.deal.id);
    await createActivity(w.owner.id, { type: 'meeting', subject: 'Demo', contactId: w.c1.id, ownerId: w.m1.id });
    await createActivity(w.owner.id, { type: 'meeting', subject: 'Demo 2', contactId: w.c2.id, ownerId: w.m2.id });

    await upsertQuota(w.owner.id, { personId: w.m1.id, metric: 'won_value', period: 'month', target: 1000 });
    await upsertQuota(w.owner.id, { personId: w.m1.id, metric: 'won_count', period: 'quarter', target: 4 });
    await upsertQuota(w.owner.id, { personId: w.m1.id, metric: 'meetings', period: 'month', target: 10 });
    await upsertQuota(w.owner.id, { personId: w.m2.id, metric: 'meetings', period: 'month', target: 5 });
    // Upsert: mismo owner + métrica + período actualiza el objetivo.
    await upsertQuota(w.owner.id, { personId: w.m1.id, metric: 'won_value', period: 'month', target: 1400 });
    await expect(upsertQuota(w.owner.id, { personId: 'stranger', metric: 'meetings', period: 'month', target: 1 })).rejects.toThrow();

    const all = await quotaProgress(w.owner.id);
    expect(all).toHaveLength(4);
    const value = all.find((q) => q.personId === w.m1.id && q.metric === 'won_value')!;
    expect(value).toMatchObject({ target: 1400, actual: 700, pct: 50 });
    expect(all.find((q) => q.personId === w.m1.id && q.metric === 'won_count')!.actual).toBe(1);
    expect(all.find((q) => q.personId === w.m1.id && q.metric === 'meetings')!.actual).toBe(1);

    const mine = await quotaProgress(w.owner.id, { ownerIds: [w.m1.id] });
    expect(mine.every((q) => q.personId === w.m1.id)).toBe(true);
    expect(mine).toHaveLength(3);
  });
});

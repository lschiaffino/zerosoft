/**
 * CRM, segunda pasada: los asociados fuera de alcance salen como "Registro
 * privado" (sin nombre ni id), las listas dinámicas que filtran por un campo
 * oculto no existen para quien lo tiene oculto, las configs de reportes no
 * nombran campos ocultos, mover de etapa avisa cuando falta un campo que solo
 * completa un admin, los envíos de forms no traen lo que va a un campo
 * oculto, la empresa no nombra (ni por id) a una madre que no se ve y una
 * mención no avisa a quien no ve la nota. Miradas: owner, admin, miembro con
 * "mine", miembro de un equipo de ventas y otro workspace. Datos inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createActivity,
  createCompany,
  createContact,
  createCustomField,
  createDeal,
  createList,
  createPipeline,
  createStage,
  listCompanies,
  listContacts,
  listDeals,
  listDealsForBoard,
  getList,
  updateStage,
} from '@/lib/crm';
import { createLead, getLead, listLeads } from '@/lib/crm-leads';
import { MEMBER_SUBJECT, setFieldPermissions } from '@/lib/crm-field-perms';
import { createSalesTeam, setMemberVisibility } from '@/lib/crm-visibility';
import { maskPrivateRefs, PRIVATE_REFS } from '@/lib/crm-record-scope';
import { filterUsesHiddenField, isListRestricted, listsForViewer, withoutHiddenRules } from '@/lib/crm-list-access';
import {
  configUsesHidden,
  createCustomReport,
  hiddenKeyTest,
  redactReportConfig,
} from '@/lib/crm-custom-reports';
import { reportConfigSchema } from '@/lib/crm-report-builder';
import { getWidgetData } from '@/lib/crm-dashboards';
import { splitMissingForViewer } from '@/lib/crm-stage-move';
import { createForm, formFieldIdsFor, redactSubmissionData, submitForm } from '@/lib/crm-forms';
import type { FormField } from '@/lib/crm-forms-schema';
import { notifyMentionsDetailed, mentionsNotNotified, type MentionablePerson } from '@/lib/crm-mention-notify';
import { listNotifications } from '@/lib/notifications';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const leadsRoute = await import('@/app/api/crm/leads/route');
const leadRoute = await import('@/lib/routes/crm/leads/[id]/route');
const listsRoute = await import('@/app/api/crm/lists/route');
const listRoute = await import('@/lib/routes/crm/lists/[id]/route');
const reportsRoute = await import('@/app/api/crm/custom-reports/route');
const reportRoute = await import('@/lib/routes/crm/custom-reports/[id]/route');
const moveRoute = await import('@/lib/routes/crm/deals/[id]/move/route');
const companyRoute = await import('@/lib/routes/crm/companies/[id]/route');
const v1CompanyRoute = await import('@/lib/routes/v1/crm/companies/[id]/route');
const submissionsRoute = await import('@/lib/routes/crm/forms/[id]/submissions/route');
const formRoute = await import('@/lib/routes/crm/forms/[id]/route');
const activitiesRoute = await import('@/app/api/crm/activities/route');

beforeEach(() => {
  session.user = null;
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (url: string) => new NextRequest(url);
const send = (method: string, body: unknown, url = 'http://x') =>
  new NextRequest(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const json = async <T,>(res: Response) => (await res.json()) as T;

/**
 * Workspace con: `secret` (contactos, empresas, deals) oculto para el rol
 * member, `po` (deals) de solo lectura para member, `tier` (contactos) y
 * `margin` (deals) ocultos solo para el equipo de ventas de `friend`. Los
 * registros del owner quedan fuera del alcance de `member` con "mine".
 */
async function setup(label: string, visibility: 'mine' | 'team' = 'mine') {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  await setMemberVisibility(ws, visibility);
  for (const entity of ['contacts', 'companies', 'deals']) {
    const f = await createCustomField(ws, { entity, name: 'secret', label: 'Secret', type: 'text' });
    await setFieldPermissions(ws, f.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
  }
  const po = await createCustomField(ws, { entity: 'deals', name: 'po', label: 'PO', type: 'text' });
  await setFieldPermissions(ws, po.id, [{ subject: MEMBER_SUBJECT, access: 'read' }]);
  const team = await createSalesTeam(ws, { name: 'Field', members: [w.friend.id] });
  const tier = await createCustomField(ws, { entity: 'contacts', name: 'tier', label: 'Tier', type: 'text' });
  await setFieldPermissions(ws, tier.id, [{ subject: `team:${team.id}`, access: 'hidden' }]);
  const margin = await createCustomField(ws, { entity: 'deals', name: 'margin', label: 'Margin', type: 'text' });
  await setFieldPermissions(ws, margin.id, [{ subject: `team:${team.id}`, access: 'hidden' }]);

  const p = await createPipeline(ws, 'Sales');
  const stageA = (await createStage(ws, p.id, { name: 'Open' }))!;
  const stageB = (await createStage(ws, p.id, { name: 'Next' }))!;
  const ownerParent = await createCompany(ws, { name: 'Hidden Parent Co', ownerId: ws });
  const ownerCo = await createCompany(ws, { name: 'Hidden Owner Co', ownerId: ws });
  const memberCo = await createCompany(ws, { name: 'Member Co', ownerId: w.member.id, parentCompanyId: ownerParent.id });
  const ownerContact = await createContact(ws, {
    firstName: 'Hidden',
    lastName: 'Person',
    email: 'hidden-person@example.test',
    ownerId: ws,
    companyId: memberCo.id,
  });
  const memberContact = await createContact(ws, {
    firstName: 'Zeta',
    lastName: 'Member',
    email: 'zeta-member@example.test',
    ownerId: w.member.id,
    companyId: ownerCo.id,
    custom: { secret: 's-1', tier: 'gold' },
  });
  const friendContact = await createContact(ws, { firstName: 'Zeta', lastName: 'Friend', ownerId: w.friend.id, custom: { tier: 'gold' } });
  const deal = async (name: string, ownerId: string, extra: Record<string, unknown> = {}) => {
    const r = await createDeal(ws, { name, pipelineId: p.id, stageId: stageA.id, ownerId, ...extra });
    if (!r.ok) throw new Error('deal');
    return r.deal;
  };
  const memberDeal = await deal('Zeta member deal', w.member.id, { companyId: ownerCo.id, contactIds: [ownerContact.id] });
  const friendDeal = await deal('Zeta friend deal', w.friend.id, {});
  const ownerDeal = await deal('Hidden owner deal', ws, {});
  return { w, ws, p, stageA, stageB, ownerParent, ownerCo, memberCo, ownerContact, memberContact, friendContact, memberDeal, friendDeal, ownerDeal };
}

type Setup = Awaited<ReturnType<typeof setup>>;
const owner = (s: Setup) => asOwner(s.w.owner);
const admin = (s: Setup) => asMember(s.w.owner, s.w.friend, 'admin');
const member = (s: Setup) => asMember(s.w.owner, s.w.member);
const teamMember = (s: Setup) => asMember(s.w.owner, s.w.friend);
const stranger = (s: Setup) => asOwner(s.w.stranger);
const memberViewer = (s: Setup) => ({ workspaceId: s.ws, personId: s.w.member.id, role: 'member' as const });
const friendViewer = (s: Setup) => ({ workspaceId: s.ws, personId: s.w.friend.id, role: 'member' as const });

// ---------- 1. Asociados fuera de alcance ----------

describe('asociados que la persona no ve', () => {
  it('maskPrivateRefs deja sin nombre ni id al asociado y lo marca; sin alcance no toca nada', async () => {
    const s = await setup('p2-mask');
    const rows = [
      { id: 'a', company_id: s.ownerCo.id, company_name: 'Hidden Owner Co' },
      { id: 'b', company_id: s.memberCo.id, company_name: 'Member Co' },
      { id: 'c', company_id: null, company_name: null },
      { id: 'd', company_id: 'not-a-company', company_name: 'x' },
    ];
    const spec = [PRIVATE_REFS.company(['company_name'])];
    const out = await maskPrivateRefs(s.ws, rows, spec, [s.w.member.id]);
    expect(out[0]).toEqual({ id: 'a', company_id: null, company_name: null, company_private: true });
    expect(out[1]).toEqual(rows[1]);
    expect(out[2]).toEqual(rows[2]);
    expect(out[3]).toMatchObject({ company_id: null, company_private: true });
    expect(await maskPrivateRefs(s.ws, rows, spec, null)).toBe(rows);
    // Otro workspace: nada de este cuenta como visible.
    const other = await maskPrivateRefs(s.w.stranger.id, rows.slice(1, 2), spec, [s.w.stranger.id]);
    expect(other[0]).toMatchObject({ company_id: null, company_private: true });
  });

  it('leads: el contacto, la empresa y el deal que no se ven salen como privados, y la búsqueda no los usa', async () => {
    const s = await setup('p2-leads');
    const lead = await createLead(s.ws, {
      name: 'Zeta lead',
      ownerId: s.w.member.id,
      contactId: s.ownerContact.id,
      companyId: s.ownerCo.id,
    });
    await getDb().prepare('UPDATE crm_leads SET deal_id = ? WHERE id = ?').run(s.ownerDeal.id, lead.id);
    const rowsAs = async (u: SessionUser, q = '') => {
      session.user = u;
      const res = await leadsRoute.GET(get(`http://x/api/crm/leads${q ? `?q=${encodeURIComponent(q)}` : ''}`));
      return (await json<{ rows: Array<Record<string, unknown>> }>(res)).rows;
    };
    const [m] = await rowsAs(member(s));
    expect(m).toMatchObject({
      id: lead.id,
      contact_id: null,
      contact_name: null,
      contact_email: null,
      contact_private: true,
      company_id: null,
      company_name: null,
      company_private: true,
      deal_id: null,
      deal_name: null,
      deal_private: true,
    });
    expect(JSON.stringify(m)).not.toMatch(/Hidden|hidden-person/);
    // Buscar por el nombre de la empresa o del contacto que no ve no encuentra el lead.
    expect(await rowsAs(member(s), 'Hidden Owner')).toEqual([]);
    expect(await rowsAs(member(s), 'hidden-person')).toEqual([]);
    expect((await rowsAs(member(s), 'Zeta lead')).map((r) => r.id)).toEqual([lead.id]);

    const [o] = await rowsAs(owner(s));
    expect(o).toMatchObject({ contact_name: 'Hidden Person', company_name: 'Hidden Owner Co', deal_name: 'Hidden owner deal' });
    expect(o.contact_private).toBeUndefined();
    expect((await rowsAs(owner(s), 'Hidden Owner')).map((r) => r.id)).toEqual([lead.id]);
    const [a] = await rowsAs(admin(s));
    expect(a).toMatchObject({ company_name: 'Hidden Owner Co' });

    // La ficha del lead, igual.
    session.user = member(s);
    const detail = await json<Record<string, unknown>>(await leadRoute.GET(get('http://x'), ctx(lead.id)));
    expect(detail).toMatchObject({ contact_id: null, company_private: true, deal_private: true });
    expect((await getLead(s.ws, lead.id, null))?.company_name).toBe('Hidden Owner Co');

    // Otro workspace: ni el lead.
    expect(await rowsAs(stranger(s))).toEqual([]);
    session.user = stranger(s);
    expect((await leadRoute.GET(get('http://x'), ctx(lead.id))).status).toBe(404);
  });

  it('un miembro de un equipo de ventas ve los asociados de su equipo y no los demás', async () => {
    const s = await setup('p2-leads-team', 'team');
    await createLead(s.ws, { name: 'Friend lead', ownerId: s.w.friend.id, contactId: s.friendContact.id, companyId: s.ownerCo.id });
    session.user = teamMember(s);
    const { rows } = await json<{ rows: Array<Record<string, unknown>> }>(await leadsRoute.GET(get('http://x/api/crm/leads')));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ contact_name: 'Zeta Friend', company_private: true, company_name: null });
    expect((await listLeads(s.ws, { ownerScope: [s.w.friend.id] })).rows[0].contact_private).toBeUndefined();
  });

  it('contactos, empresas, deals, board y listas: la empresa o la madre que no se ve no se nombra, y los conteos son de lo que se ve', async () => {
    const s = await setup('p2-lists');
    const scope = [s.w.member.id];
    const contacts = (await listContacts(s.ws, { ownerScope: scope })).rows;
    expect(contacts.find((c) => c.id === s.memberContact.id)).toMatchObject({ company_id: null, company_name: null, company_private: true });
    const full = (await listContacts(s.ws, { ownerScope: null })).rows.find((c) => c.id === s.memberContact.id)!;
    expect(full.company_name).toBe('Hidden Owner Co');

    const companies = (await listCompanies(s.ws, { ownerScope: scope })).rows;
    const mc = companies.find((c) => c.id === s.memberCo.id)!;
    expect(mc).toMatchObject({ parent_company_id: null, parent_private: true });
    // Member Co tiene un contacto del owner: no se cuenta.
    expect(mc.contact_count).toBe(0);
    const mcAll = (await listCompanies(s.ws, { ownerScope: null })).rows.find((c) => c.id === s.memberCo.id)!;
    expect(mcAll).toMatchObject({ parent_company_id: s.ownerParent.id, contact_count: 1 });

    const deals = (await listDeals(s.ws, { pipelineId: s.p.id, ownerScope: scope })).rows;
    expect(deals.find((d) => d.id === s.memberDeal.id)).toMatchObject({ company_id: null, company_name: null, company_private: true });

    const board = await listDealsForBoard(s.ws, s.p.id, scope);
    const card = board.flatMap((c) => c.deals).find((d) => d.id === s.memberDeal.id)!;
    expect(card).toMatchObject({ contact_id: null, contact_name: null, contact_private: true, company_name: null, company_private: true });
    const ownCard = (await listDealsForBoard(s.ws, s.p.id, null)).flatMap((c) => c.deals).find((d) => d.id === s.memberDeal.id)!;
    expect(ownCard).toMatchObject({ contact_name: 'Hidden Person', company_name: 'Hidden Owner Co' });

    const list = await createList(s.ws, { name: 'Dyn', kind: 'dynamic', filter: { q: 'Zeta' } });
    const detail = (await getList(s.ws, list.id, scope))!;
    expect(detail.members.map((m) => m.id)).toEqual([s.memberContact.id]);
    expect(detail.members[0]).toMatchObject({ company_name: null, company_private: true });
  });
});

// ---------- 2. Listas dinámicas con campos ocultos ----------

describe('listas dinámicas que filtran por un campo oculto', () => {
  it('no existen para quien tiene el campo oculto: ni en el índice, ni su detalle, ni se editan o borran', async () => {
    const s = await setup('p2-dyn');
    const secretList = await createList(s.ws, { name: 'By secret', kind: 'dynamic', filter: { filters: [{ f: 'custom:secret', o: 'equals', v: 's-1' }] } });
    const tierList = await createList(s.ws, { name: 'By tier', kind: 'dynamic', filter: { filters: [{ f: 'custom:tier', o: 'equals', v: 'gold' }] } });
    const plain = await createList(s.ws, { name: 'Plain', kind: 'dynamic', filter: { q: 'Zeta' } });
    const index = async (u: SessionUser) => {
      session.user = u;
      return (await json<{ rows: Array<{ id: string; filter: string }> }>(await listsRoute.GET())).rows.map((r) => r.id);
    };
    expect(await index(member(s))).toEqual(expect.arrayContaining([tierList.id, plain.id]));
    expect(await index(member(s))).not.toContain(secretList.id);
    expect(await index(teamMember(s))).toEqual([plain.id]);
    expect(await index(owner(s))).toEqual(expect.arrayContaining([secretList.id, tierList.id, plain.id]));
    expect(await index(admin(s))).toEqual(expect.arrayContaining([secretList.id, tierList.id]));
    expect(await index(stranger(s))).toEqual([]);

    const status = async (u: SessionUser, id: string) => {
      session.user = u;
      return {
        get: (await listRoute.GET(get('http://x'), ctx(id))).status,
        patch: (await listRoute.PATCH(send('PATCH', { name: 'Renamed' }), ctx(id))).status,
      };
    };
    expect(await status(member(s), secretList.id)).toEqual({ get: 404, patch: 404 });
    expect(await status(teamMember(s), tierList.id)).toEqual({ get: 404, patch: 404 });
    session.user = member(s);
    expect((await listRoute.DELETE(get('http://x'), ctx(secretList.id))).status).toBe(404);
    expect(await status(stranger(s), plain.id)).toEqual({ get: 404, patch: 404 });
    // El nombre no cambió y la lista sigue para el owner, con su filtro entero.
    session.user = owner(s);
    const full = await json<{ list: { name: string; filter: string }; memberCount: number }>(await listRoute.GET(get('http://x'), ctx(secretList.id)));
    expect(full.list.name).toBe('By secret');
    expect(JSON.parse(full.list.filter)).toMatchObject({ filters: [{ f: 'custom:secret' }] });
    expect(full.memberCount).toBe(1);
    // La que sí ve un miembro trae su filtro y lo que ve.
    session.user = member(s);
    const mine = await json<{ members: Array<{ id: string }> }>(await listRoute.GET(get('http://x'), ctx(tierList.id)));
    expect(mine.members.map((m) => m.id)).toEqual([s.memberContact.id]);
  });

  it('un miembro no guarda reglas sobre campos que tiene ocultos', async () => {
    const s = await setup('p2-dyn-write');
    session.user = member(s);
    const res = await listsRoute.POST(
      send('POST', { name: 'Try', kind: 'dynamic', filter: { filters: [{ f: 'custom:secret', o: 'equals', v: 's-1' }, { f: 'custom:tier', o: 'equals', v: 'gold' }] } }),
    );
    const created = await json<{ id: string; filter: string }>(res);
    expect(JSON.parse(created.filter).filters).toEqual([{ f: 'custom:tier', o: 'equals', v: 'gold' }]);
    expect((await listsForViewer(memberViewer(s), [s.w.member.id])).map((l) => l.id)).toContain(created.id);
    expect((await listsForViewer(friendViewer(s), [s.w.friend.id])).map((l) => l.id)).not.toContain(created.id);
  });

  it('las funciones puras', () => {
    const hidden = new Set(['secret']);
    expect(filterUsesHiddenField({ filters: [{ f: 'custom:secret', o: 'is', v: 'x' }] }, hidden)).toBe(true);
    expect(filterUsesHiddenField({ filters: [{ f: 'lifecycle', o: 'is', v: 'lead' }] }, hidden)).toBe(false);
    expect(isListRestricted({ kind: 'static', filter: '{"filters":[{"f":"custom:secret","o":"is","v":"x"}]}' }, hidden)).toBe(false);
    expect(isListRestricted({ kind: 'dynamic', filter: '{"filters":[{"f":"custom:secret","o":"is","v":"x"}]}' }, hidden)).toBe(true);
    expect(withoutHiddenRules({ filters: [{ f: 'custom:secret', o: 'is' }, { f: 'custom:tier', o: 'is' }] }, hidden)).toEqual({
      filters: [{ f: 'custom:tier', o: 'is' }],
    });
  });
});

// ---------- 3. Reportes guardados y widgets ----------

describe('config de reportes guardados', () => {
  const secretConfig = reportConfigSchema.parse({
    source: 'deals',
    columns: ['deal.name', 'deal.custom:secret', 'deal.custom:margin'],
    filters: [{ f: 'deal.custom:secret', o: 'eq', v: 's-deal' }],
    dimensions: [],
  });

  it('no nombra campos ocultos ni deja reescribir la config que los usa', async () => {
    const s = await setup('p2-report');
    const report = await createCustomReport(s.ws, { name: 'Margins', config: secretConfig, createdBy: s.ws });
    const read = async (u: SessionUser) => {
      session.user = u;
      return json<{ config: { columns: string[]; filters: Array<{ f: string }> } }>(await reportRoute.GET(get('http://x'), ctx(report.id)));
    };
    const asMemberCfg = (await read(member(s))).config;
    expect(asMemberCfg.columns).toEqual(['deal.name', 'deal.custom:margin']);
    expect(asMemberCfg.filters).toEqual([]);
    expect(JSON.stringify(asMemberCfg)).not.toContain('secret');
    expect((await read(teamMember(s))).config.columns).toEqual(['deal.name']);
    expect((await read(owner(s))).config.columns).toContain('deal.custom:secret');
    expect((await read(admin(s))).config.filters).toHaveLength(1);
    session.user = stranger(s);
    expect((await reportRoute.GET(get('http://x'), ctx(report.id))).status).toBe(404);

    session.user = member(s);
    const listed = await json<{ rows: Array<{ id: string; config: unknown }> }>(await reportsRoute.GET());
    expect(JSON.stringify(listed.rows.find((r) => r.id === report.id))).not.toContain('secret');

    // No reescribe la config de un reporte con campos que no ve (borraría lo que no ve); renombrar sí.
    const patch = (body: unknown) => reportRoute.PATCH(send('PATCH', body), ctx(report.id));
    const cfg = reportConfigSchema.parse({ source: 'deals', columns: ['deal.name'] });
    expect((await patch({ config: cfg })).status).toBe(403);
    expect((await patch({ name: 'Renamed' })).status).toBe(200);
    // Ni crea uno que use un campo oculto.
    expect((await reportsRoute.POST(send('POST', { name: 'Try', config: secretConfig }))).status).toBe(400);
    session.user = owner(s);
    expect((await patch({ config: cfg })).status).toBe(200);
  });

  it('el widget de dashboard no trae la config con el campo oculto', async () => {
    const s = await setup('p2-widget');
    const report = await createCustomReport(s.ws, { name: 'Margins', config: secretConfig, createdBy: s.ws });
    const req = { type: 'custom_report' as const, reportId: report.id };
    const asMember = await getWidgetData(s.ws, req, [], [s.w.member.id], null, memberViewer(s));
    expect(JSON.stringify(asMember)).not.toContain('secret');
    const asOwnerData = await getWidgetData(s.ws, req, [], undefined, null, { workspaceId: s.ws, personId: s.ws, role: 'owner' });
    expect(JSON.stringify(asOwnerData)).toContain('deal.custom:secret');
  });

  it('las funciones puras', () => {
    const isHidden = hiddenKeyTest({ deals: new Set(['secret']), companies: new Set(['x']) });
    expect(isHidden('deal.custom:secret')).toBe(true);
    expect(isHidden('company.custom:x')).toBe(true);
    expect(isHidden('deal.name')).toBe(false);
    expect(isHidden('activity.custom:secret')).toBe(false);
    const cfg = reportConfigSchema.parse({ source: 'deals', columns: ['deal.name'], metric: { agg: 'sum', field: 'deal.custom:secret' }, viz: 'bar' });
    expect(configUsesHidden(cfg, isHidden)).toBe(true);
    expect(redactReportConfig(cfg, isHidden).metric).toEqual({ agg: 'count' });
    expect(redactReportConfig(cfg, () => false)).toBe(cfg);
  });
});

// ---------- 4. Mover de etapa con un campo que solo completa un admin ----------

describe('mover de etapa con un campo obligatorio que la persona no puede completar', () => {
  it('avisa que lo completa un admin, sin nombrar los ocultos', async () => {
    const s = await setup('p2-move');
    await updateStage(s.ws, s.stageB.id, { requiredFields: ['custom:secret', 'custom:po', 'custom:margin'] });
    const move = async (u: SessionUser, dealId: string, dryRun = false) => {
      session.user = u;
      const res = await moveRoute.POST(send('POST', { stageId: s.stageB.id, ...(dryRun ? { dryRun: true } : {}) }), ctx(dealId));
      return { status: res.status, body: await json<{ adminRequired?: boolean; missing?: Array<{ key: string }> }>(res) };
    };
    for (const dry of [true, false]) {
      const m = await move(member(s), s.memberDeal.id, dry);
      expect(m.status).toBe(dry ? 200 : 422);
      expect(m.body.adminRequired).toBe(true);
      expect(m.body.missing!.map((f) => f.key)).toEqual(['custom:margin']);
      expect(JSON.stringify(m.body)).not.toContain('secret');
    }
    const t = await move(teamMember(s), s.friendDeal.id);
    expect(t.status).toBe(422);
    expect(t.body.adminRequired).toBe(true);
    expect(t.body.missing).toEqual([]);

    const o = await move(owner(s), s.memberDeal.id, true);
    expect(o.body.adminRequired).toBe(false);
    expect(o.body.missing!.map((f) => f.key).sort()).toEqual(['custom:margin', 'custom:po', 'custom:secret']);
    const a = await move(admin(s), s.memberDeal.id, true);
    expect(a.body.adminRequired).toBe(false);
    expect((await move(stranger(s), s.memberDeal.id)).status).toBe(404);
  });

  it('splitMissingForViewer', () => {
    const restricted = new Map<string, 'read' | 'hidden'>([['secret', 'hidden'], ['po', 'read']]);
    expect(splitMissingForViewer(['amount', 'custom:secret', 'custom:po', 'custom:free'], restricted)).toEqual({
      fillable: ['amount', 'custom:free'],
      adminRequired: true,
    });
    expect(splitMissingForViewer(['amount'], restricted)).toEqual({ fillable: ['amount'], adminRequired: false });
  });
});

// ---------- 5. Envíos de forms ----------

describe('envíos de forms', () => {
  const FIELDS: FormField[] = [
    { id: 'email', type: 'email', label: 'Email', property: 'email', required: true },
    { id: 'budget', type: 'text', label: 'Budget', property: 'custom.secret', required: false },
    { id: 'tierq', type: 'text', label: 'Tier', property: 'custom.tier', required: false },
    { id: 'note', type: 'text', label: 'Note', property: '', required: false },
  ];

  it('no traen lo que va a un campo propio oculto (tabla, CSV, form) y la nota no lo copia', async () => {
    const s = await setup('p2-forms');
    const form = await createForm(s.ws, {
      name: 'Signup',
      fields: FIELDS,
      settings: { minSubmitSeconds: 0, ownerId: s.w.member.id },
      createdBy: s.w.member.id,
    });
    const sent = await submitForm(form.token, { values: { email: 'form-lead@example.test', budget: 'b-900', tierq: 't-gold', note: 'hello' }, elapsedMs: 9000 });
    expect(sent).toMatchObject({ ok: true });
    const data = async (u: SessionUser) => {
      session.user = u;
      const res = await submissionsRoute.GET(get(`http://x/api/crm/forms/${form.id}/submissions`), ctx(form.id));
      return (await json<{ rows: Array<{ data: string }> }>(res)).rows.map((r) => JSON.parse(r.data) as Record<string, unknown>);
    };
    expect((await data(member(s)))[0]).toEqual({ email: 'form-lead@example.test', tierq: 't-gold', note: 'hello' });
    expect((await data(teamMember(s)))).toEqual([]); // el contacto es de member: fuera del alcance de friend con "mine"
    expect((await data(owner(s)))[0]).toMatchObject({ budget: 'b-900', tierq: 't-gold' });
    expect((await data(admin(s)))[0]).toMatchObject({ budget: 'b-900' });
    session.user = stranger(s);
    expect((await submissionsRoute.GET(get('http://x'), ctx(form.id))).status).toBe(404);

    session.user = member(s);
    const csv = await (await submissionsRoute.GET(get(`http://x/api/crm/forms/${form.id}/submissions?format=csv`), ctx(form.id))).text();
    expect(csv).not.toContain('b-900');
    expect(csv).toContain('t-gold');
    // El form no nombra la propiedad oculta y quien lo creó no lo reescribe sin verla.
    const shown = await json<{ fields: FormField[] }>(await formRoute.GET(get('http://x'), ctx(form.id)));
    expect(shown.fields.find((f) => f.id === 'budget')?.property).toBe('');
    expect((await formRoute.PATCH(send('PATCH', { name: 'Renamed' }), ctx(form.id))).status).toBe(403);

    // La nota del envío (la ve todo el equipo) no copia lo que va a un campo que alguien tiene oculto.
    const notes = (await getDb()
      .prepare("SELECT body FROM crm_activities WHERE user_id = ? AND type = 'note'")
      .all(s.ws)) as Array<{ body: string }>;
    const body = notes.map((n) => n.body).join('\n');
    expect(body).not.toContain('b-900');
    expect(body).not.toContain('t-gold');
    expect(body).toContain('hello');
  });

  it('un miembro de un equipo de ventas no ve lo que va a un campo oculto para su equipo', async () => {
    const s = await setup('p2-forms-team', 'team');
    const form = await createForm(s.ws, { name: 'Signup', fields: FIELDS, settings: { minSubmitSeconds: 0, ownerId: s.w.friend.id } });
    await submitForm(form.token, { values: { email: 'team-lead@example.test', budget: 'b-1', tierq: 't-1' }, elapsedMs: 9000 });
    session.user = teamMember(s);
    const res = await submissionsRoute.GET(get('http://x'), ctx(form.id));
    const [row] = (await json<{ rows: Array<{ data: string }> }>(res)).rows;
    expect(JSON.parse(row.data)).toEqual({ email: 'team-lead@example.test', note: '' });
  });

  it('las funciones puras', () => {
    const ids = formFieldIdsFor(
      [
        { id: 'a', property: 'custom.secret' },
        { id: 'b', property: 'company.custom.secret' },
        { id: 'c', property: 'company.name' },
        { id: 'd', property: '' },
      ],
      { contacts: new Set(['secret']), companies: new Set(['secret']) },
    );
    expect([...ids].sort()).toEqual(['a', 'b']);
    expect(redactSubmissionData('{"a":1,"c":2}', new Set(['a']))).toBe('{"c":2}');
    expect(redactSubmissionData('{"a":1}', new Set())).toBe('{"a":1}');
  });
});

// ---------- 6. Empresa madre fuera de alcance ----------

describe('ficha de empresa con una madre que no se ve', () => {
  it('parent_company_id sale en null para el miembro (app y API) y entero para owner y admin', async () => {
    const s = await setup('p2-parent');
    const detail = async (u: SessionUser) => {
      session.user = u;
      const res = await companyRoute.GET(get('http://x'), ctx(s.memberCo.id));
      return res.status === 200 ? json<{ company: { parent_company_id: string | null }; parent: unknown }>(res) : null;
    };
    const m = (await detail(member(s)))!;
    expect(m.company.parent_company_id).toBeNull();
    expect(m.parent).toBeNull();
    expect(JSON.stringify(m)).not.toContain(s.ownerParent.id);
    expect((await detail(owner(s)))!.company.parent_company_id).toBe(s.ownerParent.id);
    expect((await detail(admin(s)))!.company.parent_company_id).toBe(s.ownerParent.id);
    expect(await detail(stranger(s))).toBeNull();
    // El PATCH tampoco devuelve el id.
    session.user = member(s);
    const patched = await json<{ parent_company_id: string | null }>(await companyRoute.PATCH(send('PATCH', { industry: 'Retail' }), ctx(s.memberCo.id)));
    expect(patched.parent_company_id).toBeNull();
  });

  it('la API v1 con la key de un miembro tampoco', async () => {
    const s = await setup('p2-parent-v1');
    const { createApiKey } = await import('@/lib/api-auth');
    const key = await createApiKey(s.ws, 'k', s.w.member.id, ['crm:read']);
    const res = await v1CompanyRoute.GET(
      new NextRequest(`http://x/api/v1/crm/companies/${s.memberCo.id}`, { headers: { authorization: `Bearer ${key.key}` } }),
      ctx(s.memberCo.id),
    );
    expect(res.status).toBe(200);
    expect((await json<{ parent_company_id: string | null }>(res)).parent_company_id).toBeNull();
  });
});

// ---------- 7. Menciones ----------

describe('menciones a quien no ve la nota', () => {
  it('no le llega nada y a quien escribe se le avisa', async () => {
    const s = await setup('p2-mentions');
    const people: MentionablePerson[] = [
      { id: s.ws, name: 'Olga Owner', email: s.w.owner.email, role: 'owner' },
      { id: s.w.member.id, name: 'Mia Member', email: s.w.member.email, role: 'member' },
      { id: s.w.friend.id, name: 'Fede Friend', email: s.w.friend.email, role: 'admin' },
    ];
    const note = await createActivity(s.ws, { type: 'note', body: '@Mia Member @Fede Friend look', contactId: s.ownerContact.id });
    const res = await notifyMentionsDetailed({
      activity: note,
      actor: { id: s.ws, name: 'Olga Owner', email: s.w.owner.email },
      people,
      workspaceId: s.ws,
    });
    expect(res).toEqual({ notified: [s.w.friend.id], withoutAccess: [s.w.member.id] });
    expect(await listNotifications(s.w.member.id)).toHaveLength(0);
    expect(await listNotifications(s.w.friend.id)).toHaveLength(1);
    expect(mentionsNotNotified(res.withoutAccess, people)).toEqual({ mentions_not_notified: [{ id: s.w.member.id, name: 'Mia Member' }] });
    expect(mentionsNotNotified([], people)).toEqual({});

    // Una nota de un lead que la persona no ve, tampoco (aunque no tenga contacto, empresa ni deal).
    const lead = await createLead(s.ws, { name: 'Owner lead', ownerId: s.ws });
    const leadNote = await createActivity(s.ws, { type: 'note', body: '@Mia Member mirá', leadId: lead.id, ownerId: s.w.member.id });
    const r2 = await notifyMentionsDetailed({ activity: leadNote, actor: { id: s.ws, name: null, email: s.w.owner.email }, people, workspaceId: s.ws });
    expect(r2).toEqual({ notified: [], withoutAccess: [s.w.member.id] });
    expect(await listNotifications(s.w.member.id)).toHaveLength(0);
  });

  it('la ruta guarda la nota y responde quiénes no fueron avisados; un compañero de equipo que la ve sí recibe', async () => {
    const s = await setup('p2-mentions-route', 'team');
    // friend (member, equipo Field) escribe en su contacto y menciona a member, que no está en su equipo.
    session.user = teamMember(s);
    const res = await activitiesRoute.POST(
      send('POST', { type: 'note', body: `@${s.w.member.email} y @${s.w.owner.email}`, contactId: s.friendContact.id }),
    );
    expect(res.status).toBe(201);
    const body = await json<{ id: string; mentions_not_notified?: Array<{ id: string }> }>(res);
    expect(body.mentions_not_notified?.map((m) => m.id)).toEqual([s.w.member.id]);
    expect(await listNotifications(s.w.member.id)).toHaveLength(0);
    expect((await listNotifications(s.ws)).length).toBe(1);

    // Otro workspace no puede escribir en ese contacto.
    session.user = stranger(s);
    expect((await activitiesRoute.POST(send('POST', { type: 'note', body: 'x', contactId: s.friendContact.id }))).status).not.toBe(201);
  });
});

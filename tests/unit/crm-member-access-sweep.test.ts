/**
 * CRM: lo que llega a cada persona respeta el alcance de registros (owner,
 * "mine", equipos de venta) y los permisos por campo, en las búsquedas, las
 * fichas con sus asociados, las listas, los reportes propios, el board, mover
 * de etapa y las fusiones. Miradas: owner, admin, miembro con "mine", miembro
 * de un equipo de ventas y otro workspace. Los datos son inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  addListMembers,
  createCompany,
  createContact,
  createCustomField,
  createDeal,
  createList,
  createPipeline,
  createStage,
} from '@/lib/crm';
import { MEMBER_SUBJECT, redactDetailWith, setFieldPermissions } from '@/lib/crm-field-perms';
import { createSalesTeam, setMemberVisibility } from '@/lib/crm-visibility';
import { builderCustomFields, ReportError, runReport } from '@/lib/crm-custom-reports';
import { reportConfigSchema } from '@/lib/crm-report-builder';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const searchRoute = await import('@/app/api/crm/search/route');
const contactRoute = await import('@/lib/routes/crm/contacts/[id]/route');
const companyRoute = await import('@/lib/routes/crm/companies/[id]/route');
const dealRoute = await import('@/lib/routes/crm/deals/[id]/route');
const listRoute = await import('@/lib/routes/crm/lists/[id]/route');
const reportRunRoute = await import('@/app/api/crm/custom-reports/run/route');
const moveRoute = await import('@/lib/routes/crm/deals/[id]/move/route');
const dealsRoute = await import('@/app/api/crm/deals/route');
const contactMergeRoute = await import('@/app/api/crm/contacts/merge/route');
const listMembersRoute = await import('@/lib/routes/crm/lists/[id]/members/route');
const { listLists } = await import('@/lib/crm');

beforeEach(() => {
  session.user = null;
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (url: string) => new NextRequest(url);
const post = (url: string, body: unknown) =>
  new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const customOf = (row: { custom: string }) => JSON.parse(row.custom) as Record<string, unknown>;

/**
 * Workspace con: `secret` (contactos, empresas y deals) oculto para el rol
 * member, `po` (deals) de solo lectura para member, `margin` (deals) oculto
 * solo para el equipo de ventas de `friend`. `member` es dueño de sus
 * registros y `friend` de los suyos; el owner tiene los demás.
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
  const margin = await createCustomField(ws, { entity: 'deals', name: 'margin', label: 'Margin', type: 'text' });
  const team = await createSalesTeam(ws, { name: 'Field', members: [w.friend.id] });
  await setFieldPermissions(ws, margin.id, [{ subject: `team:${team.id}`, access: 'hidden' }]);

  const p = await createPipeline(ws, 'Sales');
  const stageA = (await createStage(ws, p.id, { name: 'Open' }))!;
  const stageB = (await createStage(ws, p.id, { name: 'Next' }))!;
  const deal = async (name: string, ownerId: string, extra: Record<string, unknown> = {}) => {
    const r = await createDeal(ws, { name, pipelineId: p.id, stageId: stageA.id, ownerId, ...extra });
    if (!r.ok) throw new Error('deal');
    return r.deal;
  };

  const parent = await createCompany(ws, { name: 'Parent Co', ownerId: ws, custom: { secret: 's-parent' } });
  const memberCo = await createCompany(ws, { name: 'Member Co', ownerId: w.member.id, parentCompanyId: parent.id, custom: { secret: 's-co' } });
  const memberContact = await createContact(ws, {
    firstName: 'Zeta',
    lastName: 'Member',
    email: 'zeta-member@example.test',
    ownerId: w.member.id,
    companyId: memberCo.id,
    custom: { secret: 's-contact' },
  });
  const ownerContact = await createContact(ws, { firstName: 'Zeta', lastName: 'Owner', email: 'zeta-owner@example.test', ownerId: ws, custom: { secret: 's-owner' } });
  const memberDeal = await deal('Zeta member deal', w.member.id, {
    companyId: memberCo.id,
    contactIds: [memberContact.id],
    amount: 100,
    custom: { secret: 's-deal', po: 'po-1', margin: 'm-1' },
  });
  const ownerDeal = await deal('Zeta owner deal', ws, { companyId: memberCo.id, amount: 900, custom: { secret: 's-owner-deal' } });
  const friendDeal = await deal('Zeta friend deal', w.friend.id, { amount: 50, custom: { secret: 's-friend', margin: 'm-2' } });
  return { w, ws, p, stageA, stageB, parent, memberCo, memberContact, ownerContact, memberDeal, ownerDeal, friendDeal };
}

type Setup = Awaited<ReturnType<typeof setup>>;
const owner = (s: Setup) => asOwner(s.w.owner);
const admin = (s: Setup) => asMember(s.w.owner, s.w.friend, 'admin');
const member = (s: Setup) => asMember(s.w.owner, s.w.member);
const teamMember = (s: Setup) => asMember(s.w.owner, s.w.friend);
const stranger = (s: Setup) => asOwner(s.w.stranger);

describe('búsqueda del CRM', () => {
  it('cada persona recibe solo sus registros y sin los campos que tiene ocultos', async () => {
    const s = await setup('sweep-search');
    const search = async (u: SessionUser) => {
      session.user = u;
      return (await (await searchRoute.GET(get('http://x/api/crm/search?q=Zeta'))).json()) as {
        contacts: Array<{ id: string; custom: string }>;
        deals: Array<{ id: string; custom: string }>;
      };
    };
    const asOwnerRes = await search(owner(s));
    expect(asOwnerRes.contacts.map((c) => c.id).sort()).toEqual([s.memberContact.id, s.ownerContact.id].sort());
    expect(asOwnerRes.contacts.every((c) => 'secret' in customOf(c))).toBe(true);

    const asAdminRes = await search(admin(s));
    expect(asAdminRes.deals.find((d) => d.id === s.memberDeal.id) && customOf(asAdminRes.deals.find((d) => d.id === s.memberDeal.id)!)).toMatchObject({ secret: 's-deal' });

    const asMemberRes = await search(member(s));
    expect(asMemberRes.contacts.map((c) => c.id)).toEqual([s.memberContact.id]);
    expect(customOf(asMemberRes.contacts[0])).toEqual({});
    expect(asMemberRes.deals.map((d) => d.id)).toEqual([s.memberDeal.id]);
    expect(customOf(asMemberRes.deals[0])).toEqual({ po: 'po-1', margin: 'm-1' });

    const asStranger = await search(stranger(s));
    expect(asStranger.contacts).toEqual([]);
    expect(asStranger.deals).toEqual([]);
  });

  it('un miembro de un equipo de ventas no recibe los campos ocultos para su equipo', async () => {
    const s = await setup('sweep-search-team', 'team');
    session.user = teamMember(s);
    const res = (await (await searchRoute.GET(get('http://x/api/crm/search?q=Zeta'))).json()) as { deals: Array<{ id: string; custom: string }> };
    expect(res.deals.map((d) => d.id)).toEqual([s.friendDeal.id]);
    expect(customOf(res.deals[0])).toEqual({});
  });
});

describe('fichas con sus asociados', () => {
  it('la ficha de contacto no trae campos ocultos de su empresa ni de sus deals', async () => {
    const s = await setup('sweep-contact');
    session.user = member(s);
    const res = await contactRoute.GET(get('http://x'), ctx(s.memberContact.id));
    const body = (await res.json()) as { contact: { custom: string }; company: { custom: string }; deals: Array<{ id: string; custom: string }> };
    expect(customOf(body.contact)).toEqual({});
    expect(customOf(body.company)).toEqual({});
    expect(body.deals.map((d) => d.id)).toEqual([s.memberDeal.id]);
    expect(customOf(body.deals[0])).toEqual({ po: 'po-1', margin: 'm-1' });

    session.user = owner(s);
    const full = (await (await contactRoute.GET(get('http://x'), ctx(s.memberContact.id))).json()) as { company: { custom: string } };
    expect(customOf(full.company)).toEqual({ secret: 's-co' });

    session.user = stranger(s);
    expect((await contactRoute.GET(get('http://x'), ctx(s.memberContact.id))).status).toBe(404);
  });

  it('la ficha de deal no trae campos ocultos de sus contactos ni empresas', async () => {
    const s = await setup('sweep-deal');
    session.user = member(s);
    const body = (await (await dealRoute.GET(get('http://x'), ctx(s.memberDeal.id))).json()) as {
      deal: { custom: string };
      contacts: Array<{ custom: string }>;
      companies: Array<{ custom: string }>;
    };
    expect(customOf(body.deal)).toEqual({ po: 'po-1', margin: 'm-1' });
    expect(body.contacts.map(customOf)).toEqual([{}]);
    expect(body.companies.map(customOf)).toEqual([{}]);
  });

  it('la ficha de empresa cuenta solo los deals que se ven y no nombra madres que no se ven', async () => {
    const s = await setup('sweep-company');
    session.user = member(s);
    const body = (await (await companyRoute.GET(get('http://x'), ctx(s.memberCo.id))).json()) as {
      company: { custom: string };
      deals: Array<{ id: string; custom: string }>;
      parent: unknown;
      ancestors: unknown[];
      rollup: { own: { open: number; count: number } };
    };
    expect(customOf(body.company)).toEqual({});
    expect(body.deals.map((d) => d.id)).toEqual([s.memberDeal.id]);
    expect(body.rollup.own).toMatchObject({ open: 100, count: 1 });
    expect(body.parent).toBeNull();
    expect(body.ancestors).toEqual([]);

    session.user = owner(s);
    const full = (await (await companyRoute.GET(get('http://x'), ctx(s.memberCo.id))).json()) as typeof body;
    expect(full.rollup.own).toMatchObject({ open: 1000, count: 2 });
    expect(full.ancestors).toHaveLength(1);
    expect(customOf(full.company)).toEqual({ secret: 's-co' });
  });

  it('redactDetailWith aplica a cada asociado las reglas de su entidad', () => {
    const detail = {
      contact: { custom: '{"a":1,"b":2}' },
      company: { custom: '{"a":1,"c":3}' },
      companies: [{ custom: '{"c":3}' }],
      deals: [{ custom: '{"a":1,"d":4}' }],
      lists: [{ name: 'x' }],
    };
    const out = redactDetailWith('contact', detail, { contacts: new Set(['b']), companies: new Set(['c']), deals: new Set(['d']) });
    expect(out.contact.custom).toBe('{"a":1}');
    expect(out.company.custom).toBe('{"a":1}');
    expect(out.companies[0].custom).toBe('{}');
    expect(out.deals[0].custom).toBe('{"a":1}');
    expect(out.lists).toEqual([{ name: 'x' }]);
  });
});

describe('listas estáticas', () => {
  it('muestran solo los contactos que la persona ve, sin sus campos ocultos', async () => {
    const s = await setup('sweep-list');
    const list = await createList(s.ws, { name: 'Static', entity: 'contacts', kind: 'static' });
    await addListMembers(s.ws, list.id, [s.memberContact.id, s.ownerContact.id]);
    const members = async (u: SessionUser) => {
      session.user = u;
      const res = await listRoute.GET(get('http://x'), ctx(list.id));
      return res.status === 200 ? ((await res.json()) as { members: Array<{ id: string; custom: string }>; memberCount: number }) : null;
    };
    const m = await members(member(s));
    expect(m!.members.map((c) => c.id)).toEqual([s.memberContact.id]);
    expect(m!.memberCount).toBe(1);
    expect(customOf(m!.members[0])).toEqual({});
    const a = await members(admin(s));
    expect(a!.members).toHaveLength(2);
    expect(a!.members.every((c) => 'secret' in customOf(c))).toBe(true);
    expect(await members(stranger(s))).toBeNull();

    // El índice de listas cuenta lo mismo que ve la persona.
    expect((await listLists(s.ws, [s.w.member.id])).find((l) => l.id === list.id)?.memberCount).toBe(1);
    expect((await listLists(s.ws, null)).find((l) => l.id === list.id)?.memberCount).toBe(2);
  });

  it('un miembro no agrega ni quita contactos que no ve', async () => {
    const s = await setup('sweep-list-write');
    const list = await createList(s.ws, { name: 'Static', entity: 'contacts', kind: 'static' });
    session.user = member(s);
    const res = await listMembersRoute.POST(post('http://x', { contactIds: [s.memberContact.id, s.ownerContact.id] }), ctx(list.id));
    expect(((await res.json()) as { count: number }).count).toBe(1);
    await addListMembers(s.ws, list.id, [s.ownerContact.id]);
    const del = new NextRequest('http://x', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contactId: s.ownerContact.id }) });
    expect((await listMembersRoute.DELETE(del, ctx(list.id))).status).toBe(404);
    expect((await listLists(s.ws, null)).find((l) => l.id === list.id)?.memberCount).toBe(2);
  });
});

describe('reportes propios', () => {
  const config = (field: string) => ({ source: 'deals', columns: ['deal.name', field] });

  it('un campo oculto para la persona no se puede usar ni aparece en el constructor', async () => {
    const s = await setup('sweep-report');
    const run = async (u: SessionUser, field: string) => {
      session.user = u;
      return reportRunRoute.POST(post('http://x/api/crm/custom-reports/run', { config: config(field) }));
    };
    expect((await run(member(s), 'deal.custom:secret')).status).toBe(400);
    const filtered = await run(member(s), 'deal.custom:po');
    expect(filtered.status).toBe(200);
    expect((await run(admin(s), 'deal.custom:secret')).status).toBe(200);
    expect((await run(owner(s), 'deal.custom:secret')).status).toBe(200);
    expect((await run(teamMember(s), 'deal.custom:margin')).status).toBe(400);
    expect((await run(member(s), 'deal.custom:margin')).status).toBe(200);

    // Filtrar por un campo oculto tampoco: no se adivina su valor.
    await expect(
      runReport(s.ws, reportConfigSchema.parse({ source: 'deals', filters: [{ f: 'deal.custom:secret', o: 'eq', v: 's-deal' }], columns: ['deal.name'] }), {
        viewer: { workspaceId: s.ws, personId: s.w.member.id, role: 'member' },
      }),
    ).rejects.toBeInstanceOf(ReportError);

    const keys = async (personId: string, role: 'owner' | 'member') =>
      (await builderCustomFields({ workspaceId: s.ws, personId, role })).map((f) => f.key);
    expect(await keys(s.w.member.id, 'member')).not.toContain('deal.custom:secret');
    expect(await keys(s.w.member.id, 'member')).toContain('deal.custom:margin');
    expect(await keys(s.w.friend.id, 'member')).not.toContain('deal.custom:margin');
    expect(await keys(s.ws, 'owner')).toContain('deal.custom:secret');
  });
});

describe('board y mover de etapa', () => {
  it('el board no trae campos ocultos', async () => {
    const s = await setup('sweep-board');
    session.user = member(s);
    const res = (await (await dealsRoute.GET(get(`http://x/api/crm/deals?board=1&pipelineId=${s.p.id}`))).json()) as {
      rows: Array<{ deals: Array<{ id: string; custom: string }> }>;
    };
    const deals = res.rows.flatMap((c) => c.deals);
    expect(deals.map((d) => d.id)).toEqual([s.memberDeal.id]);
    expect(customOf(deals[0])).toEqual({ po: 'po-1', margin: 'm-1' });

    session.user = owner(s);
    const full = (await (await dealsRoute.GET(get(`http://x/api/crm/deals?board=1&pipelineId=${s.p.id}`))).json()) as typeof res;
    expect(full.rows.flatMap((c) => c.deals)).toHaveLength(3);

    // Otro workspace con el id del pipeline: ni las etapas.
    session.user = stranger(s);
    const other = (await (await dealsRoute.GET(get(`http://x/api/crm/deals?board=1&pipelineId=${s.p.id}`))).json()) as typeof res;
    expect(other.rows).toEqual([]);
  });

  it('la tarjeta no nombra el contacto ni la empresa que la persona no ve', async () => {
    const s = await setup('sweep-board-names');
    const r = await createDeal(s.ws, { name: 'Zeta mixed', pipelineId: s.p.id, stageId: s.stageA.id, ownerId: s.w.member.id, companyId: s.parent.id, contactIds: [s.ownerContact.id] });
    if (!r.ok) throw new Error('deal');
    session.user = member(s);
    const res = (await (await dealsRoute.GET(get(`http://x/api/crm/deals?board=1&pipelineId=${s.p.id}`))).json()) as {
      rows: Array<{ deals: Array<{ id: string; contact_name: string | null; company_name: string | null }> }>;
    };
    const card = res.rows.flatMap((c) => c.deals).find((d) => d.id === r.deal.id)!;
    expect(card.contact_name).toBeNull();
    expect(card.company_name).toBeNull();
    const own = res.rows.flatMap((c) => c.deals).find((d) => d.id === s.memberDeal.id)!;
    expect(own.company_name).toBe('Member Co');
  });

  it('mover respeta los permisos por campo y responde sin los ocultos', async () => {
    const s = await setup('sweep-move');
    session.user = member(s);
    const move = (body: unknown) => moveRoute.POST(post('http://x', body), ctx(s.memberDeal.id));

    // Solo lectura: no se cambia al mover.
    expect((await move({ stageId: s.stageB.id, fields: { custom: { po: 'po-2' } } })).status).toBe(403);
    // Oculto: lo que mande se ignora y el valor guardado sigue.
    const res = await move({ stageId: s.stageB.id, fields: { custom: { secret: 'overwrite' } } });
    expect(res.status).toBe(200);
    expect(customOf((await res.json()) as { custom: string })).toEqual({ po: 'po-1', margin: 'm-1' });

    session.user = owner(s);
    const full = (await (await dealRoute.GET(get('http://x'), ctx(s.memberDeal.id))).json()) as { deal: { custom: string; stage_id: string } };
    expect(full.deal.stage_id).toBe(s.stageB.id);
    expect(customOf(full.deal)).toEqual({ secret: 's-deal', po: 'po-1', margin: 'm-1' });

    session.user = stranger(s);
    expect((await moveRoute.POST(post('http://x', { stageId: s.stageA.id }), ctx(s.memberDeal.id))).status).toBe(404);
  });
});

describe('fusión de contactos', () => {
  it('la respuesta no trae los campos ocultos que juntó la fusión', async () => {
    const s = await setup('sweep-merge');
    const other = await createContact(s.ws, { firstName: 'Zeta', lastName: 'Dup', email: 'zeta-dup@example.test', ownerId: s.w.member.id, custom: { secret: 's-dup' } });
    session.user = member(s);
    const res = await contactMergeRoute.POST(post('http://x', { keepId: s.memberContact.id, dropId: other.id }));
    expect(res.status).toBe(200);
    expect(customOf((await res.json()) as { custom: string })).toEqual({});
  });
});

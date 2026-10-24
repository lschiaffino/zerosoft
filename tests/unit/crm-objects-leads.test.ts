import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { type UserRow } from '@/lib/db';
import {
  createActivity,
  createCompany,
  createContact,
  createCustomField,
  createDeal,
  createList,
  createPipeline,
  createStage,
  getList,
  listTimeline,

  updateStage,
} from '@/lib/crm';
import { addMember, createTeam, type TeamRole } from '@/lib/teams';
import { createSalesTeam } from '@/lib/crm-visibility';
import { createApiKey } from '@/lib/api-auth';
import {
  accessFor,
  fieldAccessFor,
  mergeCustomWrite,
  redactCustomJson,
  setFieldPermissions,
} from '@/lib/crm-field-perms';
import {
  cleanRecordCustom,
  createObject,
  createRecord,
  deleteObject,
  getObjectBySlug,
  linkRecord,
  listRecords,
  objectEntity,
  objectSlug,
  recordLinks,
  recordsLinkedTo,
} from '@/lib/crm-objects';
import { convertLead, createLead, ensureLeadStages, getLead, listLeads, listLeadsForBoard, updateLead } from '@/lib/crm-leads';
import { employeesFrom, jsonLdObjects, parseSiteProfile, socialProfile } from '@/lib/crm-site-profile';
import { enrichCompany, enrichmentPatch, fakeHomeHtml, mapPdlCompany, mergeEnrichment } from '@/lib/crm-enrich';
import { makeUser } from './helpers';
import { midSentence } from '@/lib/crm-object-text';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role: string }) => u.role === 'owner' || u.role === 'admin',
}));

const contactRoute = await import('@/app/api/crm/contacts/[id]/route');
const recordsRoute = await import('@/app/api/crm/objects/[id]/records/route');
const objectsRoute = await import('@/app/api/crm/objects/route');
const leadsRoute = await import('@/app/api/crm/leads/route');
const v1Contact = await import('@/app/api/v1/crm/contacts/[id]/route');
const v1Records = await import('@/app/api/v1/crm/objects/[slug]/records/route');
const searchRoute = await import('@/app/api/search/route');

beforeEach(() => {
  session.user = null;
  process.env.CRM_ENRICH_FAKE = '1';
});

function actAs(owner: UserRow, person: UserRow, role: TeamRole) {
  session.user =
    person.id === owner.id ? { ...owner, role: 'owner', team: null } : { ...owner, actingUser: person, role, team: null };
}

const send = (url: string, method: string, body: unknown, key?: string) =>
  new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  }) as never;
const get = (url: string, key?: string) =>
  new NextRequest(url, { headers: key ? { authorization: `Bearer ${key}` } : {} }) as never;
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function workspace() {
  const owner = await makeUser('own');
  const m1 = await makeUser('m1');
  const team = await createTeam(owner.id, 'Sales');
  await addMember(team.id, m1.id, 'member');
  return { owner, m1 };
}

// ---------------- Permisos por campo ----------------

describe('permisos por campo (puro)', () => {
  it('gana la regla más estricta entre las que tocan a la persona', () => {
    const rules = [
      { subject: 'role:member', access: 'read' as const },
      { subject: 'team:t1', access: 'hidden' as const },
    ];
    expect(accessFor(rules, new Set(['role:member']))).toBe('read');
    expect(accessFor(rules, new Set(['role:member', 'team:t1']))).toBe('hidden');
    expect(accessFor(rules, new Set(['team:t2']))).toBe('edit');
  });

  it('una escritura conserva lo oculto y rechaza cambiar lo de solo lectura', () => {
    const existing = { secret: 'x', locked: 5, free: 'a' };
    const restricted = new Map([
      ['secret', 'hidden' as const],
      ['locked', 'read' as const],
    ]);
    // El panel manda el custom sin el campo oculto: el valor guardado queda.
    expect(mergeCustomWrite(existing, { locked: 5, free: 'b' }, restricted)).toEqual({
      ok: true,
      custom: { locked: 5, free: 'b', secret: 'x' },
    });
    expect(mergeCustomWrite(existing, { locked: 6 }, restricted)).toEqual({ ok: false, field: 'locked' });
    // Pisar el oculto no se puede ni mandándolo.
    expect(mergeCustomWrite(existing, { secret: 'y' }, restricted)).toMatchObject({ ok: true, custom: { secret: 'x' } });
    expect(JSON.parse(redactCustomJson('{"secret":"x","free":"a"}', new Set(['secret'])))).toEqual({ free: 'a' });
  });
});

describe('permisos por campo (UI y API)', () => {
  it('un member no ve el oculto ni cambia el de solo lectura; el admin sí', async () => {
    const w = await workspace();
    const hidden = await createCustomField(w.owner.id, { entity: 'contacts', name: 'salary', label: 'Salary', type: 'number' });
    const locked = await createCustomField(w.owner.id, { entity: 'contacts', name: 'tier', label: 'Tier', type: 'text' });
    expect(await setFieldPermissions(w.owner.id, hidden.id, [{ subject: 'role:member', access: 'hidden' }])).toBe(true);
    expect(await setFieldPermissions(w.owner.id, locked.id, [{ subject: 'role:member', access: 'read' }])).toBe(true);
    const c = await createContact(w.owner.id, { firstName: 'Ana', email: 'ana@x.io', custom: { salary: 9000, tier: 'gold' } });

    const access = await fieldAccessFor({ workspaceId: w.owner.id, personId: w.m1.id, role: 'member' }, 'contacts');
    expect(access.visible.map((f) => [f.name, f.access])).toEqual([['tier', 'read']]);

    actAs(w.owner, w.m1, 'member');
    const res = await contactRoute.GET(get('http://x'), ctx({ id: c.id }));
    const body = (await res.json()) as { contact: { custom: string } };
    expect(JSON.parse(body.contact.custom)).toEqual({ tier: 'gold' });
    // Cambiar el de solo lectura: 403. Editar otro campo con el custom que ve: conserva el oculto.
    const bad = await contactRoute.PATCH(send('http://x', 'PATCH', { custom: { tier: 'silver' } }), ctx({ id: c.id }));
    expect(bad.status).toBe(403);
    const ok = await contactRoute.PATCH(send('http://x', 'PATCH', { custom: { tier: 'gold' }, jobTitle: 'CEO' }), ctx({ id: c.id }));
    expect(ok.status).toBe(200);

    actAs(w.owner, w.owner, 'owner');
    const own = (await (await contactRoute.GET(get('http://x'), ctx({ id: c.id }))).json()) as { contact: { custom: string; job_title: string } };
    expect(JSON.parse(own.contact.custom)).toEqual({ salary: 9000, tier: 'gold' });
    expect(own.contact.job_title).toBe('CEO');

    // API v1: la key de un member actúa como él.
    const key = (await createApiKey(w.owner.id, 'm1', w.m1.id)).key;
    const v1 = (await (await v1Contact.GET(get('http://x', key), ctx({ id: c.id }))).json()) as { custom: string };
    expect(JSON.parse(v1.custom)).toEqual({ tier: 'gold' });
    const v1bad = await v1Contact.PATCH(send('http://x', 'PATCH', { custom: { tier: 'x' } }, key), ctx({ id: c.id }));
    expect(v1bad.status).toBe(403);
  });

  it('las reglas por equipo de ventas aplican solo a sus miembros', async () => {
    const w = await workspace();
    const m2 = await makeUser('m2');
    const st = await createSalesTeam(w.owner.id, { name: 'East', members: [w.m1.id] });
    const f = await createCustomField(w.owner.id, { entity: 'deals', name: 'margin', label: 'Margin', type: 'number' });
    await setFieldPermissions(w.owner.id, f.id, [{ subject: `team:${st.id}`, access: 'hidden' }]);
    const m1 = await fieldAccessFor({ workspaceId: w.owner.id, personId: w.m1.id, role: 'member' }, 'deals');
    const other = await fieldAccessFor({ workspaceId: w.owner.id, personId: m2.id, role: 'member' }, 'deals');
    expect(m1.hidden.has('margin')).toBe(true);
    expect(other.hidden.has('margin')).toBe(false);
    // Un equipo de otro workspace no se acepta.
    expect(await setFieldPermissions(w.owner.id, f.id, [{ subject: 'team:nope', access: 'read' }])).toBe(false);
  });
});

// ---------------- Objetos propios ----------------

describe('objetos propios', () => {
  it('slug, registros con propiedades tipadas, filtros y asociaciones', async () => {
    const w = await workspace();
    expect(objectSlug('Vehículos 4x4')).toBe('vehiculos-4x4');
    const res = await createObject(w.owner.id, { singular: 'Vehicle', plural: 'Vehicles', primaryLabel: 'Plate' });
    if (!res.ok) throw new Error('object');
    const obj = res.object;
    expect((await getObjectBySlug(w.owner.id, 'vehicles'))?.id).toBe(obj.id);
    const year = await createCustomField(w.owner.id, { entity: objectEntity(obj.id), name: 'year', label: 'Year', type: 'number' });
    expect(cleanRecordCustom([year], { year: '2023', other: 'x' })).toEqual({ year: 2023 });

    const r1 = await createRecord(w.owner.id, obj.id, { name: 'AB 123', custom: { year: 2023 } });
    await createRecord(w.owner.id, obj.id, { name: 'CD 456', custom: { year: 2015 } });
    const recent = await listRecords(w.owner.id, obj.id, {
      filters: [{ f: 'custom:year', o: 'gt', v: '2020' }],
      customTypes: { year: 'number' },
    });
    expect(recent.rows.map((r) => r.name)).toEqual(['AB 123']);
    expect((await listRecords(w.owner.id, obj.id, { q: 'cd' })).total).toBe(1);

    const contact = await createContact(w.owner.id, { firstName: 'Ana', email: 'ana@v.io' });
    expect(await linkRecord(w.owner.id, r1.id, 'contact', contact.id)).toBe(true);
    expect((await recordLinks(w.owner.id, r1.id)).contacts.map((c) => c.id)).toEqual([contact.id]);
    expect((await recordsLinkedTo(w.owner.id, 'contact', contact.id)).map((r) => r.id)).toEqual([r1.id]);
    // Otro workspace no se asocia.
    const other = await makeUser('x');
    const foreign = await createContact(other.id, { firstName: 'X' });
    await expect(linkRecord(w.owner.id, r1.id, 'contact', foreign.id)).rejects.toThrow();

    // Notas en el timeline del registro.
    await createActivity(w.owner.id, { type: 'note', body: 'checked tires', objectRecordId: r1.id });
    expect((await listTimeline(w.owner.id, { objectRecordId: r1.id })).map((a) => a.body)).toEqual(['checked tires']);

    expect(await deleteObject(w.owner.id, obj.id)).toBe(true);
    expect(await getObjectBySlug(w.owner.id, 'vehicles')).toBeNull();
    expect((await listTimeline(w.owner.id, { objectRecordId: r1.id })).length).toBe(0);
  });

  it('rutas: solo admins definen objetos; los registros se crean, se buscan con Cmd+K y salen por la API', async () => {
    const w = await workspace();
    actAs(w.owner, w.m1, 'member');
    expect((await objectsRoute.POST(send('http://x', 'POST', { singular: 'Pet', plural: 'Pets' }))).status).toBe(403);
    actAs(w.owner, w.owner, 'owner');
    const created = await objectsRoute.POST(send('http://x', 'POST', { singular: 'Pet', plural: 'Pets' }));
    expect(created.status).toBe(201);
    const obj = (await created.json()) as { id: string; slug: string };
    actAs(w.owner, w.m1, 'member');
    const rec = await recordsRoute.POST(send('http://x', 'POST', { name: 'Firulais Zeta' }), ctx({ id: obj.id }));
    expect(rec.status).toBe(201);
    const search = (await (await searchRoute.GET(get('http://x/api/search?q=Firulais'))).json()) as {
      items: Array<{ group: string; href: string }>;
    };
    expect(search.items.find((i) => i.group === 'records')?.href).toMatch(new RegExp(`/app/crm/objects/${obj.slug}/`));
    const key = (await createApiKey(w.owner.id, 'k', w.owner.id)).key;
    const list = (await (await v1Records.GET(get('http://x', key), ctx({ slug: obj.slug }))).json()) as { records: Array<{ name: string }> };
    expect(list.records.map((r) => r.name)).toEqual(['Firulais Zeta']);
  });
});

// ---------------- Leads ----------------

describe('objeto Lead', () => {
  it('siembra el pipeline de leads, crea con el nombre del contacto, mueve y convierte en deal', async () => {
    const w = await workspace();
    const stages = await ensureLeadStages(w.owner.id, { new: 'Nuevo' });
    expect(stages.map((s) => s.kind)).toEqual(['open', 'open', 'open', 'qualified', 'disqualified']);
    expect(stages[0].name).toBe('Nuevo');
    // Dos veces no duplica.
    expect((await ensureLeadStages(w.owner.id)).length).toBe(5);

    const co = await createCompany(w.owner.id, { name: 'Norte Labs' });
    const c = await createContact(w.owner.id, { firstName: 'Ana', lastName: 'Gómez', email: 'ana@norte.io' });
    const lead = await createLead(w.owner.id, { contactId: c.id, companyId: co.id, ownerId: w.m1.id, source: 'form' });
    expect(lead.name).toBe('Ana Gómez');
    expect(lead.stage_id).toBe(stages[0].id);
    await expect(createLead(w.owner.id, {})).rejects.toThrow();

    await updateLead(w.owner.id, lead.id, { stageId: stages[2].id });
    const board = await listLeadsForBoard(w.owner.id);
    expect(board.find((s) => s.id === stages[2].id)?.leads.map((l) => l.id)).toEqual([lead.id]);
    expect((await listLeads(w.owner.id, { status: 'open', q: 'norte' })).total).toBe(1);

    await createActivity(w.owner.id, { type: 'call', subject: 'intro', leadId: lead.id });
    expect((await getLead(w.owner.id, lead.id))?.last_activity_at).toBeTruthy();

    const pipeline = await createPipeline(w.owner.id, 'Sales');
    const open = (await createStage(w.owner.id, pipeline.id, { name: 'Discovery' }))!;
    const won = (await createStage(w.owner.id, pipeline.id, { name: 'Won' }))!;
    await updateStage(w.owner.id, won.id, { isWon: true });
    const conv = await convertLead(w.owner.id, lead.id, { pipelineId: pipeline.id, amount: 500 });
    if (!conv.ok) throw new Error(conv.reason);
    const after = await getLead(w.owner.id, lead.id);
    expect(after?.deal_id).toBe(conv.dealId);
    expect(after?.stage_kind).toBe('qualified');
    const { getDeal } = await import('@/lib/crm');
    const deal = await getDeal(w.owner.id, conv.dealId);
    expect(deal?.deal.stage_id).toBe(open.id);
    expect(deal?.deal.owner_id).toBe(w.m1.id);
    expect(deal?.contacts.map((x) => x.id)).toEqual([c.id]);
    expect((await convertLead(w.owner.id, lead.id)).ok).toBe(false);
  });

  it('un lead descalificado no se convierte hasta reabrirlo', async () => {
    const w = await workspace();
    const stages = await ensureLeadStages(w.owner.id);
    const lead = await createLead(w.owner.id, { name: 'Sin presupuesto' });
    const pipeline = await createPipeline(w.owner.id, 'Sales');
    await createStage(w.owner.id, pipeline.id, { name: 'Discovery' });
    await updateLead(w.owner.id, lead.id, { stageId: stages.find((s) => s.kind === 'disqualified')!.id });
    expect(await convertLead(w.owner.id, lead.id, { pipelineId: pipeline.id })).toEqual({ ok: false, reason: 'lead_disqualified' });
    await updateLead(w.owner.id, lead.id, { stageId: stages[0].id });
    expect((await convertLead(w.owner.id, lead.id, { pipelineId: pipeline.id })).ok).toBe(true);
  });

  it('el nombre del objeto va en minúscula a mitad de frase, salvo siglas', () => {
    expect(midSentence('Vehicles')).toBe('vehicles');
    expect(midSentence('Vehículos', 'es')).toBe('vehículos');
    expect(midSentence('API keys')).toBe('API keys');
    expect(midSentence('SKUs')).toBe('SKUs');
    expect(midSentence('iPhones')).toBe('iPhones');
  });

  it('la ruta usa la visibilidad por owner y los permisos de los campos de leads', async () => {
    const w = await workspace();
    const f = await createCustomField(w.owner.id, { entity: 'leads', name: 'budget', label: 'Budget', type: 'number' });
    await setFieldPermissions(w.owner.id, f.id, [{ subject: 'role:member', access: 'read' }]);
    actAs(w.owner, w.m1, 'member');
    const denied = await leadsRoute.POST(send('http://x', 'POST', { name: 'Big one', custom: { budget: 10 } }));
    expect(denied.status).toBe(403);
    const ok = await leadsRoute.POST(send('http://x', 'POST', { name: 'Small one' }));
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as { owner_id: string }).owner_id).toBe(w.m1.id);
  });
});

// ---------------- Listas dinámicas ----------------

describe('listas dinámicas', () => {
  it('filtran por campos propios y actividad, con AND u OR', async () => {
    const w = await workspace();
    await createCustomField(w.owner.id, { entity: 'contacts', name: 'plan', label: 'Plan', type: 'select', options: ['pro', 'free'] });
    const pro = await createContact(w.owner.id, { firstName: 'Pro', email: 'p@l.io', custom: { plan: 'pro' } });
    await createContact(w.owner.id, { firstName: 'Free', email: 'f@l.io', custom: { plan: 'free' } });
    const dealy = await createContact(w.owner.id, { firstName: 'Dealy', email: 'd@l.io', custom: { plan: 'free' } });
    const pipeline = await createPipeline(w.owner.id, 'P');
    const st = (await createStage(w.owner.id, pipeline.id, { name: 'Open' }))!;
    await createDeal(w.owner.id, { name: 'D', pipelineId: pipeline.id, stageId: st.id, contactIds: [dealy.id] });
    await createActivity(w.owner.id, { type: 'call', subject: 'hi', contactId: pro.id });

    const names = async (filter: Parameters<typeof createList>[1]['filter']) => {
      const list = await createList(w.owner.id, { name: 'L', kind: 'dynamic', filter });
      return ((await getList(w.owner.id, list.id))?.members ?? []).map((m) => m.first_name).sort();
    };
    expect(await names({ filters: [{ f: 'custom:plan', o: 'is', v: 'pro' }] })).toEqual(['Pro']);
    expect(await names({ filters: [{ f: 'hasOpenDeal', o: 'is', v: '1' }] })).toEqual(['Dealy']);
    expect(await names({ filters: [{ f: 'daysSinceContacted', o: 'lt', v: '2' }] })).toEqual(['Pro']);
    expect(
      await names({
        match: 'any',
        filters: [
          { f: 'custom:plan', o: 'is', v: 'pro' },
          { f: 'hasOpenDeal', o: 'is', v: '1' },
        ],
      }),
    ).toEqual(['Dealy', 'Pro']);
    expect(
      await names({
        filters: [
          { f: 'custom:plan', o: 'is', v: 'free' },
          { f: 'hasOpenDeal', o: 'isnot', v: '1' },
        ],
      }),
    ).toEqual(['Free']);
  });

  it('un nombre de campo propio raro en el filtro rápido no llega al SQL', async () => {
    const w = await workspace();
    await createContact(w.owner.id, { firstName: 'Safe', email: 's@s.io' });
    const { listContacts } = await import('@/lib/crm');
    const res = await listContacts(w.owner.id, { custom: { "x') OR 1=1 --": 'y' } });
    expect(res.total).toBe(1);
  });
});

// ---------------- Datos de la empresa ----------------

describe('datos de la empresa desde el dominio', () => {
  it('lee JSON-LD Organization, redes y tamaño del sitio', () => {
    const html = `<html><head><title>Acme | Tools</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"x"},
      {"@type":"Organization","name":"Acme Inc","description":"We build tools.","telephone":"+1 555 0100",
       "numberOfEmployees":{"@type":"QuantitativeValue","minValue":51,"maxValue":200},"foundingDate":"2012",
       "address":{"addressLocality":"Rosario","addressCountry":"AR"},"sameAs":["https://www.linkedin.com/company/acme/"]}]}</script>
      </head><body><a href="https://twitter.com/intent/tweet">share</a><a href="https://x.com/acme">X</a>
      <a href="https://www.instagram.com/acme.hq/">ig</a></body></html>`;
    const p = parseSiteProfile(html, 'https://acme.com/');
    expect(p.name).toBe('Acme');
    expect(p.description).toBe('We build tools.');
    expect(p.employees).toBe(51);
    expect(p.foundedYear).toBe(2012);
    expect([p.city, p.country]).toEqual(['Rosario', 'AR']);
    expect(p.linkedin).toBe('https://www.linkedin.com/company/acme');
    expect(p.twitter).toBe('https://x.com/acme');
    expect(p.instagram).toBe('https://www.instagram.com/acme.hq');
    expect(socialProfile('https://facebook.com/sharer/sharer.php?u=x', 'facebook')).toBe('');
    expect(employeesFrom('1,200 employees')).toBe(1200);
    expect(jsonLdObjects('<script type="application/ld+json">{broken</script>')).toEqual([]);
  });

  it('el proveedor completa lo que el sitio no publica, sin pisar lo escrito', () => {
    const provider = mapPdlCompany({
      display_name: 'Acme',
      industry: 'computer software',
      employee_count: 140,
      founded: 2011,
      location: { locality: 'rosario', country: 'argentina' },
      linkedin_url: 'linkedin.com/company/acme',
    });
    expect(provider).toMatchObject({ industry: 'Computer software', employees: 140, linkedin: 'https://linkedin.com/company/acme' });
    const site = parseSiteProfile(fakeHomeHtml('acme.com'), 'https://acme.com/');
    const merged = mergeEnrichment('acme.com', site, provider);
    expect(merged.industry).toBe('Computer software');
    expect(merged.foundedYear).toBe(2015); // el sitio manda en lo que publica
    expect(merged.sources).toEqual(['site', 'provider']);
    const { patch, filled } = enrichmentPatch({ name: 'Mine', industry: 'Retail', description: '' }, merged);
    expect(patch.name).toBeUndefined();
    expect(patch.industry).toBeUndefined();
    expect(filled).toContain('description');
    expect(enrichmentPatch({ industry: 'Retail' }, merged, true).patch.industry).toBe('Computer software');
  });

  it('enrichCompany llena descripción, ubicación, tamaño y redes (proveedor falso)', async () => {
    const w = await workspace();
    const co = await createCompany(w.owner.id, { name: 'Typed name', domain: 'norte-labs.io' });
    const res = await enrichCompany(w.owner.id, co.id);
    if (!res.ok) throw new Error(res.reason);
    expect(res.company.name).toBe('Typed name');
    expect(res.company.description).toMatch(/Norte Labs builds tools/);
    expect(res.company.industry).toBe('Software');
    expect(res.company.employees).toBe(120);
    expect(res.company.city).toBe('Austin');
    expect(res.company.linkedin_url).toBe('https://www.linkedin.com/company/norte-labs');
    expect(res.company.facebook_url).toBe('https://www.facebook.com/norte-labs');
    expect(res.company.enriched_at).toBeTruthy();
    const none = await createCompany(w.owner.id, { name: 'No site' });
    expect(await enrichCompany(w.owner.id, none.id)).toEqual({ ok: false, reason: 'no_domain' });
  });
});

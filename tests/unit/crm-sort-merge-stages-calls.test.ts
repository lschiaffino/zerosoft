import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createActivity,
  createCompany,
  createContact,
  createCustomField,
  createDeal,
  createPipeline,
  createStage,
  getDeal,
  listCompanies,
  listContacts,
  listDeals,
  moveDeal,
  updateStage,
} from '@/lib/crm';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { associateContactCompany, associateDealCompany } from '@/lib/crm-assoc';
import { applyTag, createTag, tagsForRecords } from '@/lib/crm-tags';
import { listTrash, restoreTrash } from '@/lib/crm-trash';
import { bulkSetProperty } from '@/lib/crm-bulk';
import { customSortValue, extraSortOrder, isExtraSort, parseCustomSort } from '@/lib/crm-list-sort';
import {
  companyMergeFillPatch,
  findDuplicateCompanies,
  groupCompanyDuplicates,
  mergeCompanies,
  normalizeCompanyName,
} from '@/lib/crm-company-merge';
import { missingRequiredFields, normalizeRequiredFields, parseRequiredFields } from '@/lib/crm-stage-rules';
import { describeMissing, moveDealWithFields } from '@/lib/crm-stage-move';
import { getCrmSettings, updateCrmSettings } from '@/lib/crm-currency';
import { DEFAULT_CALL_OUTCOMES, normalizeCallOutcomes, parseCallOutcomes, telHref, whatsappHref } from '@/lib/crm-calls';
import {
  companyInitials,
  companyLogoUrl,
  nameFromDomain,
  normalizeCompanyDomain,
  parseSiteMeta,
  siteNameFromTitle,
  sniffImageType,
} from '@/lib/crm-domain';
import { getCompanyLogo } from '@/lib/crm-logos';
import { extraSortOptions } from '@/components/crm/customFieldViews';
import type { CrmCompanyRow } from '@/lib/db';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role: string }) => u.role === 'owner' || u.role === 'admin',
}));
const moveRoute = await import('@/app/api/crm/deals/[id]/move/route');
const mergeRoute = await import('@/app/api/crm/companies/merge/route');

beforeEach(() => {
  session.user = null;
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (url: string, body: unknown) =>
  new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never;

async function pipeline(userId: string) {
  const p = await createPipeline(userId, 'Sales');
  const open = await createStage(userId, p.id, { name: 'New' });
  const proposal = await createStage(userId, p.id, { name: 'Proposal' });
  return { pipelineId: p.id, openId: open!.id, proposalId: proposal!.id };
}

describe('CRM: orden por owner y custom fields', () => {
  it('valida el valor de ?sort= y arma el ORDER BY solo con campos conocidos', () => {
    expect(parseCustomSort('cf:budget')).toEqual({ name: 'budget', desc: false });
    expect(parseCustomSort('cf:budget:desc')).toEqual({ name: 'budget', desc: true });
    expect(parseCustomSort("cf:x');DROP")).toBeNull();
    expect(isExtraSort('owner')).toBe(true);
    expect(isExtraSort('cf:budget', {})).toBe(false);
    expect(isExtraSort('cf:budget', { budget: 'number' })).toBe(true);
    expect(extraSortOrder('c', 'cf:budget:desc', { budget: 'number' })).toContain('CAST(');
    expect(extraSortOrder('c', 'cf:nope', { budget: 'number' })).toBeNull();
    expect(extraSortOrder('d', 'newest')).toBeNull();
    expect(customSortValue('tier', true)).toBe('cf:tier:desc');
    const opts = extraSortOptions(
      [{ name: 'tier', label: 'Tier' } as never],
      { ownerAsc: 'Owner A-Z', ownerDesc: 'Owner Z-A', asc: (l) => `${l} up`, desc: (l) => `${l} down` },
    );
    expect(opts.map((o) => o.value)).toEqual(['owner', 'owner_desc', 'cf:tier', 'cf:tier:desc']);
  });

  it('contactos, empresas y deals ordenan por owner (sin owner al final) y por custom field', async () => {
    const owner = await makeUser('zoe');
    const ann = await makeUser('ann');
    const team = await createTeam(owner.id, 'Ventas');
    await addMember(team.id, ann.id, 'member');
    await createCustomField(owner.id, { entity: 'contacts', name: 'budget', label: 'Budget', type: 'number' });
    await createCustomField(owner.id, { entity: 'companies', name: 'tier', label: 'Tier', type: 'text' });
    await createCustomField(owner.id, { entity: 'deals', name: 'tier', label: 'Tier', type: 'text' });
    const a = await createContact(owner.id, { firstName: 'A', email: 'a@x.io', ownerId: owner.id, custom: { budget: 900 } });
    const b = await createContact(owner.id, { firstName: 'B', email: 'b@x.io', ownerId: ann.id, custom: { budget: 50 } });
    const c = await createContact(owner.id, { firstName: 'C', email: 'c@x.io', ownerId: null, custom: { budget: 300 } });
    // createContact pone al workspace como owner por defecto: este queda sin owner a mano.
    await getDb().prepare('UPDATE crm_contacts SET owner_id = NULL WHERE id = ?').run(c.id);
    const types = { budget: 'number' as const };
    const ids = async (sort: string) =>
      (await listContacts(owner.id, { sort: sort as never, customTypes: types })).rows.map((r) => r.id);
    expect(await ids('owner')).toEqual([b.id, a.id, c.id]);
    expect(await ids('owner_desc')).toEqual([a.id, b.id, c.id]);
    // Número como número (900 > 300 > 50), no como texto.
    expect(await ids('cf:budget:desc')).toEqual([a.id, c.id, b.id]);
    expect(await ids('cf:budget')).toEqual([b.id, c.id, a.id]);

    await createCompany(owner.id, { name: 'Gamma', custom: { tier: 'b' } });
    await createCompany(owner.id, { name: 'Alpha', custom: { tier: 'A' } });
    await createCompany(owner.id, { name: 'Beta' });
    const cos = await listCompanies(owner.id, { sort: 'cf:tier', customTypes: { tier: 'text' } });
    expect(cos.rows.map((r) => r.name)).toEqual(['Alpha', 'Gamma', 'Beta']);

    const { pipelineId, openId } = await pipeline(owner.id);
    await createDeal(owner.id, { name: 'D1', pipelineId, stageId: openId, ownerId: ann.id, custom: { tier: 'z' } });
    await createDeal(owner.id, { name: 'D2', pipelineId, stageId: openId, ownerId: owner.id, custom: { tier: 'a' } });
    const ds = await listDeals(owner.id, { pipelineId, sort: 'cf:tier:desc', customTypes: { tier: 'text' } });
    expect(ds.rows.map((r) => r.name)).toEqual(['D1', 'D2']);
    const byOwner = await listDeals(owner.id, { pipelineId, sort: 'owner' });
    expect(byOwner.rows.map((r) => r.name)).toEqual(['D1', 'D2']);
  });
});

describe('CRM: empresas duplicadas y merge', () => {
  it('normaliza dominios y nombres, y une grupos solapados', () => {
    expect(normalizeCompanyDomain('https://www.Acme.com/about?x=1')).toBe('acme.com');
    expect(normalizeCompanyDomain('mailto:ana@acme.io')).toBe('acme.io');
    expect(normalizeCompanyDomain('localhost')).toBe('');
    expect(normalizeCompanyName('Acme, Inc.')).toBe('acme');
    expect(normalizeCompanyName('Café Martínez S.A.')).toBe('cafe martinez');
    expect(normalizeCompanyName('Grupo Bimbo S.A. de C.V.')).toBe('grupo bimbo');
    const groups = groupCompanyDuplicates([
      { id: '1', name: 'Acme', domain: 'acme.com', created_at: '2024-01-01' },
      { id: '2', name: 'Acme Corp', domain: 'https://acme.com', created_at: '2024-02-01' },
      { id: '3', name: 'ACME corp.', domain: '', created_at: '2024-03-01' },
      { id: '4', name: 'Other', domain: 'other.io', created_at: '2024-01-01' },
      { id: '5', name: 'X', domain: '', created_at: '2024-01-01' },
      { id: '6', name: 'x', domain: '', created_at: '2024-01-02' },
    ]);
    // 1 y 2 por dominio, 2 y 3 por nombre: un grupo. "X" es muy corto para contar.
    expect(groups).toHaveLength(1);
    expect(groups[0].companies.map((c) => c.id)).toEqual(['1', '2', '3']);
    expect(groups[0].reasons).toEqual(['domain', 'name']);
  });

  it('completa lo vacío de la que queda sin pisar lo que tiene', () => {
    const base = { id: 'k', owner_id: null, employees: null, parent_company_id: null, custom: '{"a":1}' } as unknown as CrmCompanyRow;
    const fill = companyMergeFillPatch(
      { ...base, domain: 'keep.com', industry: '', phone: '', website: '', city: 'Rosario', country: '' },
      {
        ...base,
        id: 'd',
        domain: 'drop.com',
        industry: 'SaaS',
        phone: '+54 11',
        website: '',
        city: 'Córdoba',
        country: 'AR',
        employees: 40,
        owner_id: 'u1',
        parent_company_id: 'k',
        custom: '{"a":2,"b":3}',
      },
    );
    expect(Object.fromEntries(fill)).toEqual({
      industry: 'SaaS',
      phone: '+54 11',
      country: 'AR',
      employees: 40,
      owner_id: 'u1',
      custom: JSON.stringify({ a: 1, b: 3 }),
    });
  });

  it('mueve contactos, deals, actividades y tags; la descartada va a la papelera y se puede restaurar', async () => {
    const u = await makeUser('merge');
    const keep = await createCompany(u.id, { name: 'Acme', domain: 'acme.com' });
    const drop = await createCompany(u.id, { name: 'Acme Inc', domain: 'www.acme.com', industry: 'SaaS' });
    const child = await createCompany(u.id, { name: 'Acme Labs', parentCompanyId: drop.id });
    const both = await createContact(u.id, { firstName: 'Both', email: 'both@acme.com' });
    const only = await createContact(u.id, { firstName: 'Only', email: 'only@acme.com' });
    await associateContactCompany(u.id, both.id, keep.id, { primary: false });
    await associateContactCompany(u.id, both.id, drop.id, { primary: true });
    await associateContactCompany(u.id, only.id, drop.id, { primary: true });
    const { pipelineId, openId } = await pipeline(u.id);
    const deal = await createDeal(u.id, { name: 'Big', pipelineId, stageId: openId });
    if (!deal.ok) throw new Error('deal');
    await associateDealCompany(u.id, deal.deal.id, drop.id, { primary: true });
    const note = await createActivity(u.id, { type: 'note', subject: 'Kickoff', companyId: drop.id });
    const tag = await createTag(u.id, { name: 'Key' });
    if (!tag.ok) throw new Error('tag');
    await applyTag(u.id, tag.tag.id, 'company', [drop.id], 'add');

    expect((await findDuplicateCompanies(u.id, { companyId: keep.id }))[0].companies.map((c) => c.id).sort()).toEqual([keep.id, drop.id].sort());

    session.user = { ...u, role: 'owner', team: null };
    const res = await mergeRoute.POST(post('http://x/api/crm/companies/merge', { keepId: keep.id, dropId: drop.id }));
    expect(res.status).toBe(200);
    const merged = (await res.json()) as CrmCompanyRow;
    expect(merged.industry).toBe('SaaS');

    const db = getDb();
    expect(await db.prepare('SELECT 1 FROM crm_companies WHERE id = ?').get(drop.id)).toBeUndefined();
    const links = (await db
      .prepare('SELECT contact_id, is_primary FROM crm_contact_companies WHERE company_id = ? ORDER BY contact_id')
      .all(keep.id)) as Array<{ contact_id: string; is_primary: number }>;
    expect(links.map((l) => [l.contact_id, l.is_primary]).sort()).toEqual([[both.id, 1], [only.id, 1]].sort());
    expect(((await db.prepare('SELECT company_id FROM crm_contacts WHERE id = ?').get(only.id)) as { company_id: string }).company_id).toBe(keep.id);
    expect((await getDeal(u.id, deal.deal.id))?.companies?.map((c) => c.id)).toEqual([keep.id]);
    expect(((await db.prepare('SELECT company_id FROM crm_activities WHERE id = ?').get(note.id)) as { company_id: string }).company_id).toBe(keep.id);
    expect(((await db.prepare('SELECT parent_company_id FROM crm_companies WHERE id = ?').get(child.id)) as { parent_company_id: string }).parent_company_id).toBe(keep.id);
    expect((await tagsForRecords(u.id, 'company', [keep.id])).get(keep.id)?.map((x) => x.name)).toEqual(['Key']);

    const bin = await listTrash(u.id);
    expect(bin).toHaveLength(1);
    expect(bin[0]).toMatchObject({ entity: 'company', record_id: drop.id, merged_into: keep.id, merged_into_name: 'Acme' });
    // Restaurar devuelve la empresa con sus datos y sus asociaciones de antes del merge.
    expect(await restoreTrash(u.id, bin[0].id)).toEqual({ ok: true, entity: 'company', recordId: drop.id });
    const back = (await db.prepare('SELECT * FROM crm_companies WHERE id = ?').get(drop.id)) as CrmCompanyRow;
    expect(back.industry).toBe('SaaS');
    expect(await db.prepare('SELECT 1 FROM crm_contact_companies WHERE company_id = ? AND contact_id = ?').get(drop.id, only.id)).toBeTruthy();
  });

  it('no fusiona una empresa consigo misma ni una ajena', async () => {
    const u = await makeUser('merge2');
    const other = await makeUser('merge3');
    const a = await createCompany(u.id, { name: 'A' });
    const b = await createCompany(other.id, { name: 'B' });
    expect(await mergeCompanies(u.id, a.id, a.id)).toEqual({ ok: false, reason: 'same' });
    expect(await mergeCompanies(u.id, a.id, b.id)).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('CRM: propiedades obligatorias por etapa', () => {
  it('lista válida y qué falta en un deal', () => {
    expect(normalizeRequiredFields(['amount', 'amount', 'nope', 'custom:budget', "custom:x'"])).toEqual(['amount', 'custom:budget']);
    expect(parseRequiredFields('not json')).toEqual([]);
    const deal = { amount: 0, close_date: null, owner_id: 'u', priority: 'medium', source: '', description: '', custom: { ok: false, list: [] } };
    expect(
      missingRequiredFields(['amount', 'closeDate', 'ownerId', 'source', 'company', 'custom:ok', 'custom:list'], deal, { companies: 0, contacts: 1 }),
    ).toEqual(['amount', 'closeDate', 'source', 'company', 'custom:list']);
  });

  it('moveDeal, la API, la edición en masa y Flow respetan la regla; import y presupuestos no', async () => {
    const u = await makeUser('rules');
    await createCustomField(u.id, { entity: 'deals', name: 'budget', label: 'Budget', type: 'number' });
    const { pipelineId, openId, proposalId } = await pipeline(u.id);
    await updateStage(u.id, proposalId, { requiredFields: ['amount', 'custom:budget', 'custom:gone', 'bogus'] });
    const stage = (await getDb().prepare('SELECT required_fields FROM crm_stages WHERE id = ?').get(proposalId)) as { required_fields: string };
    expect(JSON.parse(stage.required_fields)).toEqual(['amount', 'custom:budget', 'custom:gone']);

    const d = await createDeal(u.id, { name: 'Needs data', pipelineId, stageId: openId });
    if (!d.ok) throw new Error('deal');
    // custom:gone no existe como campo: no se exige.
    expect(await moveDeal(u.id, d.deal.id, proposalId)).toEqual({ ok: false, reason: 'missing_required', missing: ['amount', 'custom:budget'] });
    expect(await bulkSetProperty(u.id, 'deal', [d.deal.id], 'stageId', proposalId)).toEqual({ ok: true, count: 0, failed: 1, blocked: 1 });
    expect((await describeMissing(u.id, ['amount', 'custom:budget']))[1]).toMatchObject({ key: 'custom:budget', type: 'number', label: 'Budget' });

    // UI: 422 con lo que falta; después se completa en el mismo paso.
    session.user = { ...u, role: 'owner', team: null };
    const res = await moveRoute.POST(post(`http://x/api/crm/deals/${d.deal.id}/move`, { stageId: proposalId }), ctx(d.deal.id));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'missing_required', stage: 'Proposal', missing: [{ key: 'amount' }, { key: 'custom:budget' }] });
    const ok = await moveRoute.POST(
      post(`http://x/api/crm/deals/${d.deal.id}/move`, { stageId: proposalId, fields: { amount: 1200, custom: { budget: '500' } } }),
      ctx(d.deal.id),
    );
    expect(ok.status).toBe(200);
    const after = await getDeal(u.id, d.deal.id);
    expect(after?.deal.stage_id).toBe(proposalId);
    expect(after?.deal.amount).toBe(1200);
    expect(JSON.parse(after!.deal.custom)).toEqual({ budget: 500 });

    // Import y presupuestos aceptados no lo exigen.
    const d2 = await createDeal(u.id, { name: 'Imported', pipelineId, stageId: openId });
    if (!d2.ok) throw new Error('deal');
    expect((await moveDeal(u.id, d2.deal.id, proposalId, null, undefined, '', { enforceRequired: false })).ok).toBe(true);
    // Quedarse en la misma etapa no se bloquea.
    expect((await moveDealWithFields(u.id, d2.deal.id, { stageId: proposalId }, '')).ok).toBe(true);
  });
});

describe('CRM: llamadas y WhatsApp', () => {
  it('links de teléfono y WhatsApp', () => {
    expect(telHref('+54 9 11 5555-1234')).toBe('tel:+5491155551234');
    expect(telHref('12')).toBeNull();
    expect(whatsappHref('+54 9 11 5555-1234')).toBe('https://wa.me/5491155551234');
    expect(whatsappHref('0054 11 5555 1234')).toBe('https://wa.me/541155551234');
    expect(whatsappHref('123')).toBeNull();
    expect(whatsappHref('+1 415 555 0100', 'Hola')).toBe('https://wa.me/14155550100?text=Hola');
  });

  it('resultados configurables por workspace (vacío = los de siempre)', async () => {
    expect(parseCallOutcomes(null)).toEqual([...DEFAULT_CALL_OUTCOMES]);
    expect(normalizeCallOutcomes([' Demo agendada ', 'demo agendada', '', 3, 'Sin interés'])).toEqual(['Demo agendada', 'Sin interés']);
    const u = await makeUser('calls');
    expect((await getCrmSettings(u.id)).callOutcomes).toEqual([...DEFAULT_CALL_OUTCOMES]);
    await updateCrmSettings(u.id, { callOutcomes: ['Demo agendada', 'Sin interés'] });
    expect(await getCrmSettings(u.id)).toMatchObject({ callOutcomes: ['Demo agendada', 'Sin interés'], callOutcomesCustom: true });
    // Cambiar otra cosa no los pisa; null vuelve a los de siempre.
    await updateCrmSettings(u.id, { quoteAcceptMovesDeal: true });
    expect((await getCrmSettings(u.id)).callOutcomes).toEqual(['Demo agendada', 'Sin interés']);
    await updateCrmSettings(u.id, { callOutcomes: null });
    expect(await getCrmSettings(u.id)).toMatchObject({ callOutcomes: [...DEFAULT_CALL_OUTCOMES], callOutcomesCustom: false });
  });

  it('el toque por WhatsApp queda como llamada con canal y cuenta como último contacto', async () => {
    const u = await makeUser('wa');
    const c = await createContact(u.id, { firstName: 'Wa', email: 'wa@x.io', phone: '+5491155551234' });
    const a = await createActivity(u.id, { type: 'call', channel: 'whatsapp', outcome: 'connected', direction: 'outbound', contactId: c.id });
    expect(a).toMatchObject({ type: 'call', channel: 'whatsapp', outcome: 'connected' });
    const note = await createActivity(u.id, { type: 'note', channel: 'whatsapp', contactId: c.id });
    expect(note.channel).toBe('');
    const row = (await getDb().prepare('SELECT last_contacted_at FROM crm_contacts WHERE id = ?').get(c.id)) as { last_contacted_at: string | null };
    expect(row.last_contacted_at).toBeTruthy();
  });
});

describe('CRM: logos y datos desde el dominio', () => {
  it('lee nombre, teléfono e íconos de la home', () => {
    const html = `<html><head><title>Acme | Software for teams</title>
      <meta property="og:site_name" content="Acme &amp; Co">
      <meta name="description" content="We build things.">
      <link rel="icon" href="/favicon-32.png" sizes="32x32">
      <link rel="apple-touch-icon" href="https://cdn.acme.com/apple.png" sizes="180x180">
      </head><body><a href="tel:+1 (415) 555-0100">Call</a></body></html>`;
    const meta = parseSiteMeta(html, 'https://acme.com/');
    expect(meta).toEqual({
      name: 'Acme & Co',
      description: 'We build things.',
      phone: '+1 (415) 555-0100',
      icons: ['https://cdn.acme.com/apple.png', 'https://acme.com/favicon-32.png', 'https://acme.com/favicon.ico'],
    });
    expect(siteNameFromTitle('Home - Globex Corporation')).toBe('Home');
    expect(nameFromDomain('acme-labs.com.ar')).toBe('Acme Labs');
    expect(companyInitials('acme corp')).toBe('AC');
    expect(companyLogoUrl('https://www.acme.com')).toBe('/api/crm/logo/acme.com');
    expect(companyLogoUrl('nope')).toBeNull();
  });

  it('reconoce imágenes por sus bytes (no por el content-type)', () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBe('image/png');
    expect(sniffImageType(new Uint8Array([0, 0, 1, 0, 1, 0]))).toBe('image/x-icon');
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('image/svg+xml');
    expect(sniffImageType(new TextEncoder().encode('<html>not an image</html>'))).toBeNull();
  });

  it('cachea el logo (y la falta de logo) por dominio', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    let calls = 0;
    const discover = async () => {
      calls++;
      return { contentType: 'image/png', data: png };
    };
    const now = new Date('2026-01-01T00:00:00Z');
    const first = await getCompanyLogo('https://www.logo-test.io/x', { now, discover });
    expect(first).toMatchObject({ status: 'ok', contentType: 'image/png' });
    const again = await getCompanyLogo('logo-test.io', { now, discover });
    expect(Array.from(again!.data!)).toEqual(Array.from(png));
    expect(calls).toBe(1);
    // Vencido (más de 30 días): vuelve a buscar.
    await getCompanyLogo('logo-test.io', { now: new Date('2026-03-01T00:00:00Z'), discover });
    expect(calls).toBe(2);
    const none = await getCompanyLogo('no-logo-test.io', { now, discover: async () => null });
    expect(none).toEqual({ status: 'missing', contentType: '', data: null });
    expect(await getCompanyLogo('not a domain', { now, discover })).toBeNull();
  });
});

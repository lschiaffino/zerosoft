/**
 * C2: opciones editables de Lifecycle stage y Lead status y lifecycle que
 * avanza solo con los deals. Acceso a /api/crm/property-options (anónimo,
 * otro workspace, member, member con un campo oculto, admin, owner), las
 * reglas de escritura (archivadas legibles, renombres que se ven en todos lados),
 * el sync con HubSpot (una opción propia nunca rompe el envío) y el avance
 * automático (solo hacia adelante, apagable, en el timeline del registro y solo
 * para quien lo ve). Datos inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createCompany,
  createContact,
  createCustomField,
  createDeal,
  createPipeline,
  createStage,
  getContact,
  moveDeal,
  updateContact,
  updateStage,
} from '@/lib/crm';
import { CrmRefError } from '@/lib/crm-refs';
import { MEMBER_SUBJECT, setFieldPermissions } from '@/lib/crm-field-perms';
import { setMemberVisibility } from '@/lib/crm-visibility';
import { updateCrmSettings } from '@/lib/crm-currency';
import { addOption, listOptionSets, updateOption } from '@/lib/crm-property-options';
import {
  defaultOptions,
  defaultOptionSets,
  isAllowedOption,
  matchOption,
  optionHelpers,
  type OptionSets,
} from '@/lib/crm-property-options-shared';
import { shouldAdvance } from '@/lib/crm-lifecycle-auto';
import { listSystemChanges } from '@/lib/crm-timeline';
import { toHubspot } from '@/lib/crm-hubspot-sync/outbound-map';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const route = await import('@/app/api/crm/property-options/route');
const timelineRoute = await import('@/app/api/crm/timeline/route');

beforeEach(() => {
  session.user = null;
});

const post = (body: unknown) =>
  new NextRequest('http://x/api/crm/property-options', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

const label = (sets: OptionSets) =>
  optionHelpers(
    sets,
    (prop, v) => `${prop}:${v}`,
    (l) => `${l} (archived)`,
  );

describe('opciones: lógica pura', () => {
  it('choices ofrece las activas y conserva la archivada del registro; all marca las archivadas', () => {
    const sets = defaultOptionSets();
    sets.lifecycle = sets.lifecycle.map((o) => (o.value === 'mql' ? { ...o, archived: true } : o.value === 'sql' ? { ...o, label: 'Qualified' } : o));
    const h = label(sets);
    expect(h.choices('lifecycle').map((o) => o.value)).not.toContain('mql');
    expect(h.choices('lifecycle', 'mql').at(-1)).toEqual({ value: 'mql', label: 'lifecycle:mql (archived)', archived: true });
    expect(h.label('lifecycle', 'sql')).toBe('Qualified');
    expect(h.label('lifecycle', 'mql')).toBe('lifecycle:mql');
    expect(h.all('lifecycle').at(-1)?.value).toBe('mql');
    // Un valor que ya no es opción se muestra tal cual.
    expect(h.label('lifecycle', 'opt_gone')).toBe('opt_gone');
  });

  it('isAllowedOption: activa sí, archivada solo si ya la tenía; matchOption por clave o nombre', () => {
    const opts = defaultOptions('leadStatus').map((o) => (o.value === 'open' ? { ...o, archived: true } : o));
    expect(isAllowedOption(opts, 'new')).toBe(true);
    expect(isAllowedOption(opts, 'open')).toBe(false);
    expect(isAllowedOption(opts, 'open', 'open')).toBe(true);
    expect(isAllowedOption(opts, 'opt_x')).toBe(false);
    const withCustom = [...opts, { value: 'opt_abc', label: 'Nurturing', archived: false, builtin: false }];
    expect(matchOption(withCustom, ' nurturing ')).toBe('opt_abc');
    expect(matchOption(withCustom, 'NEW')).toBe('new');
    expect(matchOption(withCustom, 'nope')).toBeNull();
  });

  it('shouldAdvance: solo hacia adelante y nunca a una archivada', () => {
    const lc = defaultOptions('lifecycle');
    expect(shouldAdvance(lc, 'lead', 'opportunity')).toBe(true);
    expect(shouldAdvance(lc, 'opportunity', 'opportunity')).toBe(false);
    expect(shouldAdvance(lc, 'customer', 'opportunity')).toBe(false);
    expect(shouldAdvance(lc, 'evangelist', 'customer')).toBe(false);
    expect(shouldAdvance(lc, 'opt_unknown', 'customer')).toBe(true);
    expect(shouldAdvance(lc.map((o) => (o.value === 'customer' ? { ...o, archived: true } : o)), 'lead', 'customer')).toBe(false);
    // El orden es el del workspace: con Opportunity movida al final, una propia después de ella no retrocede.
    const reordered = [...lc.filter((o) => o.value !== 'opportunity'), lc.find((o) => o.value === 'opportunity')!];
    expect(shouldAdvance(reordered, 'evangelist', 'opportunity')).toBe(true);
    expect(shouldAdvance(reordered, 'opportunity', 'customer')).toBe(false);
  });
});

describe('opciones: acceso a /api/crm/property-options', () => {
  it('anónimo: 401', async () => {
    expect((await route.GET()).status).toBe(401);
    expect((await route.POST(post({ action: 'add', property: 'lifecycle', label: 'Partner' }))).status).toBe(401);
  });

  it('member: lee las del workspace pero no las edita (también con un campo oculto)', async () => {
    const w = await workspaceWithMember('c2-member');
    const ws = w.owner.id;
    const hidden = await createCustomField(ws, { entity: 'contacts', name: 'secret', label: 'Secret', type: 'text' });
    await setFieldPermissions(ws, hidden.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
    await addOption(ws, 'lifecycle', 'Partner');
    session.user = asMember(w.owner, w.member);
    const sets = (await (await route.GET()).json()) as OptionSets;
    expect(sets.lifecycle.some((o) => o.label === 'Partner')).toBe(true);
    for (const body of [
      { action: 'add', property: 'lifecycle', label: 'X' },
      { action: 'update', property: 'lifecycle', value: 'lead', label: 'Y' },
      { action: 'reorder', property: 'leadStatus', values: ['new'] },
    ]) {
      expect((await route.POST(post(body))).status).toBe(403);
    }
    expect((await listOptionSets(ws)).lifecycle.find((o) => o.value === 'lead')?.label).toBeNull();
  });

  it('otro workspace: no ve ni toca las opciones de este', async () => {
    const w = await workspaceWithMember('c2-other');
    await addOption(w.owner.id, 'lifecycle', 'Secret stage');
    session.user = asOwner(w.stranger);
    const sets = (await (await route.GET()).json()) as OptionSets;
    expect(sets.lifecycle.some((o) => o.label === 'Secret stage')).toBe(false);
    const theirs = (await listOptionSets(w.owner.id)).lifecycle.find((o) => o.label === 'Secret stage')!;
    // Una clave de este workspace no existe en el otro.
    expect((await route.POST(post({ action: 'update', property: 'lifecycle', value: theirs.value, archived: true }))).status).toBe(404);
    expect((await listOptionSets(w.owner.id)).lifecycle.find((o) => o.value === theirs.value)?.archived).toBe(false);
  });

  it('owner y admin: agregar, renombrar, ordenar, archivar y restaurar; nunca la última activa', async () => {
    const w = await workspaceWithMember('c2-owner');
    const ws = w.owner.id;
    session.user = asOwner(w.owner);
    const added = (await (await route.POST(post({ action: 'add', property: 'leadStatus', label: 'Nurturing' }))).json()) as { options: Array<{ value: string; label: string | null }> };
    const custom = added.options.find((o) => o.label === 'Nurturing')!;
    expect(custom.value).toMatch(/^opt_[a-z0-9]+$/);
    expect((await route.POST(post({ action: 'add', property: 'leadStatus', label: 'nurturing' }))).status).toBe(400);
    session.user = asMember(w.owner, w.friend, 'admin');
    expect((await route.POST(post({ action: 'update', property: 'leadStatus', value: 'new', label: 'Fresh' }))).status).toBe(200);
    const order = (await listOptionSets(ws)).leadStatus.map((o) => o.value).reverse();
    const reordered = (await (await route.POST(post({ action: 'reorder', property: 'leadStatus', values: order }))).json()) as { options: Array<{ value: string }> };
    expect(reordered.options.map((o) => o.value)).toEqual(order);
    expect((await route.POST(post({ action: 'reorder', property: 'leadStatus', values: order.slice(1) }))).status).toBe(400);
    expect((await route.POST(post({ action: 'update', property: 'leadStatus', value: custom.value, archived: true }))).status).toBe(200);
    expect((await route.POST(post({ action: 'update', property: 'leadStatus', value: custom.value, archived: false }))).status).toBe(200);
    // Archivar todas menos una: la última no se puede.
    const values = (await listOptionSets(ws)).lifecycle.map((o) => o.value);
    for (const v of values.slice(1)) await updateOption(ws, 'lifecycle', v, { archived: true });
    const last = await route.POST(post({ action: 'update', property: 'lifecycle', value: values[0], archived: true }));
    expect(last.status).toBe(400);
    expect(((await last.json()) as { error: string }).error).toBe('option_last_active');
  });
});

describe('opciones: registros', () => {
  it('una archivada sigue en el registro que la tiene, no se puede elegir de nuevo y el renombre se ve sin reescribir', async () => {
    const w = await workspaceWithMember('c2-records');
    const ws = w.owner.id;
    const partner = await addOption(ws, 'lifecycle', 'Partner');
    const a = await createContact(ws, { firstName: 'Ana', lifecycleStage: partner.value });
    const b = await createContact(ws, { firstName: 'Beto' });
    await updateOption(ws, 'lifecycle', partner.value, { archived: true });
    // Editar otra cosa del que ya la tenía no la pierde.
    expect((await updateContact(ws, a.id, { lifecycleStage: partner.value, city: 'Rosario' }))?.lifecycle_stage).toBe(partner.value);
    await expect(updateContact(ws, b.id, { lifecycleStage: partner.value })).rejects.toBeInstanceOf(CrmRefError);
    await expect(createContact(ws, { firstName: 'C', lifecycleStage: partner.value })).rejects.toBeInstanceOf(CrmRefError);
    await expect(createContact(ws, { firstName: 'D', leadStatus: 'opt_nothere' })).rejects.toBeInstanceOf(CrmRefError);
    await updateOption(ws, 'lifecycle', partner.value, { label: 'Channel partner', archived: false });
    const h = label(await listOptionSets(ws));
    expect(h.label('lifecycle', (await getContact(ws, a.id))!.contact.lifecycle_stage)).toBe('Channel partner');
    // La opción de otro workspace no vale acá.
    const other = await addOption(w.stranger.id, 'lifecycle', 'Other');
    await expect(createContact(ws, { firstName: 'E', lifecycleStage: other.value })).rejects.toBeInstanceOf(CrmRefError);
  });

  it('con "lead" archivada, un alta sin lifecycle toma la primera activa', async () => {
    const w = await workspaceWithMember('c2-default');
    const ws = w.owner.id;
    await updateOption(ws, 'lifecycle', 'lead', { archived: true });
    const c = await createContact(ws, { firstName: 'F' });
    expect(c.lifecycle_stage).toBe('subscriber');
  });
});

describe('HubSpot: una opción propia no rompe el envío', () => {
  const defs = {
    lifecyclestage: {
      type: 'enumeration',
      readOnly: false,
      options: [
        { value: 'lead', label: 'Lead' },
        { value: '1234567', label: 'Partner' },
      ],
    },
    hs_lead_status: { type: 'enumeration', readOnly: false, options: [{ value: 'NEW', label: 'New' }] },
  };
  const ctx = {
    owners: new Map<string, string>(),
    stages: new Map<string, { stage: string; pipeline: string }>(),
    fields: [],
    defs,
    optionLabels: { lifecycle: { opt_partner: 'Partner', opt_vip: 'VIP' }, leadStatus: { opt_n: 'Nurturing' } },
  };

  it('sale con su nombre si HubSpot tiene una igual; si no, solo ese campo queda afuera', () => {
    expect(toHubspot('contacts', 'lifecycle_stage', 'opt_partner', ctx)).toEqual({ ok: true, props: { lifecyclestage: '1234567' } });
    expect(toHubspot('contacts', 'lifecycle_stage', 'opt_vip', ctx)).toEqual({ ok: false, code: 'value_not_accepted' });
    expect(toHubspot('contacts', 'lead_status', 'opt_n', ctx)).toEqual({ ok: false, code: 'value_not_accepted' });
    expect(toHubspot('contacts', 'lead_status', 'new', ctx)).toEqual({ ok: true, props: { hs_lead_status: 'NEW' } });
    expect(toHubspot('contacts', 'lifecycle_stage', 'lead', ctx)).toEqual({ ok: true, props: { lifecyclestage: 'lead' } });
  });
});

async function dealSetup(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  const pipeline = await createPipeline(ws, 'Sales');
  const open = (await createStage(ws, pipeline.id, { name: 'Open' }))!;
  const won = (await createStage(ws, pipeline.id, { name: 'Won' }))!;
  await updateStage(ws, won.id, { isWon: true });
  return { w, ws, pipeline, open, won };
}

describe('lifecycle automático', () => {
  it('deal creado: Opportunity; ganado: Customer; queda en el timeline como cambio del sistema', async () => {
    const s = await dealSetup('c2-auto');
    const contact = await createContact(s.ws, { firstName: 'G' });
    const company = await createCompany(s.ws, { name: 'Acme test' });
    const r = await createDeal(s.ws, { pipelineId: s.pipeline.id, stageId: s.open.id, name: 'D1', contactIds: [contact.id], companyId: company.id });
    expect(r.ok).toBe(true);
    const deal = (r as { deal: { id: string } }).deal;
    const db = getDb();
    const lc = async (table: string, id: string) => ((await db.prepare(`SELECT lifecycle_stage FROM ${table} WHERE id = ?`).get(id)) as { lifecycle_stage: string }).lifecycle_stage;
    expect(await lc('crm_contacts', contact.id)).toBe('opportunity');
    expect(await lc('crm_companies', company.id)).toBe('opportunity');
    await moveDeal(s.ws, deal.id, s.won.id, null, undefined, '', { enforceRequired: false });
    expect(await lc('crm_contacts', contact.id)).toBe('customer');
    expect(await lc('crm_companies', company.id)).toBe('customer');
    const changes = await listSystemChanges(s.ws, { kind: 'contact', id: contact.id });
    expect(changes.map((c) => [c.change.from, c.change.to, c.change.reason])).toEqual([
      ['opportunity', 'customer', 'deal_won'],
      ['lead', 'opportunity', 'deal_created'],
    ]);
    // El cambio no dice qué deal fue.
    expect(JSON.stringify(changes)).not.toContain(deal.id);
    // Un deal nuevo no lo vuelve a Opportunity.
    await createDeal(s.ws, { pipelineId: s.pipeline.id, stageId: s.open.id, name: 'D2', contactIds: [contact.id] });
    expect(await lc('crm_contacts', contact.id)).toBe('customer');
  });

  it('apagado por un admin: no cambia nada', async () => {
    const s = await dealSetup('c2-off');
    await updateCrmSettings(s.ws, { lifecycleAuto: false });
    const contact = await createContact(s.ws, { firstName: 'H' });
    await createDeal(s.ws, { pipelineId: s.pipeline.id, stageId: s.open.id, name: 'D', contactIds: [contact.id] });
    expect((await getContact(s.ws, contact.id))!.contact.lifecycle_stage).toBe('lead');
    expect(await listSystemChanges(s.ws, { kind: 'contact', id: contact.id })).toEqual([]);
  });

  it('el cambio del sistema solo sale en el timeline de quien ve el registro', async () => {
    const s = await dealSetup('c2-scope');
    await setMemberVisibility(s.ws, 'mine');
    const mine = await createContact(s.ws, { firstName: 'Mine', ownerId: s.w.member.id });
    const theirs = await createContact(s.ws, { firstName: 'Theirs', ownerId: s.w.friend.id });
    await createDeal(s.ws, { pipelineId: s.pipeline.id, stageId: s.open.id, name: 'D', contactIds: [mine.id, theirs.id] });
    const get = (id: string) => timelineRoute.GET(new NextRequest(`http://x/api/crm/timeline?kind=contact&id=${id}&offset=0`));
    session.user = asMember(s.w.owner, s.w.member);
    const ok = (await (await get(mine.id)).json()) as { items: Array<{ type: string }> };
    expect(ok.items.some((i) => i.type === 'change')).toBe(true);
    expect((await get(theirs.id)).status).toBe(404);
    session.user = asOwner(s.w.stranger);
    expect((await get(mine.id)).status).toBe(404);
    session.user = null;
    expect((await get(mine.id)).status).toBe(401);
  });
});

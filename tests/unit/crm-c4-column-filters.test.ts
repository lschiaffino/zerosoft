/**
 * CRM, bloque C4: "Filtrar por esta columna" desde el encabezado. La regla
 * va al filtro avanzado del listado (`filters`), el mismo que leen la página,
 * "Seleccionar todos los que coinciden" y "Exportar la vista". Se prueba cómo
 * se arma la regla, que cada columna filtra una propiedad que el panel ofrece
 * y quién ve qué con ese filtro (anónimo, otro workspace, compañero sin
 * acceso, compañero con una propiedad oculta, owner y admin). Los datos son
 * inventados.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createCompany, createContact, createCustomField, createDeal, createPipeline, createStage } from '@/lib/crm';
import { MEMBER_SUBJECT, fieldAccessFor, sessionFieldViewer, setFieldPermissions } from '@/lib/crm-field-perms';
import { setMemberVisibility } from '@/lib/crm-visibility';
import {
  fieldRule,
  fieldRuleState,
  serializeFilterModel,
  setFieldRule,
  MAX_GROUP_RULES,
  type FilterModel,
} from '@/lib/crm-filter-model';
import { resolveMatching } from '@/lib/crm-list-matching';
import { listFilterModel } from '@/lib/crm-filter-http';
import { filterTypeFor } from '@/lib/crm-custom-fields';
import { columnFilterKey, INDEX_TABLES, type IndexEntity } from '@/components/crm/tableColumns';
import { companyFilterFields, contactFilterFields, dealFilterFields, filterFieldShapes, type AdvFilterField } from '@/components/crm/advancedFilterFields';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember, type AccessWorkspace } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/server', async (orig) => ({ ...((await orig()) as object), after: () => undefined }));

const exportRoute = await import('@/app/api/crm/export/route');

beforeEach(() => {
  session.user = null;
});

const t = (k: string) => k;
const opt = (v: string) => ({ value: v, label: v });
function fieldsOf(entity: IndexEntity): AdvFilterField[] {
  const common = { t, owners: [opt('u1')], tags: [opt('t1')], customDefs: [] };
  if (entity === 'contacts') {
    return contactFilterFields({ ...common, companies: [opt('c1')], lifecycles: [opt('lead')], leadStatuses: [opt('new')], sources: [opt('web')], scores: [{ key: 'score', label: 'Score' }] });
  }
  if (entity === 'companies') return companyFilterFields({ ...common, industries: [opt('Tech')], lifecycles: [opt('lead')] });
  return dealFilterFields({ ...common, stages: [opt('s1')], priorities: [opt('high')], sources: [opt('web')], currencies: [opt('USD')], forecastCategories: [opt('commit')] });
}

describe('column filter: the rule', () => {
  const email = { f: 'email', o: 'contains', v: ['acme'] };
  const lead = { f: 'lifecycle', o: 'is', v: ['lead'] };
  const customer = { f: 'lifecycle', o: 'is', v: ['customer'] };
  const mine = { f: 'owner', o: 'is', v: ['me'] };

  it('adds the rule as one more AND condition, in every OR group', () => {
    expect(setFieldRule({ v: 1, groups: [] }, 'email', email)).toEqual({ v: 1, groups: [{ rules: [email] }] });
    const two: FilterModel = { v: 1, groups: [{ rules: [lead] }, { rules: [mine] }] };
    expect(setFieldRule(two, 'email', email)!.groups).toEqual([{ rules: [lead, email] }, { rules: [mine, email] }]);
  });

  it('replaces the column’s own rule, reads it back and removes it', () => {
    const withRule = setFieldRule({ v: 1, groups: [{ rules: [{ f: 'email', o: 'known' }, { f: 'city', o: 'equals', v: ['Rosario'] }] }] }, 'email', email)!;
    expect(withRule.groups[0].rules).toEqual([{ f: 'city', o: 'equals', v: ['Rosario'] }, email]);
    expect(fieldRule(withRule, 'email')).toEqual(email);
    expect(fieldRule(withRule, 'phone')).toBeUndefined();
    const cleared = setFieldRule(withRule, 'email', null)!;
    expect(cleared.groups).toEqual([{ rules: [{ f: 'city', o: 'equals', v: ['Rosario'] }] }]);
    // Sin otra regla, quitarla deja el filtro vacío (y la URL sin `filters`).
    expect(serializeFilterModel(setFieldRule(setFieldRule({ v: 1, groups: [] }, 'email', email)!, 'email', null)!)).toBe('');
  });

  it('the same rule in every group is edited and removed in all of them; editing without changes keeps the filter', () => {
    const both: FilterModel = { v: 1, groups: [{ rules: [lead, email] }, { rules: [mine, email] }] };
    expect(fieldRuleState(both, 'email')).toEqual({ kind: 'simple', rule: email });
    expect(setFieldRule(both, 'email', email)).toEqual(both);
    expect(setFieldRule(both, 'email', null)!.groups).toEqual([{ rules: [lead] }, { rules: [mine] }]);
    // Si un grupo era solo esa regla, sin ella acepta todo: el filtro entero también.
    expect(setFieldRule({ v: 1, groups: [{ rules: [email] }, { rules: [mine, email] }] }, 'email', null)).toEqual({ v: 1, groups: [] });
  });

  it('what a column cannot show as one rule goes to Advanced filters, untouched', () => {
    // En un grupo sí y en otro no: "lead O (cliente Y reciente)".
    const partial: FilterModel = { v: 1, groups: [{ rules: [lead] }, { rules: [customer, { f: 'created', o: 'last_days', v: '30' }] }] };
    expect(fieldRuleState(partial, 'created')).toEqual({ kind: 'complex' });
    expect(setFieldRule(partial, 'created', { f: 'created', o: 'last_days', v: '30' })).toBeNull();
    expect(setFieldRule(partial, 'created', null)).toBeNull();
    // Distinta entre grupos.
    expect(fieldRuleState({ v: 1, groups: [{ rules: [lead] }, { rules: [customer] }] }, 'lifecycle')).toEqual({ kind: 'complex' });
    // Un mínimo y un máximo en el mismo grupo.
    const range: FilterModel = { v: 1, groups: [{ rules: [{ f: 'amount', o: 'gt', v: '100' }, { f: 'amount', o: 'lt', v: '1000' }] }] };
    expect(fieldRuleState(range, 'amount')).toEqual({ kind: 'complex' });
    expect(fieldRule(range, 'amount')).toBeUndefined();
    expect(setFieldRule(range, 'amount', { f: 'amount', o: 'gt', v: '5' })).toBeNull();
  });

  it('a full group refuses the rule instead of dropping it', () => {
    const full: FilterModel = { v: 1, groups: [{ rules: Array.from({ length: MAX_GROUP_RULES }, (_, i) => ({ f: `custom:f${i}`, o: 'known' })) }] };
    expect(setFieldRule(full, 'email', email)).toBeNull();
    // Reemplazar una que ya está no necesita lugar.
    const withEmail: FilterModel = { v: 1, groups: [{ rules: [...full.groups[0].rules.slice(1), email] }] };
    expect(setFieldRule(withEmail, 'email', { f: 'email', o: 'known' })!.groups[0].rules).toHaveLength(MAX_GROUP_RULES);
  });

  it('every filterable column points at a property the filter panel offers', () => {
    for (const [entity, spec] of Object.entries(INDEX_TABLES) as Array<[IndexEntity, (typeof INDEX_TABLES)[IndexEntity]]>) {
      const keys = new Set(fieldsOf(entity).map((f) => f.key));
      for (const col of spec.columns) {
        const key = columnFilterKey(entity, col.id);
        if (key) expect(keys.has(key), `${entity}.${col.id} → ${key}`).toBe(true);
      }
      expect(columnFilterKey(entity, 'custom:plan')).toBe('custom:plan');
      expect(columnFilterKey(entity, 'nope')).toBeNull();
    }
    // Lo esencial de cada tabla se filtra desde su encabezado, con el control del tipo de lo que muestra.
    const typeOf = (entity: IndexEntity, col: string) => fieldsOf(entity).find((f) => f.key === columnFilterKey(entity, col))?.type;
    expect(['name', 'email', 'phone', 'company'].map((c) => typeOf('contacts', c))).toEqual(['text', 'text', 'text', 'text']);
    expect(['lifecycle', 'leadStatus', 'source', 'owner', 'tags'].map((c) => typeOf('contacts', c))).toEqual(['select', 'select', 'select', 'select', 'select']);
    expect(['created', 'lastActivity', 'nextActivity'].map((c) => typeOf('contacts', c))).toEqual(['date', 'date', 'date']);
    expect(typeOf('contacts', 'score')).toBe('number');
    expect([typeOf('companies', 'contacts'), typeOf('companies', 'industry'), typeOf('companies', 'domain')]).toEqual(['number', 'select', 'text']);
    expect([typeOf('deals', 'amount'), typeOf('deals', 'stage'), typeOf('deals', 'closeDate'), typeOf('deals', 'priority')]).toEqual(['number', 'select', 'date', 'select']);
  });
});

describe('column filter: who sees what', () => {
  let w: AccessWorkspace;
  const tag = 'colfilt';
  const query = (model: FilterModel) => `filters=${encodeURIComponent(serializeFilterModel(model))}`;
  const byEmail = setFieldRule({ v: 1, groups: [] }, 'email', { f: 'email', o: 'contains', v: [tag] })!;
  const bySalary = setFieldRule({ v: 1, groups: [] }, 'custom:salary', { f: 'custom:salary', o: 'gt', v: '1000' })!;
  const ids = {} as Record<'mine' | 'friend' | 'rich', string>;

  beforeAll(async () => {
    w = await workspaceWithMember('c4f');
    await setMemberVisibility(w.owner.id, 'mine');
    const salary = await createCustomField(w.owner.id, { entity: 'contacts', name: 'salary', label: 'Salary', type: 'number' });
    await setFieldPermissions(w.owner.id, salary.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
    ids.mine = (await createContact(w.owner.id, { firstName: 'Mine', email: `mine-${tag}@x.test`, ownerId: w.member.id, custom: { salary: 50 } })).id;
    ids.rich = (await createContact(w.owner.id, { firstName: 'Rich', email: `rich-${tag}@x.test`, ownerId: w.member.id, custom: { salary: 90000 } })).id;
    ids.friend = (await createContact(w.owner.id, { firstName: 'Friend', email: `friend-${tag}@x.test`, ownerId: w.friend.id })).id;
  });

  it('owner and admin get every record the column filter matches', async () => {
    for (const user of [asOwner(w.owner), asMember(w.owner, w.friend, 'admin')]) {
      const res = await resolveMatching(user, 'contacts', query(byEmail), 100);
      expect('ids' in res && [...res.ids].sort()).toEqual([ids.mine, ids.rich, ids.friend].sort());
      // El owner sí filtra por la propiedad que el member tiene oculta.
      const rich = await resolveMatching(user, 'contacts', query(bySalary), 100);
      expect('ids' in rich && rich.ids).toEqual([ids.rich]);
    }
  });

  it('a member only gets their own records', async () => {
    const res = await resolveMatching(asMember(w.owner, w.member), 'contacts', query(byEmail), 100);
    expect('ids' in res && [...res.ids].sort()).toEqual([ids.mine, ids.rich].sort());
  });

  it('a member without access to those records gets none of them', async () => {
    const res = await resolveMatching(asMember(w.owner, w.friend), 'contacts', query(setFieldRule({ v: 1, groups: [] }, 'email', { f: 'email', o: 'contains', v: ['mine-colfilt'] })!), 100);
    expect(res).toEqual({ ids: [], total: 0 });
  });

  it('another workspace never sees these records', async () => {
    const res = await resolveMatching(asOwner(w.stranger), 'contacts', query(byEmail), 100);
    expect(res).toEqual({ ids: [], total: 0 });
  });

  it('a member cannot filter by a property hidden to them: the page and select-all drop the rule (listFilterModel)', async () => {
    const member = asMember(w.owner, w.member);
    // Select all / export: la regla sobre el campo oculto no se aplica (sería una forma de leerlo): salen sus dos contactos.
    const res = await resolveMatching(member, 'contacts', query(bySalary), 100);
    expect('ids' in res && [...res.ids].sort()).toEqual([ids.mine, ids.rich].sort());
    // La página: las propiedades que la persona puede filtrar no incluyen la oculta, y el filtro la descarta.
    const visible = (await fieldAccessFor(sessionFieldViewer(member), 'contacts')).visible;
    const fields = contactFilterFields({ t, owners: [], tags: [], customDefs: visible, companies: [], lifecycles: [], leadStatuses: [], sources: [], scores: [] });
    expect(fields.some((f) => f.key === 'custom:salary')).toBe(false);
    const customTypes = Object.fromEntries(visible.map((d) => [d.name, filterTypeFor(d.type)]));
    const model = listFilterModel(serializeFilterModel(bySalary), 'contacts', {
      customTypes,
      env: { viewerId: w.member.id, timeZone: 'UTC', strictCustom: true },
      shapes: filterFieldShapes(fields),
    });
    expect(model.groups).toEqual([]);
    // El owner sí: la misma regla se aplica.
    const ownerTypes = Object.fromEntries((await fieldAccessFor(sessionFieldViewer(asOwner(w.owner)), 'contacts')).visible.map((d) => [d.name, filterTypeFor(d.type)]));
    expect(listFilterModel(serializeFilterModel(bySalary), 'contacts', { customTypes: ownerTypes, env: { viewerId: w.owner.id, timeZone: 'UTC', strictCustom: true } }).groups).toHaveLength(1);
  });

  it('counts of associated records only count what the member sees (Contacts column of companies, deals of a contact)', async () => {
    const member = asMember(w.owner, w.member);
    // Otra marca: estos contactos no deben entrar en los filtros por email de los otros tests.
    const k = 'cntq';
    const co = await createCompany(w.owner.id, { name: `Counted ${tag}`, ownerId: w.member.id });
    await createContact(w.owner.id, { firstName: 'Seen', email: `seen-${k}@count.test`, companyId: co.id, ownerId: w.member.id });
    for (const i of [1, 2]) await createContact(w.owner.id, { firstName: 'Unseen', email: `unseen${i}-${k}@count.test`, companyId: co.id, ownerId: w.friend.id });
    const count = (o: string, v: string) => setFieldRule({ v: 1, groups: [] }, 'contactCount', { f: 'contactCount', o, v })!;
    const named = (m: FilterModel) => `${query(m)}&q=${encodeURIComponent(`Counted ${tag}`)}`;
    expect(await resolveMatching(member, 'companies', named(count('eq', '1')), 100)).toEqual({ ids: [co.id], total: 1 });
    expect(await resolveMatching(member, 'companies', named(count('eq', '3')), 100)).toEqual({ ids: [], total: 0 });
    expect(await resolveMatching(member, 'companies', named(count('gt', '1')), 100)).toEqual({ ids: [], total: 0 });
    // El owner ve los tres.
    expect(await resolveMatching(asOwner(w.owner), 'companies', named(count('eq', '3')), 100)).toEqual({ ids: [co.id], total: 1 });

    const p = await createPipeline(w.owner.id, 'Count pipe');
    const stage = (await createStage(w.owner.id, p.id, { name: 'Open' }))!;
    const c = await createContact(w.owner.id, { firstName: 'Dealt', email: `dealt-${k}@count.test`, ownerId: w.member.id });
    const d = await createDeal(w.owner.id, { name: `Hidden deal ${tag}`, pipelineId: p.id, stageId: stage.id, ownerId: w.friend.id, contactIds: [c.id] });
    expect(d.ok).toBe(true);
    const deals = (rule: { f: string; o: string; v?: string }) => `${query(setFieldRule({ v: 1, groups: [] }, rule.f, rule)!)}&q=${encodeURIComponent(`dealt-${k}`)}`;
    expect(await resolveMatching(member, 'contacts', deals({ f: 'dealCount', o: 'gte', v: '1' }), 100)).toEqual({ ids: [], total: 0 });
    expect(await resolveMatching(member, 'contacts', deals({ f: 'hasOpenDeal', o: 'true' }), 100)).toEqual({ ids: [], total: 0 });
    expect(await resolveMatching(asOwner(w.owner), 'contacts', deals({ f: 'dealCount', o: 'gte', v: '1' }), 100)).toEqual({ ids: [c.id], total: 1 });
    expect(await resolveMatching(asOwner(w.owner), 'contacts', deals({ f: 'hasOpenDeal', o: 'true' }), 100)).toEqual({ ids: [c.id], total: 1 });
  });

  it('export of a column-filtered view: anonymous 401, member 403, admin gets the matching rows', async () => {
    const url = `http://x/api/crm/export?entity=contacts&list=${encodeURIComponent(query(byEmail))}`;
    expect((await exportRoute.GET(new NextRequest(url))).status).toBe(401);
    session.user = asMember(w.owner, w.member);
    expect((await exportRoute.GET(new NextRequest(url))).status).toBe(403);
    session.user = asOwner(w.owner);
    const res = await exportRoute.GET(new NextRequest(url));
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain(`rich-${tag}@x.test`);
    expect(csv.trim().split('\n')).toHaveLength(4);
  });
});

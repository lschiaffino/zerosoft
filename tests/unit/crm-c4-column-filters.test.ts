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
import { createContact, createCustomField } from '@/lib/crm';
import { MEMBER_SUBJECT, fieldAccessFor, sessionFieldViewer, setFieldPermissions } from '@/lib/crm-field-perms';
import { setMemberVisibility } from '@/lib/crm-visibility';
import {
  fieldRule,
  parseFilterModel,
  sanitizeFilterModel,
  serializeFilterModel,
  setFieldRule,
  MAX_GROUP_RULES,
  type FilterModel,
} from '@/lib/crm-filter-model';
import { resolveMatching } from '@/lib/crm-list-matching';
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

  it('adds the rule as one more AND condition, in every OR group', () => {
    expect(setFieldRule({ v: 1, groups: [] }, 'email', email)).toEqual({ v: 1, groups: [{ rules: [email] }] });
    const two: FilterModel = { v: 1, groups: [{ rules: [{ f: 'lifecycle', o: 'is', v: ['lead'] }] }, { rules: [{ f: 'owner', o: 'is', v: ['me'] }] }] };
    expect(setFieldRule(two, 'email', email).groups).toEqual([
      { rules: [{ f: 'lifecycle', o: 'is', v: ['lead'] }, email] },
      { rules: [{ f: 'owner', o: 'is', v: ['me'] }, email] },
    ]);
  });

  it('replaces the column’s own rule, reads it back and removes it', () => {
    const withRule = setFieldRule({ v: 1, groups: [{ rules: [{ f: 'email', o: 'known' }, { f: 'city', o: 'equals', v: ['Rosario'] }] }] }, 'email', email);
    expect(withRule.groups[0].rules).toEqual([{ f: 'city', o: 'equals', v: ['Rosario'] }, email]);
    expect(fieldRule(withRule, 'email')).toEqual(email);
    expect(fieldRule(withRule, 'phone')).toBeUndefined();
    const cleared = setFieldRule(withRule, 'email', null);
    expect(cleared.groups).toEqual([{ rules: [{ f: 'city', o: 'equals', v: ['Rosario'] }] }]);
    // Sin otra regla, quitarla deja el filtro vacío (y la URL sin `filters`).
    expect(serializeFilterModel(setFieldRule(setFieldRule({ v: 1, groups: [] }, 'email', email), 'email', null))).toBe('');
  });

  it('a full group keeps its rules', () => {
    const full: FilterModel = { v: 1, groups: [{ rules: Array.from({ length: MAX_GROUP_RULES }, (_, i) => ({ f: `custom:f${i}`, o: 'known' })) }] };
    expect(setFieldRule(full, 'email', email).groups[0].rules).toHaveLength(MAX_GROUP_RULES);
    expect(fieldRule(setFieldRule(full, 'email', email), 'email')).toBeUndefined();
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
    // Lo esencial de cada tabla se filtra desde su encabezado.
    for (const id of ['name', 'email', 'lifecycle', 'owner', 'created']) expect(columnFilterKey('contacts', id)).not.toBeNull();
    for (const id of ['name', 'amount', 'stage', 'closeDate', 'owner']) expect(columnFilterKey('deals', id)).not.toBeNull();
  });
});

describe('column filter: who sees what', () => {
  let w: AccessWorkspace;
  const tag = 'colfilt';
  const query = (model: FilterModel) => `filters=${encodeURIComponent(serializeFilterModel(model))}`;
  const byEmail = setFieldRule({ v: 1, groups: [] }, 'email', { f: 'email', o: 'contains', v: [tag] });
  const bySalary = setFieldRule({ v: 1, groups: [] }, 'custom:salary', { f: 'custom:salary', o: 'gt', v: '1000' });
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
    const res = await resolveMatching(asMember(w.owner, w.friend), 'contacts', query(setFieldRule({ v: 1, groups: [] }, 'email', { f: 'email', o: 'contains', v: ['mine-colfilt'] })), 100);
    expect(res).toEqual({ ids: [], total: 0 });
  });

  it('another workspace never sees these records', async () => {
    const res = await resolveMatching(asOwner(w.stranger), 'contacts', query(byEmail), 100);
    expect(res).toEqual({ ids: [], total: 0 });
  });

  it('a member cannot filter by a property hidden to them: the page drops the rule and select-all rejects it', async () => {
    const member = asMember(w.owner, w.member);
    // Select all / export: un filtro sobre un campo oculto no se aplica (sería una forma de leerlo).
    expect(await resolveMatching(member, 'contacts', query(bySalary), 100)).toEqual({ error: 'invalid_filter' });
    // La página: el filtro se valida contra las propiedades que la persona puede filtrar (sin las ocultas).
    const visible = (await fieldAccessFor(sessionFieldViewer(member), 'contacts')).visible;
    const fields = contactFilterFields({ t, owners: [], tags: [], customDefs: visible, companies: [], lifecycles: [], leadStatuses: [], sources: [], scores: [] });
    expect(fields.some((f) => f.key === 'custom:salary')).toBe(false);
    expect(sanitizeFilterModel(parseFilterModel(serializeFilterModel(bySalary)), filterFieldShapes(fields)).groups).toEqual([]);
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

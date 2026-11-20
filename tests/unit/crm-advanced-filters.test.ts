import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb, type UserRow } from '@/lib/db';
import {
  CRM_FILTER_FIELDS,
  createCompany,
  createContact,
  createCustomField,
  createDeal,
  createPipeline,
  createStage,
  exportRows,
  listCompanies,
  listContacts,
  listDeals,
} from '@/lib/crm';
import {
  FILTER_OPS,
  MAX_FILTER_GROUPS,
  isRuleComplete,
  opArity,
  parseFilterModel,
  sanitizeFilterModel,
  serializeFilterModel,
  type FilterCond,
  type FilterModel,
} from '@/lib/crm-filter-model';
import { FilterError, compileFilterModel, compileRule, dayStartUtc, parseStrictFilter, periodDays, todayIn } from '@/lib/crm-filters';
import { setFieldPermissions } from '@/lib/crm-field-perms';
import { ownerScopeFor, setMemberVisibility } from '@/lib/crm-visibility';
import { applyTag, createTag } from '@/lib/crm-tags';
import { createApiKey } from '@/lib/api-auth';
import { addMember, createTeam, type TeamRole } from '@/lib/teams';
import { makeUser } from './helpers';

/**
 * Filtros avanzados del CRM: el modelo (grupos Y dentro, O entre grupos), el
 * compilador a SQL por tipo de propiedad y operador, las fechas relativas en la
 * zona de quien mira, y que ningún grupo O ensancha lo que una persona ve.
 */

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role: string }) => u.role === 'owner' || u.role === 'admin',
}));

const contactsRoute = await import('@/app/api/crm/contacts/route');
const companiesRoute = await import('@/app/api/crm/companies/route');
const dealsRoute = await import('@/app/api/crm/deals/route');
const exportRoute = await import('@/app/api/crm/export/route');
const v1Contacts = await import('@/app/api/v1/crm/contacts/route');
const v1Companies = await import('@/app/api/v1/crm/companies/route');
const v1Deals = await import('@/app/api/v1/crm/deals/route');

beforeEach(() => {
  session.user = null;
});

function actAs(owner: UserRow, person: UserRow, role: TeamRole) {
  session.user = person.id === owner.id ? { ...owner, role: 'owner', team: null } : { ...owner, actingUser: person, role, team: null };
}

const nextReq = (url: string, key?: string) => new NextRequest(url, { headers: key ? { authorization: `Bearer ${key}` } : {} }) as never;
const model = (...groups: FilterCond[][]): FilterModel => ({ v: 1, groups: groups.map((rules) => ({ rules })) });
const q = (m: FilterModel | FilterCond[]) => encodeURIComponent(JSON.stringify(m));

const C = CRM_FILTER_FIELDS.contacts;
const ctx = { alias: C.alias, fields: C.fields };

/** Nombres (first_name) de los contactos que pasan el filtro. */
async function names(userId: string, m: FilterModel, extra: Parameters<typeof listContacts>[1] = {}): Promise<string[]> {
  const { rows, total } = await listContacts(userId, { filters: m, pageSize: 100, ...extra });
  expect(total).toBe(rows.length);
  return rows.map((r) => r.first_name).sort();
}

describe('modelo del filtro', () => {
  it('lee el modelo con grupos y la lista plana de antes (un solo grupo)', () => {
    const flat = parseFilterModel(JSON.stringify([{ f: 'email', o: 'contains', v: 'acme' }, { f: 'score', o: 'gt', v: '5' }]));
    expect(flat).toEqual(model([{ f: 'email', o: 'contains', v: 'acme' }, { f: 'score', o: 'gt', v: '5' }]));
    const grouped = parseFilterModel(JSON.stringify({ v: 1, groups: [{ rules: [{ f: 'owner', o: 'is', v: ['me', 'unassigned'] }] }, { rules: [{ f: 'city', o: 'known' }] }] }));
    expect(grouped.groups).toHaveLength(2);
    expect(grouped.groups[0].rules[0].v).toEqual(['me', 'unassigned']);
    // Ida y vuelta estable: lo que se guarda en una vista se vuelve a leer igual.
    expect(parseFilterModel(serializeFilterModel(grouped))).toEqual(grouped);
  });

  it('descarta lo corrupto y respeta los límites', () => {
    expect(parseFilterModel('not json').groups).toEqual([]);
    expect(parseFilterModel('{"groups":"x"}').groups).toEqual([]);
    expect(parseFilterModel('null').groups).toEqual([]);
    expect(parseFilterModel(JSON.stringify({ groups: [{ rules: [null, 3, { f: 'email' }, { f: '', o: 'is' }] }] })).groups).toEqual([]);
    const many = { groups: Array.from({ length: 9 }, () => ({ rules: [{ f: 'email', o: 'known' }] })) };
    expect(parseFilterModel(JSON.stringify(many)).groups).toHaveLength(MAX_FILTER_GROUPS);
    expect(serializeFilterModel(model())).toBe('');
    expect(serializeFilterModel(model([]))).toBe('');
  });

  it('sanitize deja solo reglas de propiedades conocidas, con operador de su tipo y valor completo', () => {
    const shapes = { email: { type: 'text' as const }, score: { type: 'number' as const }, created: { type: 'date' as const }, vip: { type: 'boolean' as const } };
    const dirty = model(
      [
        { f: 'email', o: 'contains', v: 'a' },
        { f: 'email', o: 'gt', v: '1' }, // operador de otro tipo
        { f: 'nope', o: 'contains', v: 'a' }, // propiedad desconocida
        { f: 'constructor', o: 'contains', v: 'a' }, // clave del prototipo
        { f: 'score', o: 'between', v: '1' }, // falta el segundo extremo
        { f: 'created', o: 'on', v: '2026-02-30' }, // día que no existe
        { f: 'created', o: 'last_days', v: '0' },
        { f: 'vip', o: 'is', v: '1' }, // forma vieja de un sí/no: se conserva
      ],
      [{ f: 'nope', o: 'known' }],
    );
    expect(sanitizeFilterModel(dirty, shapes)).toEqual(model([{ f: 'email', o: 'contains', v: 'a' }, { f: 'vip', o: 'is', v: '1' }]));
  });

  it('cada operador declara qué valor lleva', () => {
    expect(opArity('text', 'equals')).toBe('many');
    expect(opArity('select', 'isnot')).toBe('many');
    expect(opArity('number', 'between')).toBe('two');
    expect(opArity('date', 'between')).toBe('two');
    expect(opArity('date', 'this_quarter')).toBe('none');
    expect(opArity('date', 'more_days_ago')).toBe('days');
    expect(opArity('boolean', 'true')).toBe('none');
    expect(opArity('text', 'unknown')).toBe('none');
    expect(isRuleComplete('number', { f: 'x', o: 'eq', v: 'abc' })).toBe(false);
    expect(isRuleComplete('select', { f: 'x', o: 'is', v: [] })).toBe(false);
    expect(isRuleComplete('select', { f: 'x', o: 'is', v: ['a'] })).toBe(true);
    // Todo operador ofrecido compila con un valor de ejemplo (ninguno queda sin implementar).
    for (const type of ['text', 'number', 'select', 'date', 'boolean'] as const) {
      for (const o of FILTER_OPS[type]) {
        const arity = opArity(type, o);
        const v = arity === 'none' ? undefined : type === 'date' && arity !== 'days' ? '2026-01-10' : '3';
        const def = { expr: 'c.x', type };
        const cond = compileRule({ alias: 'c', fields: { x: def }, viewerId: 'u' }, { f: 'x', o, v, v2: arity === 'two' ? (type === 'date' ? '2026-01-20' : '9') : undefined });
        expect(cond, `${type} ${o}`).not.toBeNull();
      }
    }
    for (const o of FILTER_OPS.multiselect) {
      const cond = compileRule({ alias: 'c', fields: {}, customTypes: { tags: 'multiselect' } }, { f: 'custom:tags', o, v: ['a'] });
      expect(cond, `multiselect ${o}`).not.toBeNull();
    }
  });
});

describe('compilador: seguridad', () => {
  it('rechaza propiedades y operadores desconocidos', () => {
    expect(compileRule(ctx, { f: 'nope', o: 'contains', v: 'a' })).toBeNull();
    expect(compileRule(ctx, { f: 'email', o: 'gt', v: '1' })).toBeNull();
    expect(compileRule(ctx, { f: 'score', o: 'contains', v: '1' })).toBeNull();
    expect(compileRule(ctx, { f: 'created', o: 'contains', v: '2026-01-01' })).toBeNull();
    expect(compileRule(ctx, { f: 'lifecycle', o: 'starts', v: 'lead' })).toBeNull();
    // Claves del prototipo: no son propiedades.
    for (const f of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(compileRule(ctx, { f, o: 'contains', v: 'a' })).toBeNull();
    }
    expect(() => compileFilterModel(ctx, model([{ f: 'nope', o: 'known' }]), { strict: true })).toThrow(FilterError);
    // Sin strict, la regla inválida se ignora y el resto del grupo sigue valiendo.
    const lenient = compileFilterModel(ctx, model([{ f: 'nope', o: 'known' }, { f: 'city', o: 'known' }]));
    expect(lenient?.sql).toContain('c.city');
    expect(compileFilterModel(ctx, model([{ f: 'nope', o: 'known' }]))).toBeNull();
  });

  it('una propiedad propia tiene que tener nombre seguro y, con strictCustom, existir en el workspace', () => {
    const attacks = [
      "custom:x') OR 1=1 --",
      "custom:x'; DROP TABLE crm_contacts; --",
      'custom:a.b',
      'custom:a"b',
      'custom:a b',
      'custom:$',
      'custom:',
      "c.email) OR (1=1",
      'email; DELETE FROM users',
    ];
    for (const f of attacks) {
      for (const o of ['contains', 'equals', 'known', 'unknown', 'is', 'eq', 'on']) {
        expect(compileRule({ ...ctx, customTypes: {} }, { f, o, v: 'x' }), `${f} ${o}`).toBeNull();
      }
    }
    const strict = { ...ctx, customTypes: { plan: 'select' as const }, strictCustom: true };
    expect(compileRule(strict, { f: 'custom:plan', o: 'is', v: ['pro'] })).not.toBeNull();
    expect(compileRule(strict, { f: 'custom:secret', o: 'known' })).toBeNull();
    // Sin strictCustom (listas dinámicas viejas) una propia sin tipo se compara como texto.
    expect(compileRule(ctx, { f: 'custom:legacy', o: 'contains', v: 'a' })?.sql).toContain("'$.legacy'");
  });

  it('todo valor va como parámetro: nada del usuario entra en el SQL', async () => {
    const evil = "x' OR '1'='1";
    const evil2 = '%"); DROP TABLE crm_contacts; --';
    const rules: FilterCond[] = [
      { f: 'email', o: 'contains', v: [evil, evil2] },
      { f: 'email', o: 'equals', v: [evil] },
      { f: 'name', o: 'not_contains', v: [evil2] },
      { f: 'lifecycle', o: 'is', v: [evil, evil2] },
      { f: 'owner', o: 'isnot', v: [evil, 'unassigned'] },
      { f: 'tag', o: 'is', v: [evil] },
      { f: 'custom:plan', o: 'is', v: [evil2] },
      { f: 'custom:topics', o: 'all', v: [evil, evil2] },
      { f: 'score', o: 'eq', v: '7' },
    ];
    const compiled = compileFilterModel({ ...ctx, customTypes: { plan: 'select', topics: 'multiselect' }, viewerId: 'me-id' }, model(rules), { strict: true });
    expect(compiled).not.toBeNull();
    expect(compiled!.sql).not.toContain('DROP');
    expect(compiled!.sql).not.toContain("'1'='1");
    expect(compiled!.sql.split('?').length - 1).toBe(compiled!.args.length);
    // Un número que no es número se rechaza en vez de interpolarse.
    expect(compileRule(ctx, { f: 'score', o: 'eq', v: '1 OR 1=1' })).toBeNull();
    expect(compileRule(ctx, { f: 'created', o: 'on', v: "2026-01-01' OR '1'='1" })).toBeNull();
    expect(compileRule(ctx, { f: 'created', o: 'last_days', v: '7; DROP' })).toBeNull();

    // Y contra la base: el valor malicioso es solo texto que no coincide con nada.
    const u = await makeUser('af-inj');
    await createContact(u.id, { firstName: 'Safe', email: 'safe@inj.test' });
    expect(await names(u.id, model([{ f: 'email', o: 'contains', v: [evil] }]))).toEqual([]);
    expect(await names(u.id, model([{ f: 'email', o: 'equals', v: [evil2] }], [{ f: 'lifecycle', o: 'is', v: [evil] }]))).toEqual([]);
    expect((await listContacts(u.id, {})).total).toBe(1);
    // Los comodines de LIKE del usuario son literales.
    expect(await names(u.id, model([{ f: 'email', o: 'contains', v: ['%'] }]))).toEqual([]);
    expect(await names(u.id, model([{ f: 'email', o: 'contains', v: ['s_fe'] }]))).toEqual([]);
  });

  it('el filtro estricto de la API rechaza JSON roto, de más y reglas inválidas', () => {
    const strict = { ...ctx, customTypes: {}, strictCustom: true, viewerId: 'u' };
    const ok = parseStrictFilter(strict, JSON.stringify(model([{ f: 'email', o: 'contains', v: 'a' }])));
    expect(ok.groups).toHaveLength(1);
    expect(parseStrictFilter(strict, JSON.stringify([{ f: 'email', o: 'contains', v: 'a' }])).groups).toHaveLength(1);
    const bad = [
      'not json',
      '"text"',
      '{}',
      JSON.stringify({ groups: Array.from({ length: MAX_FILTER_GROUPS + 1 }, () => ({ rules: [{ f: 'email', o: 'known' }] })) }),
      JSON.stringify(model([{ f: 'nope', o: 'known' }])),
      JSON.stringify(model([{ f: 'email', o: 'gt', v: '1' }])),
      JSON.stringify(model([{ f: 'email', o: 'contains' }])),
      JSON.stringify({ groups: [{ rules: [{ f: 'email', o: 'known' }, 'x'] }] }),
      JSON.stringify(model([{ f: 'custom:hidden', o: 'known' }])),
    ];
    for (const raw of bad) expect(() => parseStrictFilter(strict, raw), raw).toThrow(FilterError);
  });
});

describe('compilador: operadores por tipo (contra la base)', () => {
  it('texto: igual / distinto de varios, contiene, empieza, termina, con y sin valor (vacío = sin valor)', async () => {
    const u = await makeUser('af-text');
    await createContact(u.id, { firstName: 'Ana', email: 'ana@kallpa.test', city: 'Lima', jobTitle: 'CEO' });
    await createContact(u.id, { firstName: 'Beto', email: 'beto@norte.test', city: 'Quito', jobTitle: 'cto' });
    await createContact(u.id, { firstName: 'Caro', email: 'caro@kallpa.test', city: '' });
    const one = (rule: FilterCond) => names(u.id, model([rule]));

    expect(await one({ f: 'city', o: 'equals', v: ['lima', 'QUITO'] })).toEqual(['Ana', 'Beto']); // sin distinguir mayúsculas
    expect(await one({ f: 'city', o: 'not_equals', v: ['Lima'] })).toEqual(['Beto', 'Caro']); // incluye a quien no tiene valor
    expect(await one({ f: 'email', o: 'contains', v: ['KALLPA'] })).toEqual(['Ana', 'Caro']);
    expect(await one({ f: 'email', o: 'contains', v: ['norte', 'ana@'] })).toEqual(['Ana', 'Beto']);
    expect(await one({ f: 'email', o: 'not_contains', v: ['kallpa'] })).toEqual(['Beto']);
    expect(await one({ f: 'email', o: 'not_contains', v: ['kallpa', 'norte'] })).toEqual([]);
    expect(await one({ f: 'email', o: 'starts', v: ['be', 'ca'] })).toEqual(['Beto', 'Caro']);
    expect(await one({ f: 'email', o: 'ends', v: ['norte.test'] })).toEqual(['Beto']);
    expect(await one({ f: 'city', o: 'known' })).toEqual(['Ana', 'Beto']);
    expect(await one({ f: 'city', o: 'unknown' })).toEqual(['Caro']); // '' cuenta como sin valor
    expect(await one({ f: 'jobTitle', o: 'unknown' })).toEqual(['Caro']);
    expect(await one({ f: 'name', o: 'starts', v: ['an'] })).toEqual(['Ana']);
    // La forma vieja (un solo valor como texto) sigue valiendo.
    expect(await one({ f: 'email', o: 'contains', v: 'norte' })).toEqual(['Beto']);
  });

  it('con valor / sin valor: null y texto vacío son lo mismo', async () => {
    const u = await makeUser('af-known');
    await createCustomField(u.id, { entity: 'contacts', name: 'nick', label: 'Nick', type: 'text' });
    const co = await createCompany(u.id, { name: 'Kallpa' });
    await createContact(u.id, { firstName: 'WithAll', companyId: co.id, custom: { nick: 'wa' }, source: 'ads' });
    await createContact(u.id, { firstName: 'Empty', custom: { nick: '' } });
    await createContact(u.id, { firstName: 'Missing' });
    const customTypes = { nick: 'text' as const };
    const one = (rule: FilterCond) => names(u.id, model([rule]), { customTypes });
    expect(await one({ f: 'custom:nick', o: 'known' })).toEqual(['WithAll']);
    expect(await one({ f: 'custom:nick', o: 'unknown' })).toEqual(['Empty', 'Missing']); // '' y ausente
    expect(await one({ f: 'company', o: 'unknown' })).toEqual(['Empty', 'Missing']); // NULL
    expect(await one({ f: 'company', o: 'known' })).toEqual(['WithAll']);
    expect(await one({ f: 'source', o: 'unknown' })).toEqual(['Empty', 'Missing']); // ''
    expect(await one({ f: 'companyName', o: 'contains', v: ['kall'] })).toEqual(['WithAll']);
    expect(await one({ f: 'companyName', o: 'unknown' })).toEqual(['Empty', 'Missing']);
  });

  it('número: igual, distinto, mayor, menor (o igual), entre, con y sin valor', async () => {
    const u = await makeUser('af-num');
    await createCustomField(u.id, { entity: 'companies', name: 'seats', label: 'Seats', type: 'number' });
    await createCompany(u.id, { name: 'Small', employees: 10, custom: { seats: 5 } });
    await createCompany(u.id, { name: 'Mid', employees: 50, custom: { seats: 20 } });
    await createCompany(u.id, { name: 'Big', employees: 500 });
    await createCompany(u.id, { name: 'Unknown' });
    const customTypes = { seats: 'number' as const };
    const one = async (rule: FilterCond) =>
      (await listCompanies(u.id, { filters: model([rule]), customTypes, pageSize: 100 })).rows.map((r) => r.name).sort();
    expect(await one({ f: 'employees', o: 'eq', v: '50' })).toEqual(['Mid']);
    expect(await one({ f: 'employees', o: 'neq', v: '50' })).toEqual(['Big', 'Small']);
    expect(await one({ f: 'employees', o: 'gt', v: '50' })).toEqual(['Big']);
    expect(await one({ f: 'employees', o: 'gte', v: '50' })).toEqual(['Big', 'Mid']);
    expect(await one({ f: 'employees', o: 'lt', v: '50' })).toEqual(['Small']);
    expect(await one({ f: 'employees', o: 'lte', v: '50' })).toEqual(['Mid', 'Small']);
    expect(await one({ f: 'employees', o: 'between', v: '10', v2: '50' })).toEqual(['Mid', 'Small']);
    expect(await one({ f: 'employees', o: 'between', v: '50', v2: '10' })).toEqual(['Mid', 'Small']); // extremos al revés
    expect(await one({ f: 'employees', o: 'known' })).toEqual(['Big', 'Mid', 'Small']);
    expect(await one({ f: 'employees', o: 'unknown' })).toEqual(['Unknown']);
    expect(await one({ f: 'custom:seats', o: 'gte', v: '20' })).toEqual(['Mid']);
    expect(await one({ f: 'custom:seats', o: 'between', v: '1', v2: '10' })).toEqual(['Small']);
    expect(await one({ f: 'custom:seats', o: 'unknown' })).toEqual(['Big', 'Unknown']);
    expect(await one({ f: 'contactCount', o: 'eq', v: '0' })).toEqual(['Big', 'Mid', 'Small', 'Unknown']);
  });

  it('select, owner (yo / sin asignar), tags, multiselect y sí/no', async () => {
    const owner = await makeUser('af-sel-owner');
    const rep = await makeUser('af-sel-rep');
    const team = await createTeam(owner.id, 'Sales');
    await addMember(team.id, rep.id, 'member');
    await createCustomField(owner.id, { entity: 'contacts', name: 'plan', label: 'Plan', type: 'select', options: ['free', 'pro'] });
    await createCustomField(owner.id, { entity: 'contacts', name: 'topics', label: 'Topics', type: 'multiselect', options: ['api', 'sales', 'ops'] });
    await createCustomField(owner.id, { entity: 'contacts', name: 'vip', label: 'VIP', type: 'boolean' });
    const a = await createContact(owner.id, { firstName: 'A', lifecycleStage: 'lead', ownerId: owner.id, custom: { plan: 'pro', topics: ['api', 'sales'], vip: true } });
    await createContact(owner.id, { firstName: 'B', lifecycleStage: 'customer', ownerId: rep.id, custom: { plan: 'free', topics: ['ops'], vip: false } });
    const c = await createContact(owner.id, { firstName: 'C', lifecycleStage: 'mql', custom: { topics: [] } });
    await getDb().prepare('UPDATE crm_contacts SET owner_id = NULL WHERE id = ?').run(c.id);
    const tag = await createTag(owner.id, { name: 'Hot' });
    if (!tag.ok) throw new Error(tag.error);
    await applyTag(owner.id, tag.tag.id, 'contact', [a.id], 'add');

    const customTypes = { plan: 'select' as const, topics: 'multiselect' as const, vip: 'boolean' as const };
    const as = (viewerId: string) => (rule: FilterCond) => names(owner.id, model([rule]), { customTypes, filterEnv: { viewerId } });
    const one = as(rep.id);

    expect(await one({ f: 'lifecycle', o: 'is', v: ['lead', 'mql'] })).toEqual(['A', 'C']);
    expect(await one({ f: 'lifecycle', o: 'isnot', v: ['lead', 'mql'] })).toEqual(['B']);
    expect(await one({ f: 'custom:plan', o: 'is', v: ['pro', 'free'] })).toEqual(['A', 'B']);
    expect(await one({ f: 'custom:plan', o: 'isnot', v: ['pro'] })).toEqual(['B', 'C']); // "ninguno de" incluye sin valor
    expect(await one({ f: 'custom:plan', o: 'unknown' })).toEqual(['C']);
    expect(await one({ f: 'custom:plan', o: 'known' })).toEqual(['A', 'B']);

    // Owner: "yo" es quien mira; "sin asignar" son los que no tienen owner.
    expect(await one({ f: 'owner', o: 'is', v: ['me'] })).toEqual(['B']);
    expect(await as(owner.id)({ f: 'owner', o: 'is', v: ['me'] })).toEqual(['A']);
    expect(await one({ f: 'owner', o: 'is', v: ['unassigned'] })).toEqual(['C']);
    expect(await one({ f: 'owner', o: 'is', v: ['me', 'unassigned'] })).toEqual(['B', 'C']);
    expect(await one({ f: 'owner', o: 'is', v: [owner.id, 'me'] })).toEqual(['A', 'B']);
    expect(await one({ f: 'owner', o: 'isnot', v: ['me'] })).toEqual(['A', 'C']);
    expect(await one({ f: 'owner', o: 'isnot', v: ['me', 'unassigned'] })).toEqual(['A']);
    expect(await one({ f: 'owner', o: 'isnot', v: ['unassigned'] })).toEqual(['A', 'B']);
    expect(await one({ f: 'owner', o: 'unknown' })).toEqual(['C']);
    expect(await one({ f: 'owner', o: 'known' })).toEqual(['A', 'B']);
    // Sin saber quién mira, "yo" no se puede resolver: la regla se rechaza.
    expect(compileRule(ctx, { f: 'owner', o: 'is', v: ['me'] })).toBeNull();

    expect(await one({ f: 'tag', o: 'is', v: [tag.tag.id] })).toEqual(['A']);
    expect(await one({ f: 'tag', o: 'isnot', v: [tag.tag.id] })).toEqual(['B', 'C']);
    expect(await one({ f: 'tag', o: 'known' })).toEqual(['A']);
    expect(await one({ f: 'tag', o: 'unknown' })).toEqual(['B', 'C']);

    expect(await one({ f: 'custom:topics', o: 'is', v: ['api', 'ops'] })).toEqual(['A', 'B']);
    expect(await one({ f: 'custom:topics', o: 'isnot', v: ['api'] })).toEqual(['B', 'C']);
    expect(await one({ f: 'custom:topics', o: 'all', v: ['api', 'sales'] })).toEqual(['A']);
    expect(await one({ f: 'custom:topics', o: 'all', v: ['api', 'ops'] })).toEqual([]);
    expect(await one({ f: 'custom:topics', o: 'known' })).toEqual(['A', 'B']);
    expect(await one({ f: 'custom:topics', o: 'unknown' })).toEqual(['C']); // lista vacía = sin valor

    expect(await one({ f: 'custom:vip', o: 'true' })).toEqual(['A']);
    expect(await one({ f: 'custom:vip', o: 'false' })).toEqual(['B']);
    expect(await one({ f: 'custom:vip', o: 'unknown' })).toEqual(['C']);
    expect(await one({ f: 'custom:vip', o: 'is', v: '1' })).toEqual(['A']); // forma vieja
    expect(await one({ f: 'hasOpenDeal', o: 'false' })).toEqual(['A', 'B', 'C']);
  });

  it('etapa y pipeline de un deal: cualquiera de / ninguno de', async () => {
    const u = await makeUser('af-stage');
    const p = await createPipeline(u.id, 'Sales');
    const s1 = (await createStage(u.id, p.id, { name: 'One' }))!;
    const s2 = (await createStage(u.id, p.id, { name: 'Two' }))!;
    const s3 = (await createStage(u.id, p.id, { name: 'Three' }))!;
    const co = await createCompany(u.id, { name: 'Norte Labs' });
    for (const [name, stageId, amount, companyId] of [['d1', s1.id, 100, co.id], ['d2', s2.id, 900, null], ['d3', s3.id, 5000, null]] as const) {
      const r = await createDeal(u.id, { name, pipelineId: p.id, stageId, amount, companyId });
      if (!r.ok) throw new Error(r.reason);
    }
    const one = async (rule: FilterCond) =>
      (await listDeals(u.id, { pipelineId: p.id, filters: model([rule]), pageSize: 100 })).rows.map((r) => r.name).sort();
    expect(await one({ f: 'stage', o: 'is', v: [s1.id, s3.id] })).toEqual(['d1', 'd3']);
    expect(await one({ f: 'stage', o: 'isnot', v: [s1.id, s3.id] })).toEqual(['d2']);
    expect(await one({ f: 'pipeline', o: 'is', v: [p.id] })).toEqual(['d1', 'd2', 'd3']);
    expect(await one({ f: 'pipeline', o: 'isnot', v: [p.id] })).toEqual([]);
    expect(await one({ f: 'amount', o: 'between', v: '500', v2: '5000' })).toEqual(['d2', 'd3']);
    expect(await one({ f: 'companyName', o: 'contains', v: ['norte'] })).toEqual(['d1']);
    expect(await one({ f: 'currency', o: 'is', v: ['USD'] })).toEqual(['d1', 'd2', 'd3']);
  });
});

describe('fechas: absolutas y relativas en la zona de quien mira', () => {
  const now = new Date('2026-03-15T02:30:00Z'); // domingo 15 en UTC; sábado 14, 23:30, en Buenos Aires
  const BA = 'America/Argentina/Buenos_Aires';
  const TOKYO = 'Asia/Tokyo';

  it('hoy, inicio del día y períodos se calculan en la zona pedida', () => {
    expect(todayIn('UTC', now)).toBe('2026-03-15');
    expect(todayIn(BA, now)).toBe('2026-03-14');
    expect(todayIn(TOKYO, now)).toBe('2026-03-15');
    expect(dayStartUtc('2026-03-14', BA)).toBe('2026-03-14 03:00:00');
    expect(dayStartUtc('2026-03-14', TOKYO)).toBe('2026-03-13 15:00:00');
    expect(dayStartUtc('2026-03-14', 'UTC')).toBe('2026-03-14 00:00:00');
    // Cambio de hora (Nueva York adelanta el 8 de marzo de 2026): la medianoche sigue siendo la local.
    expect(dayStartUtc('2026-03-08', 'America/New_York')).toBe('2026-03-08 05:00:00');
    expect(dayStartUtc('2026-03-09', 'America/New_York')).toBe('2026-03-09 04:00:00');
    expect(periodDays('this_week', '2026-03-14')).toEqual({ from: '2026-03-09', to: '2026-03-16' }); // lunes a lunes
    expect(periodDays('this_week', '2026-03-15')).toEqual({ from: '2026-03-09', to: '2026-03-16' }); // el domingo cierra la semana
    expect(periodDays('last_week', '2026-03-09')).toEqual({ from: '2026-03-02', to: '2026-03-09' });
    expect(periodDays('this_month', '2026-12-31')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
    expect(periodDays('last_month', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2026-01-01' });
    expect(periodDays('next_month', '2026-12-15')).toEqual({ from: '2027-01-01', to: '2027-02-01' });
    expect(periodDays('this_quarter', '2026-05-20')).toEqual({ from: '2026-04-01', to: '2026-07-01' });
    expect(periodDays('last_quarter', '2026-02-01')).toEqual({ from: '2025-10-01', to: '2026-01-01' });
    expect(periodDays('this_year', '2026-02-01')).toEqual({ from: '2026-01-01', to: '2027-01-01' });
    expect(periodDays('last_year', '2026-02-01')).toEqual({ from: '2025-01-01', to: '2026-01-01' });
    expect(periodDays('yesterday', '2026-03-01')).toEqual({ from: '2026-02-28', to: '2026-03-01' });
  });

  it('una columna con hora (created_at) corta el día a la medianoche de quien mira', async () => {
    const u = await makeUser('af-date');
    const stamps: Record<string, string> = {
      A: '2026-03-14 02:00:00', // BA: viernes 13, 23:00
      B: '2026-03-14 03:30:00', // BA: sábado 14, 00:30
      C: '2026-03-15 01:00:00', // BA: sábado 14, 22:00 · UTC: domingo 15
      D: '2026-03-09 03:00:00', // BA: lunes 9, 00:00
      E: '2026-03-09 02:59:59', // BA: domingo 8, 23:59 · UTC: lunes 9
      F: '2026-02-28 12:00:00',
      G: '2025-12-31 23:00:00', // BA: 31 dic 2025 · Tokio: 1 ene 2026
    };
    for (const [name, at] of Object.entries(stamps)) {
      const c = await createContact(u.id, { firstName: name });
      await getDb().prepare('UPDATE crm_contacts SET created_at = ? WHERE id = ?').run(at, c.id);
    }
    const inTz = (timeZone: string) => (rule: FilterCond) => names(u.id, model([rule]), { filterEnv: { timeZone, now } });
    const ba = inTz(BA);
    const utc = inTz('UTC');
    const tokyo = inTz(TOKYO);

    expect(await ba({ f: 'created', o: 'today' })).toEqual(['B', 'C']);
    expect(await utc({ f: 'created', o: 'today' })).toEqual(['C']);
    expect(await ba({ f: 'created', o: 'yesterday' })).toEqual(['A']);
    expect(await utc({ f: 'created', o: 'yesterday' })).toEqual(['A', 'B']);
    expect(await ba({ f: 'created', o: 'this_week' })).toEqual(['A', 'B', 'C', 'D']);
    expect(await utc({ f: 'created', o: 'this_week' })).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(await ba({ f: 'created', o: 'last_week' })).toEqual(['E']);
    expect(await ba({ f: 'created', o: 'this_month' })).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(await ba({ f: 'created', o: 'last_month' })).toEqual(['F']);
    expect(await ba({ f: 'created', o: 'this_quarter' })).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(await tokyo({ f: 'created', o: 'this_quarter' })).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(await ba({ f: 'created', o: 'last_quarter' })).toEqual(['G']);
    expect(await ba({ f: 'created', o: 'this_year' })).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(await tokyo({ f: 'created', o: 'this_year' })).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(await ba({ f: 'created', o: 'last_year' })).toEqual(['G']);
    expect(await tokyo({ f: 'created', o: 'last_year' })).toEqual([]);

    // Absolutas: el día es el de quien mira.
    expect(await ba({ f: 'created', o: 'on', v: '2026-03-14' })).toEqual(['B', 'C']);
    expect(await utc({ f: 'created', o: 'on', v: '2026-03-14' })).toEqual(['A', 'B']);
    expect(await ba({ f: 'created', o: 'before', v: '2026-03-14' })).toEqual(['A', 'D', 'E', 'F', 'G']);
    expect(await ba({ f: 'created', o: 'after', v: '2026-03-13' })).toEqual(['B', 'C']);
    expect(await ba({ f: 'created', o: 'between', v: '2026-03-09', v2: '2026-03-13' })).toEqual(['A', 'D']);
    expect(await ba({ f: 'created', o: 'between', v: '2026-03-13', v2: '2026-03-09' })).toEqual(['A', 'D']);

    // Relativas con N: "últimos N días" va por días de calendario (hoy y los N anteriores);
    // "hace menos / más de N días" cuenta desde este instante.
    expect(await ba({ f: 'created', o: 'last_days', v: '1' })).toEqual(['A', 'B', 'C']);
    expect(await ba({ f: 'created', o: 'last_days', v: '5' })).toEqual(['A', 'B', 'C', 'D']);
    expect(await ba({ f: 'created', o: 'less_days_ago', v: '1' })).toEqual(['B', 'C']);
    expect(await ba({ f: 'created', o: 'more_days_ago', v: '5' })).toEqual(['D', 'E', 'F', 'G']);
    expect(await ba({ f: 'created', o: 'more_days_ago', v: '6' })).toEqual(['F', 'G']);
    expect(await ba({ f: 'created', o: 'known' })).toHaveLength(7);
    expect(await ba({ f: 'created', o: 'unknown' })).toEqual([]);
  });

  it('una fecha sin hora (cierre de un deal, fecha propia) compara días; sin valor queda afuera', async () => {
    const u = await makeUser('af-day');
    const p = await createPipeline(u.id, 'Sales');
    const s = (await createStage(u.id, p.id, { name: 'Open' }))!;
    await createCustomField(u.id, { entity: 'deals', name: 'renewal', label: 'Renewal', type: 'date' });
    const dates: Array<[string, string | null]> = [['d13', '2026-03-13'], ['d14', '2026-03-14'], ['d15', '2026-03-15'], ['d21', '2026-03-21'], ['d22', '2026-03-22'], ['none', null]];
    for (const [name, closeDate] of dates) {
      const r = await createDeal(u.id, { name, pipelineId: p.id, stageId: s.id, closeDate, custom: closeDate ? { renewal: closeDate } : {} });
      if (!r.ok) throw new Error(r.reason);
    }
    const customTypes = { renewal: 'date' as const };
    const inTz = (timeZone: string) => async (rule: FilterCond) =>
      (await listDeals(u.id, { pipelineId: p.id, filters: model([rule]), customTypes, filterEnv: { timeZone, now }, pageSize: 100 })).rows
        .map((r) => r.name)
        .sort();
    const ba = inTz(BA);
    const tokyo = inTz(TOKYO);
    expect(await ba({ f: 'closeDate', o: 'today' })).toEqual(['d14']);
    expect(await tokyo({ f: 'closeDate', o: 'today' })).toEqual(['d15']);
    expect(await ba({ f: 'closeDate', o: 'next_days', v: '7' })).toEqual(['d14', 'd15', 'd21']);
    expect(await tokyo({ f: 'closeDate', o: 'next_days', v: '7' })).toEqual(['d15', 'd21', 'd22']);
    expect(await ba({ f: 'closeDate', o: 'next_week' })).toEqual(['d21', 'd22']);
    expect(await ba({ f: 'closeDate', o: 'before', v: '2026-03-14' })).toEqual(['d13']); // sin fecha no es "antes"
    expect(await ba({ f: 'closeDate', o: 'after', v: '2026-03-15' })).toEqual(['d21', 'd22']);
    expect(await ba({ f: 'closeDate', o: 'on', v: '2026-03-21' })).toEqual(['d21']);
    expect(await ba({ f: 'closeDate', o: 'between', v: '2026-03-14', v2: '2026-03-21' })).toEqual(['d14', 'd15', 'd21']);
    expect(await ba({ f: 'closeDate', o: 'less_days_ago', v: '1' })).toEqual(['d14']);
    expect(await ba({ f: 'closeDate', o: 'more_days_ago', v: '1' })).toEqual([]);
    expect(await tokyo({ f: 'closeDate', o: 'more_days_ago', v: '1' })).toEqual(['d13']);
    expect(await ba({ f: 'closeDate', o: 'unknown' })).toEqual(['none']);
    expect(await ba({ f: 'closeDate', o: 'known' })).toHaveLength(5);
    expect(await ba({ f: 'custom:renewal', o: 'this_month' })).toEqual(['d13', 'd14', 'd15', 'd21', 'd22']);
    expect(await ba({ f: 'custom:renewal', o: 'on', v: '2026-03-22' })).toEqual(['d22']);
    expect(await ba({ f: 'custom:renewal', o: 'unknown' })).toEqual(['none']);
  });
});

describe('grupos: Y dentro del grupo, O entre grupos', () => {
  it('combina y la lista plana vieja sigue funcionando (todas o cualquiera)', async () => {
    const u = await makeUser('af-groups');
    await createContact(u.id, { firstName: 'LimaLead', city: 'Lima', lifecycleStage: 'lead' });
    await createContact(u.id, { firstName: 'LimaCustomer', city: 'Lima', lifecycleStage: 'customer' });
    await createContact(u.id, { firstName: 'QuitoLead', city: 'Quito', lifecycleStage: 'lead' });
    await createContact(u.id, { firstName: 'QuitoCustomer', city: 'Quito', lifecycleStage: 'customer' });
    const lima: FilterCond = { f: 'city', o: 'equals', v: ['Lima'] };
    const quito: FilterCond = { f: 'city', o: 'equals', v: ['Quito'] };
    const lead: FilterCond = { f: 'lifecycle', o: 'is', v: ['lead'] };
    const customer: FilterCond = { f: 'lifecycle', o: 'is', v: ['customer'] };

    expect(await names(u.id, model([lima, lead]))).toEqual(['LimaLead']);
    expect(await names(u.id, model([lima], [lead]))).toEqual(['LimaCustomer', 'LimaLead', 'QuitoLead']);
    expect(await names(u.id, model([lima, lead], [quito, customer]))).toEqual(['LimaLead', 'QuitoCustomer']);
    expect(await names(u.id, model([lima, quito]))).toEqual([]);
    // El filtro avanzado se cruza con los filtros rápidos de la URL, no los reemplaza.
    expect(await names(u.id, model([lima], [quito]), { lifecycle: 'lead' })).toEqual(['LimaLead', 'QuitoLead']);
    expect(await names(u.id, model([lima], [quito]), { q: 'Customer' })).toEqual(['LimaCustomer', 'QuitoCustomer']);

    // Lista plana (links viejos, listas dinámicas): todas por defecto, cualquiera con filtersMatch.
    const flat = [{ f: 'city', o: 'equals', v: 'Lima' }, { f: 'lifecycle', o: 'is', v: 'lead' }];
    expect((await listContacts(u.id, { filters: flat })).rows.map((r) => r.first_name)).toEqual(['LimaLead']);
    expect((await listContacts(u.id, { filters: flat, filtersMatch: 'any' })).total).toBe(3);
    expect((await listContacts(u.id, { filters: parseFilterModel(JSON.stringify(flat)) })).total).toBe(1);
  });
});

describe('visibilidad y workspace: un grupo O nunca ensancha lo que se ve', () => {
  async function workspace() {
    const owner = await makeUser('af-vis-owner');
    const m1 = await makeUser('af-vis-m1');
    const m2 = await makeUser('af-vis-m2');
    const team = await createTeam(owner.id, 'Sales');
    await addMember(team.id, m1.id, 'member');
    await addMember(team.id, m2.id, 'member');
    const mine = await createContact(owner.id, { firstName: 'Mine', city: 'Lima', ownerId: m1.id });
    const mine2 = await createContact(owner.id, { firstName: 'MineToo', city: 'Quito', ownerId: m1.id });
    const theirs = await createContact(owner.id, { firstName: 'Theirs', city: 'Lima', ownerId: m2.id });
    const bosss = await createContact(owner.id, { firstName: 'Boss', city: 'Quito', ownerId: owner.id });
    const other = await makeUser('af-vis-other');
    const foreign = await createContact(other.id, { firstName: 'Foreign', city: 'Lima' });
    await setMemberVisibility(owner.id, 'mine');
    return { owner, m1, m2, other, mine, mine2, theirs, bosss, foreign };
  }

  // Filtros que, si el O se colara por fuera de la visibilidad, traerían todo el workspace (o más).
  const wideOpen = (m2: string, ownerId: string): FilterModel[] => [
    model([{ f: 'city', o: 'equals', v: ['Lima'] }], [{ f: 'city', o: 'equals', v: ['Quito'] }]),
    model([{ f: 'owner', o: 'is', v: [m2] }], [{ f: 'owner', o: 'is', v: [ownerId] }], [{ f: 'owner', o: 'isnot', v: ['me'] }]),
    model([{ f: 'city', o: 'known' }], [{ f: 'city', o: 'unknown' }]),
    model([{ f: 'owner', o: 'known' }], [{ f: 'owner', o: 'unknown' }], [{ f: 'email', o: 'not_contains', v: ['zzz'] }]),
    model([{ f: 'created', o: 'this_year' }], [{ f: 'created', o: 'more_days_ago', v: '1' }], [{ f: 'created', o: 'known' }]),
  ];

  it('listContacts y exportRows: un member con visibilidad "mine" solo recibe lo suyo, con cualquier O', async () => {
    const w = await workspace();
    const scope = await ownerScopeFor({ workspaceId: w.owner.id, personId: w.m1.id, role: 'member' });
    expect(scope).toEqual([w.m1.id]);
    const own = [w.mine.id, w.mine2.id].sort();
    for (const m of wideOpen(w.m2.id, w.owner.id)) {
      const res = await listContacts(w.owner.id, { filters: m, ownerScope: scope, filterEnv: { viewerId: w.m1.id }, pageSize: 100 });
      for (const row of res.rows) expect(own).toContain(row.id);
      expect(res.total).toBe(res.rows.length);
      const exported = await exportRows(w.owner.id, 'contacts', scope, { model: m, env: { viewerId: w.m1.id } });
      for (const row of exported) expect(own).toContain(row.id);
    }
    // El primer filtro sí trae sus dos contactos (el O funciona dentro de lo visible).
    const both = await listContacts(w.owner.id, { filters: wideOpen(w.m2.id, w.owner.id)[0], ownerScope: scope });
    expect(both.rows.map((r) => r.id).sort()).toEqual(own);
    // Pedir los registros de otra persona no devuelve nada.
    const others = await listContacts(w.owner.id, { filters: model([{ f: 'owner', o: 'is', v: [w.m2.id] }]), ownerScope: scope });
    expect(others.total).toBe(0);
    // Sin restricción, el owner ve los cuatro del workspace y nunca el ajeno.
    const all = await listContacts(w.owner.id, { filters: wideOpen(w.m2.id, w.owner.id)[0], pageSize: 100 });
    expect(all.rows.map((r) => r.first_name).sort()).toEqual(['Boss', 'Mine', 'MineToo', 'Theirs']);
  });

  it('otro workspace nunca entra, ni con un O que lo nombre', async () => {
    const w = await workspace();
    for (const m of [
      model([{ f: 'city', o: 'equals', v: ['Lima'] }], [{ f: 'name', o: 'contains', v: ['Foreign'] }]),
      model([{ f: 'owner', o: 'unknown' }], [{ f: 'owner', o: 'known' }]),
      model([{ f: 'owner', o: 'is', v: [w.other.id] }]),
    ]) {
      const mineRows = await listContacts(w.owner.id, { filters: m, pageSize: 100 });
      expect(mineRows.rows.some((r) => r.id === w.foreign.id)).toBe(false);
      expect(mineRows.rows.every((r) => r.user_id === w.owner.id)).toBe(true);
      const theirs = await listContacts(w.other.id, { filters: m, pageSize: 100 });
      expect(theirs.rows.every((r) => r.user_id === w.other.id)).toBe(true);
      expect((await exportRows(w.other.id, 'contacts', null, { model: m })).every((r) => r.user_id === w.other.id)).toBe(true);
    }
    const stranger = await makeUser('af-vis-empty');
    expect((await listContacts(stranger.id, { filters: model([{ f: 'city', o: 'known' }], [{ f: 'city', o: 'unknown' }]) })).total).toBe(0);
  });

  it('rutas: sesión, API v1 y export aplican el filtro dentro de la visibilidad y rechazan uno inválido', async () => {
    const w = await workspace();
    const wide = wideOpen(w.m2.id, w.owner.id)[0];
    const own = [w.mine.id, w.mine2.id].sort();

    actAs(w.owner, w.m1, 'member');
    const asMember = (await (await contactsRoute.GET(nextReq(`http://x/api/crm/contacts?filters=${q(wide)}`))).json()) as {
      rows: Array<{ id: string }>;
      total: number;
    };
    expect(asMember.rows.map((r) => r.id).sort()).toEqual(own);
    expect(asMember.total).toBe(2);
    const meOnly = (await (
      await contactsRoute.GET(nextReq(`http://x/api/crm/contacts?filters=${q(model([{ f: 'owner', o: 'is', v: ['me'] }, { f: 'city', o: 'equals', v: ['lima'] }]))}`))
    ).json()) as { rows: Array<{ id: string }> };
    expect(meOnly.rows.map((r) => r.id)).toEqual([w.mine.id]);
    // Links viejos: la lista plana sigue valiendo.
    const legacy = (await (
      await contactsRoute.GET(nextReq(`http://x/api/crm/contacts?filters=${q([{ f: 'city', o: 'equals', v: 'Quito' }])}`))
    ).json()) as { rows: Array<{ id: string }> };
    expect(legacy.rows.map((r) => r.id)).toEqual([w.mine2.id]);
    for (const bad of ['not json', q(model([{ f: 'nope', o: 'known' }])), q(model([{ f: 'email', o: 'gt', v: '1' }])), q(model([{ f: "custom:x') OR 1=1 --", o: 'known' }]))]) {
      const res = await contactsRoute.GET(nextReq(`http://x/api/crm/contacts?filters=${bad}`));
      expect(res.status, bad).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('invalid_filter');
    }

    // API v1 con la key de un member.
    const memberKey = (await createApiKey(w.owner.id, 'm1', w.m1.id)).key;
    const v1 = (await (await v1Contacts.GET(nextReq(`http://x/api/v1/crm/contacts?filters=${q(wide)}`, memberKey))).json()) as {
      contacts: Array<{ id: string }>;
      total: number;
    };
    expect(v1.contacts.map((c) => c.id).sort()).toEqual(own);
    expect(v1.total).toBe(2);
    const v1Bad = await v1Contacts.GET(nextReq(`http://x/api/v1/crm/contacts?filters=${q(model([{ f: 'nope', o: 'known' }]))}`, memberKey));
    expect(v1Bad.status).toBe(400);
    expect(((await v1Bad.json()) as { error: { code: string } }).error.code).toBe('invalid_filter');
    expect((await v1Companies.GET(nextReq(`http://x/api/v1/crm/companies?filters=${q(model([{ f: 'name', o: 'known' }]))}`, memberKey))).status).toBe(200);
    expect((await v1Companies.GET(nextReq(`http://x/api/v1/crm/companies?filters=${q(model([{ f: 'email', o: 'known' }]))}`, memberKey))).status).toBe(400);
    expect((await v1Deals.GET(nextReq(`http://x/api/v1/crm/deals?filters=${q(model([{ f: 'amount', o: 'gte', v: '1' }]))}`, memberKey))).status).toBe(200);
    // `tz` fija la zona de las fechas relativas.
    const tz = await v1Contacts.GET(nextReq(`http://x/api/v1/crm/contacts?tz=America/Lima&filters=${q(model([{ f: 'created', o: 'today' }]))}`, memberKey));
    expect(((await tz.json()) as { total: number }).total).toBe(2);

    // Export (solo admin): con filtro exporta lo que cumple; uno inválido es 400 y no un export completo.
    actAs(w.owner, w.owner, 'owner');
    const csv = await (await exportRoute.GET(nextReq(`http://x/api/crm/export?entity=contacts&format=json&filters=${q(model([{ f: 'city', o: 'equals', v: ['Lima'] }]))}`))).json();
    expect((csv as Array<{ first_name: string }>).map((r) => r.first_name).sort()).toEqual(['Mine', 'Theirs']);
    expect((await exportRoute.GET(nextReq(`http://x/api/crm/export?entity=contacts&format=json&filters=${q(model([{ f: 'nope', o: 'known' }]))}`))).status).toBe(400);
    const full = await (await exportRoute.GET(nextReq('http://x/api/crm/export?entity=contacts&format=json'))).json();
    expect(full as unknown[]).toHaveLength(4);
  });

  it('empresas y deals: un member con "mine" y grupos O solo recibe lo suyo (lista, sesión, API v1 y export)', async () => {
    const w = await workspace();
    const scope = await ownerScopeFor({ workspaceId: w.owner.id, personId: w.m1.id, role: 'member' });
    const coMine = await createCompany(w.owner.id, { name: 'Alpha Mine', city: 'Lima', ownerId: w.m1.id });
    const coTheirs = await createCompany(w.owner.id, { name: 'Alpha Theirs', city: 'Lima', ownerId: w.m2.id });
    const coBoss = await createCompany(w.owner.id, { name: 'Beta Boss', city: 'Quito', ownerId: w.owner.id });
    await createCompany(w.other.id, { name: 'Alpha Foreign', city: 'Lima' });
    const p = await createPipeline(w.owner.id, 'Sales');
    const st = (await createStage(w.owner.id, p.id, { name: 'Open' }))!;
    const deal = async (name: string, ownerId: string, amount: number) => {
      const r = await createDeal(w.owner.id, { name, pipelineId: p.id, stageId: st.id, amount, ownerId });
      if (!r.ok) throw new Error(r.reason);
      return r.deal;
    };
    const dMine = await deal('Mine deal', w.m1.id, 10);
    await deal('Theirs deal', w.m2.id, 5000);
    await deal('Boss deal', w.owner.id, 9000);

    const companyModels = [
      model([{ f: 'city', o: 'equals', v: ['Lima'] }], [{ f: 'city', o: 'equals', v: ['Quito'] }]),
      model([{ f: 'owner', o: 'is', v: [w.m2.id] }], [{ f: 'owner', o: 'isnot', v: ['me'] }], [{ f: 'name', o: 'known' }]),
      model([{ f: 'name', o: 'contains', v: ['Alpha', 'Beta'] }], [{ f: 'owner', o: 'unknown' }]),
    ];
    for (const m of companyModels) {
      const res = await listCompanies(w.owner.id, { filters: m, ownerScope: scope, filterEnv: { viewerId: w.m1.id }, pageSize: 100 });
      expect(res.rows.map((r) => r.id).every((id) => id === coMine.id), JSON.stringify(m)).toBe(true);
      expect(res.total).toBe(res.rows.length);
      const exported = await exportRows(w.owner.id, 'companies', scope, { model: m, env: { viewerId: w.m1.id } });
      expect(exported.every((r) => r.id === coMine.id)).toBe(true);
    }
    expect((await listCompanies(w.owner.id, { filters: companyModels[0], ownerScope: scope })).rows.map((r) => r.id)).toEqual([coMine.id]);
    // El owner ve las tres del workspace (nunca la ajena).
    const all = await listCompanies(w.owner.id, { filters: companyModels[0], pageSize: 100 });
    expect(all.rows.map((r) => r.id).sort()).toEqual([coMine.id, coTheirs.id, coBoss.id].sort());

    const dealModels = [
      model([{ f: 'amount', o: 'gte', v: '1000' }], [{ f: 'amount', o: 'lt', v: '1000' }]),
      model([{ f: 'owner', o: 'is', v: [w.m2.id, w.owner.id] }], [{ f: 'stage', o: 'is', v: [st.id] }]),
      model([{ f: 'name', o: 'known' }], [{ f: 'name', o: 'unknown' }]),
    ];
    for (const m of dealModels) {
      const res = await listDeals(w.owner.id, { pipelineId: p.id, filters: m, ownerScope: scope, filterEnv: { viewerId: w.m1.id }, pageSize: 100 });
      expect(res.rows.map((r) => r.id), JSON.stringify(m)).toEqual([dMine.id]);
      expect(res.total).toBe(1);
      const exported = await exportRows(w.owner.id, 'deals', scope, { model: m, env: { viewerId: w.m1.id } });
      expect(exported.every((r) => r.id === dMine.id)).toBe(true);
    }

    // Las rutas de la sesión, como el member.
    actAs(w.owner, w.m1, 'member');
    const coRes = (await (await companiesRoute.GET(nextReq(`http://x/api/crm/companies?filters=${q(companyModels[1])}`))).json()) as {
      rows: Array<{ id: string }>;
    };
    expect(coRes.rows.map((r) => r.id)).toEqual([coMine.id]);
    const dRes = (await (await dealsRoute.GET(nextReq(`http://x/api/crm/deals?pipelineId=${p.id}&filters=${q(dealModels[0])}`))).json()) as {
      rows: Array<{ id: string }>;
    };
    expect(dRes.rows.map((r) => r.id)).toEqual([dMine.id]);
    // API v1 con la key del member.
    const key = (await createApiKey(w.owner.id, 'm1', w.m1.id)).key;
    const v1co = (await (await v1Companies.GET(nextReq(`http://x/api/v1/crm/companies?filters=${q(companyModels[0])}`, key))).json()) as {
      companies: Array<{ id: string }>;
    };
    expect(v1co.companies.map((c) => c.id)).toEqual([coMine.id]);
    const v1d = (await (await v1Deals.GET(nextReq(`http://x/api/v1/crm/deals?pipelineId=${p.id}&filters=${q(dealModels[1])}`, key))).json()) as {
      deals: Array<{ id: string }>;
    };
    expect(v1d.deals.map((d) => d.id)).toEqual([dMine.id]);
  });

  it('una propiedad propia oculta para members no se puede usar como filtro (ni para sondear su valor)', async () => {
    const w = await workspace();
    const field = await createCustomField(w.owner.id, { entity: 'contacts', name: 'margin', label: 'Margin', type: 'number' });
    await getDb().prepare("UPDATE crm_contacts SET custom = json_set(custom, '$.margin', 40) WHERE id = ?").run(w.mine.id);
    expect(await setFieldPermissions(w.owner.id, field.id, [{ subject: 'role:member', access: 'hidden' }])).toBe(true);
    const probe = q(model([{ f: 'custom:margin', o: 'gt', v: '10' }]));

    actAs(w.owner, w.m1, 'member');
    expect((await contactsRoute.GET(nextReq(`http://x/api/crm/contacts?filters=${probe}`))).status).toBe(400);
    const memberKey = (await createApiKey(w.owner.id, 'm1', w.m1.id)).key;
    expect((await v1Contacts.GET(nextReq(`http://x/api/v1/crm/contacts?filters=${probe}`, memberKey))).status).toBe(400);

    actAs(w.owner, w.owner, 'owner');
    const asOwner = (await (await contactsRoute.GET(nextReq(`http://x/api/crm/contacts?filters=${probe}`))).json()) as { rows: Array<{ id: string }> };
    expect(asOwner.rows.map((r) => r.id)).toEqual([w.mine.id]);
  });
});

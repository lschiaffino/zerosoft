import { beforeEach, describe, expect, it } from 'vitest';
import { FakeHubspotPortal, SYNC_PORTAL_ID, fakeHubspotPortal, resetFakeHubspotPortal, seedSyncPortal } from '@/lib/hubspot/fake-portal';
import { fakeHubspot, resetFakeHubspot } from '@/lib/groups-hubspot-fake';
import { fakeDatasetFromToken, fakeImportPortal, isFakeToken } from '@/lib/crm-import-fake';

/**
 * La cuenta falsa de HubSpot (lib/hubspot/fake-portal.ts): cada cosa que
 * promete tiene acá su prueba, para que los tests de un sync puedan confiar
 * en ella. Datos inventados; nada sale a internet.
 */

const TOKEN = 'pat-na1-fake-portal-test';
const API = 'https://api.hubapi.com';

let portal: FakeHubspotPortal;
beforeEach(() => {
  portal = seedSyncPortal();
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(method: string, path: string, body?: unknown, token = TOKEN, on: FakeHubspotPortal = portal): Promise<{ status: number; json: Json; headers: Headers }> {
  const res = await on.fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}` }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Json) : {}, headers: res.headers };
}
const ids = (r: { json: Json }) => (r.json.results as Array<{ id: string }>).map((x) => x.id);

describe('objetos y fechas de modificación', () => {
  it('contactos, empresas y negocios traen sus propiedades, id, alta y última modificación', async () => {
    const c = await call('GET', '/crm/v3/objects/contacts/4001?properties=email,firstname,lastmodifieddate,hs_lastmodifieddate,hs_object_id,createdate');
    expect(c.status).toBe(200);
    expect(c.json.properties).toMatchObject({ email: 'mara@northwind-parts.example', firstname: 'Mara', hs_object_id: '4001' });
    expect(Date.parse(c.json.properties.lastmodifieddate)).toBeGreaterThan(0);
    expect(c.json.properties.hs_lastmodifieddate).toBe(c.json.properties.lastmodifieddate);
    expect(c.json).toMatchObject({ id: '4001', archived: false });
    const co = await call('GET', '/crm/v3/objects/companies/3001?properties=name,hs_lastmodifieddate,lastmodifieddate');
    expect(co.json.properties.name).toBe('Northwind Parts');
    expect(Date.parse(co.json.properties.hs_lastmodifieddate)).toBeGreaterThan(0);
    // Empresas y negocios no tienen `lastmodifieddate`: esa es de los contactos.
    expect(co.json.properties.lastmodifieddate).toBeUndefined();
    const d = await call('GET', '/crm/v3/objects/deals/6001?properties=dealname,amount,dealstage,hs_lastmodifieddate');
    expect(d.json.properties).toMatchObject({ dealname: 'Northwind annual plan', amount: '18000', dealstage: 'contractsent' });
  });

  it('cada cambio mueve la fecha de modificación hacia adelante, también el hecho "desde HubSpot"', async () => {
    const before = portal.contacts.get('4001')!.properties.lastmodifieddate;
    const at = portal.edit('contacts', '4001', { jobtitle: 'Buyer' });
    expect(Date.parse(at)).toBeGreaterThan(Date.parse(before));
    const patched = await call('PATCH', '/crm/v3/objects/contacts/4001', { properties: { jobtitle: 'Head of purchasing' } });
    expect(patched.status).toBe(200);
    expect(Date.parse(patched.json.updatedAt)).toBeGreaterThan(Date.parse(at));
    expect(portal.contacts.get('4001')!.properties).toMatchObject({ jobtitle: 'Head of purchasing', lastmodifieddate: patched.json.updatedAt });
  });

  it('listar pagina con cursor y pide solo las propiedades indicadas', async () => {
    for (let i = 0; i < 5; i++) portal.add('companies', { name: `Extra ${i}` });
    const first = await call('GET', '/crm/v3/objects/companies?limit=3&properties=name');
    expect(first.json.results).toHaveLength(3);
    expect(Object.keys(first.json.results[0].properties)).toEqual(['name']);
    const after = first.json.paging.next.after as string;
    const second = await call('GET', `/crm/v3/objects/companies?limit=3&properties=name&after=${after}`);
    const third = await call('GET', `/crm/v3/objects/companies?limit=3&properties=name&after=${second.json.paging.next.after}`);
    expect(third.json.paging).toBeUndefined();
    const all = [...ids(first), ...ids(second), ...ids(third)];
    expect(all).toHaveLength(8);
    expect(new Set(all).size).toBe(8);
    // Un registro que aparece mientras se pagina no hace repetir ni saltear los anteriores.
    portal.add('companies', { name: 'Late arrival' });
    expect(ids(await call('GET', `/crm/v3/objects/companies?limit=3&after=${after}`))).toEqual(ids(second));
  });

  it('un valor que la propiedad no acepta es un 400 con el motivo, y no se guarda', async () => {
    const bad = await call('PATCH', '/crm/v3/objects/companies/3001', { properties: { segment: 'galactic', numberofemployees: 'many' } });
    expect(bad.status).toBe(400);
    expect(bad.json.category).toBe('VALIDATION_ERROR');
    expect(bad.json.message).toContain('INVALID_OPTION');
    expect(bad.json.message).toContain('INVALID_INTEGER');
    expect(portal.companies.get('3001')!.properties.segment).toBe('mid');
    expect((await call('PATCH', '/crm/v3/objects/companies/3001', { properties: { hs_object_id: '1' } })).json.message).toContain('READ_ONLY_VALUE');
    expect((await call('PATCH', '/crm/v3/objects/companies/3001', { properties: { nope: 'x' } })).json.message).toContain('PROPERTY_DOESNT_EXIST');
  });
});

describe('búsqueda', () => {
  it('filtra con operadores, combina grupos con O y filtros con Y', async () => {
    const eq = await call('POST', '/crm/v3/objects/contacts/search', { filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: 'JOEL@tallgrass-labs.example' }] }], properties: ['email'] });
    expect(ids(eq)).toEqual(['4002']);
    const noEmail = await call('POST', '/crm/v3/objects/contacts/search', { filterGroups: [{ filters: [{ propertyName: 'email', operator: 'NOT_HAS_PROPERTY' }] }] });
    expect(ids(noEmail)).toEqual(['4003']);
    const either = await call('POST', '/crm/v3/objects/contacts/search', {
      filterGroups: [{ filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' }] }, { filters: [{ propertyName: 'preferred_language', operator: 'IN', values: ['pt'] }] }],
    });
    expect(ids(either).sort()).toEqual(['4001', '4003']);
    const both = await call('POST', '/crm/v3/objects/deals/search', {
      filterGroups: [{ filters: [{ propertyName: 'amount', operator: 'GTE', value: '2000' }, { propertyName: 'amount', operator: 'LT', value: '10000' }] }],
    });
    expect(ids(both)).toEqual(['6002']);
    const between = await call('POST', '/crm/v3/objects/deals/search', { filterGroups: [{ filters: [{ propertyName: 'amount', operator: 'BETWEEN', value: '10000', highValue: '20000' }] }] });
    expect(ids(between)).toEqual(['6001']);
    const byId = await call('POST', '/crm/v3/objects/companies/search', { filterGroups: [{ filters: [{ propertyName: 'hs_object_id', operator: 'IN', values: ['3001', '3003'] }] }] });
    expect(ids(byId)).toEqual(['3001', '3003']);
    const text = await call('POST', '/crm/v3/objects/companies/search', { query: 'tallgrass labs' });
    expect(ids(text)).toEqual(['3002', '3003']);
  });

  it('ordena ascendente por la fecha de modificación y lo cambiado después de una fecha sale con GT', async () => {
    portal.edit('contacts', '4002', { jobtitle: 'CTO' });
    const mark = portal.edit('contacts', '4001', { jobtitle: 'COO' });
    portal.edit('contacts', '4003', { jobtitle: 'CFO' });
    const sorted = await call('POST', '/crm/v3/objects/contacts/search', { sorts: [{ propertyName: 'lastmodifieddate', direction: 'ASCENDING' }], properties: ['lastmodifieddate'] });
    expect(ids(sorted)).toEqual(['4002', '4001', '4003']);
    const since = await call('POST', '/crm/v3/objects/contacts/search', {
      filterGroups: [{ filters: [{ propertyName: 'lastmodifieddate', operator: 'GT', value: String(Date.parse(mark)) }] }],
      sorts: [{ propertyName: 'lastmodifieddate', direction: 'ASCENDING' }],
    });
    expect(ids(since)).toEqual(['4003']);
    const desc = await call('POST', '/crm/v3/objects/contacts/search', { sorts: [{ propertyName: 'lastmodifieddate', direction: 'DESCENDING' }] });
    expect(ids(desc)).toEqual(['4003', '4001', '4002']);
  });

  it('pagina con `after` y da el total', async () => {
    for (let i = 0; i < 7; i++) portal.add('deals', { dealname: `Bulk ${i}`, amount: String(i) });
    const p1 = await call('POST', '/crm/v3/objects/deals/search', { limit: 4, sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }] });
    expect(p1.json.total).toBe(9);
    expect(p1.json.results).toHaveLength(4);
    const p2 = await call('POST', '/crm/v3/objects/deals/search', { limit: 4, after: p1.json.paging.next.after, sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }] });
    const p3 = await call('POST', '/crm/v3/objects/deals/search', { limit: 4, after: p2.json.paging.next.after, sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }] });
    expect(p3.json.paging).toBeUndefined();
    expect(new Set([...ids(p1), ...ids(p2), ...ids(p3)]).size).toBe(9);
  });

  it('el tope de resultados: pasado el tope responde 400 aunque el total sea mayor', async () => {
    portal.searchCap = 5;
    for (let i = 0; i < 6; i++) portal.add('deals', { dealname: `Many ${i}` });
    const p1 = await call('POST', '/crm/v3/objects/deals/search', { limit: 3 });
    expect(p1.json.total).toBe(8);
    const p2 = await call('POST', '/crm/v3/objects/deals/search', { limit: 3, after: p1.json.paging.next.after });
    // La segunda página se corta en el tope y aun así ofrece una siguiente, como HubSpot.
    expect(p2.json.results).toHaveLength(2);
    expect(p2.json.paging.next.after).toBe('6');
    const p3 = await call('POST', '/crm/v3/objects/deals/search', { limit: 3, after: p2.json.paging.next.after });
    expect(p3.status).toBe(400);
    expect(p3.json.category).toBe('VALIDATION_ERROR');
    // El tope real es 10.000.
    expect(seedSyncPortal().searchCap).toBe(10_000);
  });

  it('rechaza más filtros de los que acepta HubSpot', async () => {
    const filter = { propertyName: 'amount', operator: 'GT', value: '1' };
    expect((await call('POST', '/crm/v3/objects/deals/search', { filterGroups: Array.from({ length: 6 }, () => ({ filters: [filter] })) })).status).toBe(400);
    expect((await call('POST', '/crm/v3/objects/deals/search', { filterGroups: [{ filters: Array.from({ length: 7 }, () => filter) }] })).status).toBe(400);
    expect((await call('POST', '/crm/v3/objects/deals/search', { filterGroups: Array.from({ length: 5 }, () => ({ filters: [filter] })) })).status).toBe(200);
  });
});

describe('lotes', () => {
  it('batch read: lo pedido sin valor vuelve null y lo que no existe va a errores (207)', async () => {
    const ok = await call('POST', '/crm/v3/objects/contacts/batch/read', { inputs: [{ id: '4001' }, { id: '4003' }], properties: ['email', 'firstname'] });
    expect(ok.status).toBe(200);
    expect(ok.json.results).toEqual([
      expect.objectContaining({ id: '4001', properties: { email: 'mara@northwind-parts.example', firstname: 'Mara' } }),
      expect.objectContaining({ id: '4003', properties: { email: null, firstname: 'Bia' } }),
    ]);
    const partial = await call('POST', '/crm/v3/objects/contacts/batch/read', { inputs: [{ id: '4001' }, { id: '999' }], properties: ['email'] });
    expect(partial.status).toBe(207);
    expect(ids(partial)).toEqual(['4001']);
    expect(partial.json.errors[0].context.ids).toEqual(['999']);
    const byEmail = await call('POST', '/crm/v3/objects/contacts/batch/read', { idProperty: 'email', inputs: [{ id: 'joel@tallgrass-labs.example' }], properties: ['firstname'] });
    expect(ids(byEmail)).toEqual(['4002']);
    expect((await call('POST', '/crm/v3/objects/contacts/batch/read', { inputs: Array.from({ length: 101 }, (_, i) => ({ id: String(i) })) })).status).toBe(400);
  });

  it('batch update cambia varios y mueve sus fechas; un valor inválido rechaza todo el lote', async () => {
    const res = await call('POST', '/crm/v3/objects/deals/batch/update', { inputs: [{ id: '6001', properties: { amount: '19000' } }, { id: '6002', properties: { dealstage: 'contractsent' } }] });
    expect(res.status).toBe(200);
    expect(portal.deals.get('6001')!.properties.amount).toBe('19000');
    expect(portal.deals.get('6002')!.properties.dealstage).toBe('contractsent');
    expect(res.json.results[0].updatedAt).toBe(portal.deals.get('6001')!.properties.hs_lastmodifieddate);
    const bad = await call('POST', '/crm/v3/objects/deals/batch/update', { inputs: [{ id: '6001', properties: { amount: '1' } }, { id: '6002', properties: { dealstage: 'nowhere' } }] });
    expect(bad.status).toBe(400);
    expect(portal.deals.get('6001')!.properties.amount).toBe('19000');
    const partial = await call('POST', '/crm/v3/objects/deals/batch/update', { inputs: [{ id: '6001', properties: { amount: '5' } }, { id: '404404', properties: { amount: '5' } }] });
    expect(partial.status).toBe(207);
    expect(partial.json.errors[0].context.ids).toEqual(['404404']);
  });

  it('batch upsert de contactos por email: actualiza el que existe y crea el que no', async () => {
    const res = await call('POST', '/crm/v3/objects/contacts/batch/upsert', {
      inputs: [
        { idProperty: 'email', id: 'MARA@northwind-parts.example', properties: { jobtitle: 'Director' } },
        { idProperty: 'email', id: 'new.person@northwind-parts.example', properties: { firstname: 'Nuria' } },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.json.results.map((r: Json) => [r.id === '4001', r.new])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(portal.contacts.get('4001')!.properties.jobtitle).toBe('Director');
    const created = portal.contacts.get(res.json.results[1].id)!;
    expect(created.properties).toMatchObject({ email: 'new.person@northwind-parts.example', firstname: 'Nuria' });
    expect(created.properties.lastmodifieddate).toBeTruthy();
    expect(portal.contacts.size).toBe(4);
    // El upsert solo va por una propiedad de valor único: el dominio de una empresa no lo es.
    expect((await call('POST', '/crm/v3/objects/companies/batch/upsert', { inputs: [{ idProperty: 'domain', id: 'northwind-parts.example', properties: {} }] })).status).toBe(400);
  });

  it('batch create y batch archive', async () => {
    const res = await call('POST', '/crm/v3/objects/companies/batch/create', { inputs: [{ properties: { name: 'One' } }, { properties: { name: 'Two' } }] });
    expect(res.status).toBe(201);
    expect(res.json.results).toHaveLength(2);
    expect((await call('POST', '/crm/v3/objects/companies/batch/archive', { inputs: res.json.results.map((r: Json) => ({ id: r.id })) })).status).toBe(204);
    expect(portal.companies.size).toBe(3);
    expect(portal.archived.companies.size).toBe(2);
  });
});

describe('reglas de HubSpot al crear', () => {
  it('crear un contacto con un email que ya existe es un 409 que nombra al existente', async () => {
    const dup = await call('POST', '/crm/v3/objects/contacts', { properties: { email: 'Mara@Northwind-Parts.example', firstname: 'Other' } });
    expect(dup.status).toBe(409);
    expect(dup.json).toMatchObject({ category: 'CONFLICT', message: 'Contact already exists. Existing ID: 4001' });
    expect(portal.contacts.size).toBe(3);
    expect((await call('POST', '/crm/v3/objects/contacts/batch/create', { inputs: [{ properties: { email: 'joel@tallgrass-labs.example' } }] })).status).toBe(409);
    // Cambiarle el email a uno que ya es de otro contacto tampoco pasa.
    expect((await call('PATCH', '/crm/v3/objects/contacts/4003', { properties: { email: 'joel@tallgrass-labs.example' } })).status).toBe(409);
    // Sin email se puede crear más de uno.
    expect((await call('POST', '/crm/v3/objects/contacts', { properties: { firstname: 'No', lastname: 'Email' } })).status).toBe(201);
  });

  it('las empresas no se deduplican por dominio', async () => {
    const res = await call('POST', '/crm/v3/objects/companies', { properties: { name: 'Northwind again', domain: 'northwind-parts.example' } });
    expect(res.status).toBe(201);
    const same = await call('POST', '/crm/v3/objects/companies/search', { filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: 'northwind-parts.example' }] }] });
    expect(same.json.total).toBe(2);
    expect((await call('POST', '/crm/v3/objects/companies/search', { filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: 'tallgrass-labs.example' }] }] })).json.total).toBe(2);
  });

  it('lo creado por la API queda con id, alta y modificación, y se lee por email', async () => {
    const res = await call('POST', '/crm/v3/objects/contacts', { properties: { email: 'fresh@northwind-parts.example' } });
    const o = portal.contacts.get(res.json.id)!;
    expect(o.properties).toMatchObject({ hs_object_id: res.json.id, email: 'fresh@northwind-parts.example' });
    expect(o.properties.createdate).toBe(o.properties.lastmodifieddate);
    const byEmail = await call('GET', `/crm/v3/objects/contacts/${encodeURIComponent('fresh@northwind-parts.example')}?idProperty=email&properties=email`);
    expect(byEmail.json.id).toBe(res.json.id);
  });
});

describe('asociaciones', () => {
  it('contacto ↔ empresa con primaria, en los dos sentidos', async () => {
    const res = await call('POST', '/crm/v4/associations/contacts/companies/batch/read', { inputs: [{ id: '4001' }, { id: '4003' }, { id: '999' }] });
    expect(res.json.results).toHaveLength(2);
    const mara = res.json.results.find((r: Json) => r.from.id === '4001');
    expect(mara.to).toEqual([{ toObjectId: 3001, associationTypes: [{ category: 'HUBSPOT_DEFINED', typeId: 1, label: 'Primary' }, { category: 'HUBSPOT_DEFINED', typeId: 279, label: null }] }]);
    const bia = res.json.results.find((r: Json) => r.from.id === '4003');
    expect(bia.to[0].associationTypes).toEqual([{ category: 'HUBSPOT_DEFINED', typeId: 279, label: null }]);
    expect(portal.contacts.get('4001')!.properties.associatedcompanyid).toBe('3001');
    const back = await call('GET', '/crm/v4/objects/companies/3002/associations/contacts');
    expect(back.json.results.map((r: Json) => r.toObjectId).sort()).toEqual([4002, 4003]);
  });

  it('negocio ↔ contacto y negocio ↔ empresa', async () => {
    const contacts = await call('GET', '/crm/v4/objects/deals/6001/associations/contacts');
    expect(contacts.json.results).toEqual([{ toObjectId: 4001, associationTypes: [{ category: 'HUBSPOT_DEFINED', typeId: 3, label: null }] }]);
    const companies = await call('POST', '/crm/v4/associations/deals/companies/batch/read', { inputs: [{ id: '6001' }] });
    expect(companies.json.results[0].to[0]).toMatchObject({ toObjectId: 3001 });
    expect(companies.json.results[0].to[0].associationTypes.map((t: Json) => t.typeId)).toEqual([5, 341]);
    expect((await call('GET', '/crm/v4/objects/contacts/4001/associations/deals')).json.results[0]).toMatchObject({ toObjectId: 6001, associationTypes: [{ typeId: 4 }] });
  });

  it('asociar, cambiar la primaria y desasociar por la API', async () => {
    expect((await call('PUT', '/crm/v4/objects/contacts/4003/associations/default/companies/3003')).status).toBe(200);
    // Con la etiqueta de primaria: pasa a ser la empresa principal del contacto.
    expect((await call('PUT', '/crm/v4/objects/contacts/4001/associations/companies/3002', [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }])).status).toBe(200);
    expect(portal.contacts.get('4001')!.properties.associatedcompanyid).toBe('3002');
    const now = (await call('GET', '/crm/v4/objects/contacts/4001/associations/companies')).json.results as Json[];
    expect(now.find((r) => r.toObjectId === 3002)!.associationTypes[0]).toMatchObject({ typeId: 1, label: 'Primary' });
    expect(now.find((r) => r.toObjectId === 3001)!.associationTypes).toEqual([{ category: 'HUBSPOT_DEFINED', typeId: 279, label: null }]);
    expect((await call('DELETE', '/crm/v4/objects/contacts/4001/associations/companies/3001')).status).toBe(204);
    expect(((await call('GET', '/crm/v4/objects/contacts/4001/associations/companies')).json.results as Json[]).map((r) => r.toObjectId)).toEqual([3002]);
    expect(((await call('GET', '/crm/v4/objects/companies/3001/associations/contacts')).json.results as Json[]).length).toBe(0);
    expect((await call('PUT', '/crm/v4/objects/contacts/4001/associations/default/companies/999999')).status).toBe(404);
  });

  it('un registro creado con asociaciones queda asociado; el contacto toma esa empresa como principal', async () => {
    const res = await call('POST', '/crm/v3/objects/contacts', { properties: { firstname: 'Ana', email: 'ana@tallgrass-labs.example' }, associations: [{ to: { id: '3002' }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }] }] });
    expect(portal.contacts.get(res.json.id)!.properties.associatedcompanyid).toBe('3002');
    const note = await call('POST', '/crm/v3/objects/notes', { properties: { hs_note_body: 'Called', hs_timestamp: '2026-11-01T10:00:00.000Z' }, associations: [{ to: { id: '4001' }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }, { to: { id: '6001' }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 214 }] }] });
    expect(note.status).toBe(201);
    expect(portal.notes.get(note.json.id)!.associations).toEqual(['contacts:4001', 'deals:6001']);
    expect(((await call('GET', '/crm/v4/objects/contacts/4001/associations/notes')).json.results as Json[])[0].toObjectId).toBe(Number(note.json.id));
  });
});

describe('dueños, pipelines y propiedades', () => {
  it('dueños activos, archivados y por email', async () => {
    expect(ids(await call('GET', '/crm/v3/owners'))).toEqual(['81', '82']);
    expect(ids(await call('GET', '/crm/v3/owners?archived=true'))).toEqual(['83']);
    expect(ids(await call('GET', '/crm/v3/owners?email=teo@fake-portal.example'))).toEqual(['82']);
    expect((await call('GET', '/crm/v3/owners/81')).json).toMatchObject({ id: '81', email: 'ines@fake-portal.example', firstName: 'Ines', lastName: 'Vidal' });
    const paged = await call('GET', '/crm/v3/owners?limit=1');
    expect(paged.json.paging.next.after).toBe('1');
  });

  it('pipelines con sus etapas, probabilidad y cierre', async () => {
    const res = await call('GET', '/crm/v3/pipelines/deals');
    expect(res.json.results.map((p: Json) => p.id)).toEqual(['default', 'renewals']);
    expect(res.json.results[0].stages.map((s: Json) => [s.id, s.metadata.probability, s.metadata.isClosed])).toEqual([
      ['appointmentscheduled', '0.2', 'false'],
      ['contractsent', '0.8', 'false'],
      ['closedwon', '1.0', 'true'],
      ['closedlost', '0.0', 'true'],
    ]);
    expect((await call('GET', '/crm/v3/pipelines/deals/renewals/stages')).json.results).toHaveLength(2);
    expect((await call('GET', '/crm/v3/pipelines/deals/nope')).status).toBe(404);
  });

  it('definición de propiedades con sus opciones y grupos', async () => {
    const res = await call('GET', '/crm/v3/properties/contacts');
    const lang = res.json.results.find((p: Json) => p.name === 'preferred_language');
    expect(lang).toMatchObject({ type: 'enumeration', fieldType: 'select', hubspotDefined: false, groupName: 'contactinformation' });
    expect(lang.options.map((o: Json) => [o.value, o.label])).toEqual([
      ['es', 'Spanish'],
      ['en', 'English'],
      ['pt', 'Portuguese'],
    ]);
    expect(res.json.results.find((p: Json) => p.name === 'hs_object_id').modificationMetadata.readOnlyValue).toBe(true);
    expect((await call('GET', '/crm/v3/properties/deals/dealstage')).json.options).toHaveLength(6);
    expect((await call('GET', '/crm/v3/properties/companies/groups')).json.results[0]).toMatchObject({ name: 'companyinformation', label: 'Company information' });
    expect((await call('GET', '/crm/v3/properties/companies/nope')).status).toBe(404);
    // Una propiedad archivada solo sale con archived=true.
    portal.props.companies.push({ name: 'old_tier', label: 'Old tier', type: 'string', fieldType: 'text', groupName: 'companyinformation', archived: true });
    expect((await call('GET', '/crm/v3/properties/companies')).json.results.some((p: Json) => p.name === 'old_tier')).toBe(false);
    expect((await call('GET', '/crm/v3/properties/companies?archived=true')).json.results.map((p: Json) => p.name)).toEqual(['old_tier']);
  });
});

describe('archivar y fusionar', () => {
  it('lo archivado deja de listarse, de buscarse y de leerse, y aparece con archived=true', async () => {
    expect((await call('DELETE', '/crm/v3/objects/contacts/4002')).status).toBe(204);
    expect(ids(await call('GET', '/crm/v3/objects/contacts?limit=100'))).toEqual(['4001', '4003']);
    expect((await call('GET', '/crm/v3/objects/contacts/4002')).status).toBe(404);
    expect((await call('POST', '/crm/v3/objects/contacts/search', {})).json.total).toBe(2);
    const archived = await call('GET', '/crm/v3/objects/contacts?archived=true&properties=email');
    expect(archived.json.results).toEqual([expect.objectContaining({ id: '4002', archived: true, properties: { email: 'joel@tallgrass-labs.example' } })]);
    expect(Date.parse(archived.json.results[0].archivedAt)).toBeGreaterThan(0);
    // Sus asociaciones dejan de salir del otro lado.
    expect(((await call('GET', '/crm/v4/objects/companies/3002/associations/contacts')).json.results as Json[]).map((r) => r.toObjectId)).toEqual([4003]);
    // Desde "el lado de HubSpot" también, y se puede restaurar.
    expect(portal.archive('companies', '3003')).toBe(true);
    expect(portal.restore('companies', '3003')).toBe(true);
    expect(portal.companies.has('3003')).toBe(true);
  });

  it('fusionar: el que pierde deja de existir, el que queda guarda su id y hereda sus asociaciones', async () => {
    const before = portal.companies.get('3002')!.properties.hs_lastmodifieddate;
    const res = await call('POST', '/crm/v3/objects/companies/merge', { primaryObjectId: '3002', objectIdToMerge: '3003' });
    expect(res.status).toBe(200);
    expect(res.json.id).toBe('3002');
    expect(portal.companies.has('3003')).toBe(false);
    const winner = portal.companies.get('3002')!;
    expect(winner.properties.hs_merged_object_ids).toBe('3003');
    expect(Date.parse(winner.properties.hs_lastmodifieddate)).toBeGreaterThan(Date.parse(before));
    // El id viejo lleva al que quedó.
    expect((await call('GET', '/crm/v3/objects/companies/3003?properties=name')).json).toMatchObject({ id: '3002', properties: { name: 'Tallgrass Labs' } });
    expect(ids(await call('POST', '/crm/v3/objects/companies/batch/read', { inputs: [{ id: '3003' }, { id: '3002' }], properties: ['name'] }))).toEqual(['3002']);
    // Una segunda fusión suma el id a la lista.
    portal.merge('companies', '3001', '3002');
    expect(portal.companies.get('3002')!.properties.hs_merged_object_ids).toBe('3003;3001');
    expect(((await call('GET', '/crm/v4/objects/companies/3002/associations/contacts')).json.results as Json[]).map((r) => r.toObjectId).sort()).toEqual([4001, 4002, 4003]);
    expect((await call('GET', '/crm/v4/objects/contacts/4001/associations/companies')).json.results[0].toObjectId).toBe(3002);
  });

  it('fusionar contactos conserva el id del principal; empresas y negocios pueden quedar con id nuevo', async () => {
    const c = await call('POST', '/crm/v3/objects/contacts/merge', { primaryObjectId: '4001', objectIdToMerge: '4003' });
    expect(c.json.id).toBe('4001');
    portal.mergeCreatesNewRecord = true;
    const d = await call('POST', '/crm/v3/objects/deals/merge', { primaryObjectId: '6001', objectIdToMerge: '6002' });
    expect(['6001', '6002']).not.toContain(d.json.id);
    expect(portal.deals.size).toBe(1);
    expect(portal.deals.get(d.json.id)!.properties.hs_merged_object_ids.split(';').sort()).toEqual(['6001', '6002']);
    expect((await call('GET', '/crm/v3/objects/deals/6001?properties=dealname')).json.id).toBe(d.json.id);
    expect((await call('GET', '/crm/v3/objects/deals/6002?properties=dealname')).json.id).toBe(d.json.id);
  });
});

describe('fallas a pedido y límites', () => {
  it('429 con Retry-After, 423, 5xx y el límite diario', async () => {
    portal.fail(429, 1, { retryAfter: '7' });
    const limited = await call('GET', '/crm/v3/owners');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('7');
    expect(limited.json).toMatchObject({ errorType: 'RATE_LIMIT', policyName: 'TEN_SECONDLY_ROLLING' });
    portal.fail(429, 1, { policyName: 'DAILY' });
    expect((await call('GET', '/crm/v3/owners')).json).toMatchObject({ policyName: 'DAILY', message: 'You have reached your daily limit.' });
    portal.fail(423, 1);
    expect((await call('GET', '/crm/v3/owners')).status).toBe(423);
    portal.fail(503, 2);
    expect((await call('GET', '/crm/v3/owners')).status).toBe(503);
    expect((await call('GET', '/crm/v3/owners')).status).toBe(503);
    expect((await call('GET', '/crm/v3/owners')).status).toBe(200);
    // Solo para una ruta.
    portal.fail(500, 1, { path: '/batch/update' });
    expect((await call('GET', '/crm/v3/owners')).status).toBe(200);
    expect((await call('POST', '/crm/v3/objects/deals/batch/update', { inputs: [] })).status).toBe(500);
    // El contador de Lines: las próximas N llamadas son 429 con Retry-After: 1.
    portal.rateLimit = 1;
    const one = await call('GET', '/crm/v3/owners');
    expect([one.status, one.headers.get('retry-after')]).toEqual([429, '1']);
  });

  it('manda los headers de límite cuando se configuran, menos en la búsqueda', async () => {
    portal.rate = { max: 100, intervalMs: 10_000, remaining: 100, daily: 250_000, dailyRemaining: 10 };
    const res = await call('GET', '/crm/v3/owners');
    expect(res.headers.get('x-hubspot-ratelimit-max')).toBe('100');
    expect(res.headers.get('x-hubspot-ratelimit-remaining')).toBe('99');
    expect(res.headers.get('x-hubspot-ratelimit-interval-milliseconds')).toBe('10000');
    expect(res.headers.get('x-hubspot-ratelimit-daily')).toBe('250000');
    expect(res.headers.get('x-hubspot-ratelimit-daily-remaining')).toBe('9');
    const search = await call('POST', '/crm/v3/objects/contacts/search', {});
    expect(search.headers.get('x-hubspot-ratelimit-max')).toBeNull();
  });
});

describe('claves y permisos', () => {
  it('info del token para una private app heredada y para una service key', async () => {
    const info = (token: string) => call('POST', '/oauth/v2/private-apps/get/access-token-info', { tokenKey: token }, '');
    const legacy = await info('pat-na1-legacy');
    expect(legacy.json).toMatchObject({ hubId: Number(SYNC_PORTAL_ID), appId: 1 });
    expect(legacy.json.scopes).toContain('crm.objects.contacts.write');
    // HubSpot no documenta esa consulta para una service key: por defecto no la reconoce.
    expect((await info('pat-na1-svc-1')).status).toBe(400);
    portal.serviceKeyTokenInfo = 'supported';
    const key = await info('pat-na1-svc-1');
    expect(key.json.hubId).toBe(Number(SYNC_PORTAL_ID));
    expect(key.json.appId).toBeUndefined();
    expect((await info('nope')).status).toBe(401);
    expect((await call('GET', '/account-info/v3/details', undefined, 'pat-na1-svc-1')).json).toEqual({ portalId: Number(SYNC_PORTAL_ID), uiDomain: 'app.hubspot.com' });
  });

  it('sin clave válida es 401 y sin el permiso es 403, para leer y para escribir', async () => {
    expect((await call('GET', '/crm/v3/owners', undefined, 'whatever')).status).toBe(401);
    expect((await call('GET', '/crm/v3/objects/companies', undefined, 'pat-noscope')).status).toBe(403);
    expect((await call('GET', '/crm/v3/objects/contacts', undefined, 'pat-noscope')).status).toBe(200);
    expect((await call('PATCH', '/crm/v3/objects/contacts/4001', { properties: { jobtitle: 'x' } }, 'pat-readonly')).status).toBe(403);
    expect((await call('POST', '/crm/v3/objects/contacts/batch/upsert', { inputs: [] }, 'pat-readonly')).status).toBe(403);
    expect((await call('GET', '/crm/v3/properties/contacts', undefined, 'pat-noobjschema')).status).toBe(403);
    expect((await call('GET', '/crm/v3/objects/emails', undefined, TOKEN)).status).toBe(403);
    expect(portal.contacts.get('4001')!.properties.jobtitle).toBeUndefined();
  });

  it('otro host no responde', async () => {
    const res = await portal.fetch('https://example.com/crm/v3/owners', { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(404);
  });
});

describe('las cuentas de Lines y del import son esta misma cuenta', () => {
  it('cada uso tiene su cuenta con nombre y sus datos de arranque; reiniciar una no toca la otra', () => {
    resetFakeHubspot();
    const lines = fakeHubspot();
    expect(lines).toBeInstanceOf(FakeHubspotPortal);
    expect(lines.portalId).toBe('424242');
    const crm = resetFakeHubspotPortal('crm-test', seedSyncPortal);
    expect(fakeHubspotPortal('crm-test', seedSyncPortal)).toBe(crm);
    crm.add('companies', { name: 'Only in crm' });
    resetFakeHubspot();
    expect(fakeHubspotPortal('crm-test', seedSyncPortal).companies.size).toBe(4);
    expect(fakeHubspot().companies.size).toBe(3);
  });

  it('la cuenta del import acepta sus claves de prueba, con su tipo y sus permisos', async () => {
    const p = fakeImportPortal(fakeDatasetFromToken('fake-6'));
    expect(p.contacts.size).toBe(6);
    expect(['fake', 'fake-40', 'fake-svc', 'fake-svc-noemail', 'fake-noowners-12'].every(isFakeToken)).toBe(true);
    expect(['pat-x', 'fake-', 'fake-svc-nope', 'fakes'].some(isFakeToken)).toBe(false);
    expect(fakeDatasetFromToken('fake-svc-noemail-9').contacts).toBe(9);
    expect((await call('GET', '/crm/v3/owners', undefined, 'fake', p)).status).toBe(200);
    expect((await call('GET', '/crm/v3/owners', undefined, 'fake-noowners', p)).status).toBe(403);
    expect((await call('GET', '/crm/v3/objects/emails?limit=1', undefined, 'fake-svc-noemail', p)).status).toBe(403);
    expect((await call('GET', '/crm/v3/objects/emails?limit=1', undefined, 'fake-svc', p)).status).toBe(200);
    expect((await call('GET', '/crm/v3/owners', undefined, 'pat-na1-x', p)).status).toBe(401);
    expect((await call('POST', '/oauth/v2/private-apps/get/access-token-info', { tokenKey: 'fake' }, '', p)).json.appId).toBe(1);
    expect((await call('POST', '/oauth/v2/private-apps/get/access-token-info', { tokenKey: 'fake-svc' }, '', p)).status).toBe(400);
  });
});

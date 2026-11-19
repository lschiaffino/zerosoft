import { describe, expect, it } from 'vitest';
import { HubspotApiError, createHubspotClient } from '@/lib/hubspot/client';
import { FakeHubspotPortal } from '@/lib/hubspot/fake-portal';
import { START_CURSOR, readModifiedPage, type HsRecord, type ModifiedCursor } from '@/lib/crm-hubspot-sync/reader';
import { diffRecord, encodeDiff, decodeDiff, additionalEmails, mergedIds, hubspotCompanyDomain, lifecycleFromHubspot, leadStatusFromHubspot } from '@/lib/crm-hubspot-sync/fields';

/**
 * Sync CRM ↔ HubSpot: la lectura por fecha de modificación (nunca pagina por
 * posición, así que no se acerca al tope de 10.000 de la búsqueda) y la
 * comparación de campos. Todo contra el HubSpot falso; nada sale a internet.
 */

const TOKEN = 'pat-reader-test';

function portalWith(n: number): FakeHubspotPortal {
  const p = new FakeHubspotPortal();
  for (let i = 0; i < n; i++) p.add('contacts', { firstname: `Person${i}`, email: `person${i}@reader.example` }, String(1000 + i));
  return p;
}

const clientOf = (p: FakeHubspotPortal) => createHubspotClient({ token: TOKEN, fetch: p.fetch, sleep: async () => {}, budget: null });

async function readAll(p: FakeHubspotPortal, limit: number, onPage?: (n: number) => void): Promise<{ ids: string[]; pages: number; totals: Array<number | null> }> {
  const client = clientOf(p);
  const ids: string[] = [];
  const totals: Array<number | null> = [];
  let cursor: ModifiedCursor | null = { ...START_CURSOR };
  let pages = 0;
  while (cursor && pages < 500) {
    const page: { records: HsRecord[]; total: number | null; next: ModifiedCursor | null } = await readModifiedPage(client, 'contacts', cursor, ['email'], { limit });
    ids.push(...page.records.map((r) => r.id));
    totals.push(page.total);
    cursor = page.next;
    pages++;
    onPage?.(pages);
  }
  return { ids, pages, totals };
}

describe('lectura por fecha de modificación', () => {
  it('lee todo aunque la búsqueda corte mucho antes: nunca manda `after`', async () => {
    const p = portalWith(23);
    // Como si el tope de HubSpot fuera 7 resultados por consulta en vez de 10.000.
    p.searchCap = 7;
    const { ids, totals } = await readAll(p, 5);
    expect(new Set(ids).size).toBe(23);
    expect(totals[0]).toBe(23);
    const searches = p.calls.filter((c) => c.path.endsWith('/search'));
    expect(searches.length).toBeGreaterThan(4);
    for (const c of searches) {
      const body = c.body as { after?: unknown; sorts: Array<{ propertyName: string; direction: string }>; limit: number };
      expect(body.after).toBeUndefined();
      expect(body.sorts[0].direction).toBe('ASCENDING');
      expect(body.limit).toBe(5);
    }
    // Solo lee: ni un pedido que no sea la búsqueda.
    expect(p.calls.every((c) => c.method === 'POST' && c.path === '/crm/v3/objects/contacts/search')).toBe(true);
  });

  it('cada página nueva arranca en la última fecha vista (el borde se repite, nada se saltea)', async () => {
    const p = portalWith(12);
    const { ids } = await readAll(p, 5);
    expect(new Set(ids).size).toBe(12);
    // El registro del borde vuelve en la página siguiente: quien llama guarda por id.
    expect(ids.length).toBeGreaterThan(12);
    const filtered = p.calls.map((c) => c.body as { filterGroups?: Array<{ filters: Array<{ propertyName: string; operator: string }> }> }).filter((b) => b.filterGroups);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((b) => b.filterGroups![0].filters[0].propertyName === 'lastmodifieddate' && b.filterGroups![0].filters[0].operator === 'GTE')).toBe(true);
  });

  it('muchos registros con el mismo milisegundo: los recorre por id y sigue', async () => {
    const p = portalWith(20);
    const at = '2026-03-01T10:00:00.000Z';
    // Una carga masiva: 14 con la misma fecha, más viejos que el resto.
    [...p.contacts.values()].slice(0, 14).forEach((c) => {
      c.properties.lastmodifieddate = at;
      c.properties.hs_lastmodifieddate = at;
    });
    const { ids } = await readAll(p, 4);
    expect(new Set(ids).size).toBe(20);
    const tie = p.calls.map((c) => c.body as { filterGroups?: Array<{ filters: Array<{ propertyName: string; operator: string; value: string }> }>; sorts: Array<{ propertyName: string }> }).filter((b) => b.sorts[0].propertyName === 'hs_object_id');
    expect(tie.length).toBeGreaterThan(2);
    expect(tie[0].filterGroups![0].filters[0]).toMatchObject({ propertyName: 'lastmodifieddate', operator: 'BETWEEN', value: String(Date.parse(at)) });
    expect(tie[1].filterGroups![0].filters[1]).toMatchObject({ propertyName: 'hs_object_id', operator: 'GT' });
  });

  it('un registro editado a mitad de la lectura no hace saltear a otro', async () => {
    const p = portalWith(15);
    const { ids } = await readAll(p, 4, (page) => {
      // Alguien edita en HubSpot uno ya leído: pasa al final del orden.
      if (page === 1) p.edit('contacts', '1000', { firstname: 'Edited' });
      if (page === 2) p.add('contacts', { email: 'late@reader.example' }, '2000');
    });
    expect(new Set(ids).size).toBe(16);
    expect(ids).toContain('2000');
  });

  it('una cuenta vacía termina en una página', async () => {
    const { ids, pages } = await readAll(new FakeHubspotPortal(), 5);
    expect([ids, pages]).toEqual([[], 1]);
  });

  it('el límite diario de HubSpot corta con rate_limited y política daily, sin reintentar', async () => {
    const p = portalWith(3);
    p.fail(429, 1, { policyName: 'DAILY' });
    const err = await readModifiedPage(clientOf(p), 'contacts', { ...START_CURSOR }, ['email']).catch((e) => e);
    expect(err).toBeInstanceOf(HubspotApiError);
    expect(err).toMatchObject({ code: 'rate_limited', policy: 'daily' });
    expect(p.calls).toHaveLength(1);
    expect(String(err.message)).not.toContain(TOKEN);
  });

  it('una clave sin permiso de lectura: scope', async () => {
    const p = portalWith(1);
    const client = createHubspotClient({ token: 'pat-noscope-x', fetch: p.fetch, sleep: async () => {}, budget: null });
    await expect(readModifiedPage(client, 'companies', { ...START_CURSOR }, ['name'])).rejects.toMatchObject({ code: 'scope' });
  });
});

describe('comparación de campos estándar', () => {
  const plan = { owners: { '81': 'user-a' }, stages: { contractsent: 'stage-2' } };

  it('contactos: conflicto, campo que se completa y lo que no cuenta', () => {
    const local = { first_name: 'Mara', last_name: 'Q.', email: 'Mara@Northwind-Parts.example', phone: '', job_title: 'CEO', website: '', city: '', country: '', lifecycle_stage: 'lead', lead_status: 'new', owner_id: 'user-a' };
    const hs = { firstname: 'Mara', lastname: 'Quiroga', email: 'mara@northwind-parts.example', phone: '+54 261 555 0111', lifecyclestage: null, hs_lead_status: null, hubspot_owner_id: '81' };
    const d = diffRecord('contacts', hs, local, plan);
    // El email solo difiere en mayúsculas; lifecycle y lead status nuestros son los valores por defecto.
    expect(d).toEqual({ conflicting: ['last_name'], filling: ['phone', 'job_title'] });
    expect(decodeDiff(encodeDiff(d))).toEqual(d);
    expect(encodeDiff({ conflicting: [], filling: [] })).toBe('');
    expect(encodeDiff({ conflicting: [], filling: ['city'] })).toBe(';city');
  });

  it('el dueño solo se compara si el de HubSpot es una persona del workspace', () => {
    const local = { first_name: 'A', owner_id: 'user-b', lifecycle_stage: 'customer', lead_status: 'open' };
    expect(diffRecord('contacts', { firstname: 'A', hubspot_owner_id: '81', lifecyclestage: 'customer', hs_lead_status: 'OPEN' }, local, plan).conflicting).toEqual(['owner_id']);
    expect(diffRecord('contacts', { firstname: 'A', hubspot_owner_id: '99', lifecyclestage: 'customer', hs_lead_status: 'OPEN' }, local, plan)).toEqual({ conflicting: [], filling: [] });
    expect(diffRecord('contacts', { firstname: 'A', lifecyclestage: 'customer', hs_lead_status: 'OPEN' }, local, plan)).toEqual({ conflicting: [], filling: [] });
  });

  it('lifecycle y lead status pasan por el mapeo del importador; un valor propio de la cuenta no se compara', () => {
    expect(lifecycleFromHubspot('marketingqualifiedlead')).toBe('mql');
    expect(lifecycleFromHubspot('')).toBe('');
    expect(lifecycleFromHubspot('1234567')).toBeNull();
    expect(leadStatusFromHubspot('IN_PROGRESS')).toBe('in_progress');
    expect(diffRecord('contacts', { lifecyclestage: '1234567' }, { lifecycle_stage: 'customer', lead_status: 'new' }, plan)).toEqual({ conflicting: [], filling: [] });
    expect(diffRecord('contacts', { lifecyclestage: 'customer' }, { lifecycle_stage: 'lead', lead_status: 'new' }, plan).conflicting).toEqual(['lifecycle_stage']);
  });

  it('empresas: el dominio se compara limpio de los dos lados', () => {
    const hs = { name: 'Northwind Parts', domain: 'northwind-parts.example', numberofemployees: '120', city: 'Mendoza' };
    const local = { name: 'Northwind Parts', domain: 'https://www.Northwind-Parts.example/about', employees: 120, city: 'San Rafael', lifecycle_stage: 'lead' };
    expect(diffRecord('companies', hs, local, plan)).toEqual({ conflicting: ['city'], filling: [] });
    expect(hubspotCompanyDomain({ domain: '', website: 'https://www.tallgrass-labs.example/pricing' })).toBe('tallgrass-labs.example');
  });

  it('negocios: etapa por su equivalente, monto, moneda y fecha de cierre', () => {
    const hs = { dealname: 'Annual plan', dealstage: 'contractsent', amount: '18000', deal_currency_code: 'USD', closedate: '2027-01-31T00:00:00.000Z' };
    expect(diffRecord('deals', hs, { name: 'Annual plan', stage_id: 'stage-2', amount: 18000, currency: 'USD', close_date: '2027-01-31', description: '' }, plan)).toEqual({ conflicting: [], filling: [] });
    expect(diffRecord('deals', hs, { name: 'Annual plan', stage_id: 'stage-1', amount: 9000, currency: 'USD', close_date: null, description: '' }, plan)).toEqual({ conflicting: ['stage_id', 'amount'], filling: ['close_date'] });
    // Etapa sin equivalente y monto vacío contra el 0 por defecto: no cuentan.
    expect(diffRecord('deals', { dealname: 'X', dealstage: 'renewal_open' }, { name: 'X', stage_id: 'stage-9', amount: 0, currency: 'EUR', close_date: null }, plan)).toEqual({ conflicting: [], filling: [] });
  });

  it('emails secundarios e ids fusionados', () => {
    expect(additionalEmails({ hs_additional_emails: 'a@x.example;b@x.example; ' })).toEqual(['a@x.example', 'b@x.example']);
    expect(additionalEmails({})).toEqual([]);
    expect(mergedIds({ hs_merged_object_ids: '10;20;x' })).toEqual(['10', '20']);
  });
});

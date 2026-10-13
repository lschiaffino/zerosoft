import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { createCompany, createCustomField, createPipeline, createStage, getCompany } from '@/lib/crm';
import {
  createImportPreset,
  deleteImportPreset,
  extractEmails,
  importCompanies,
  importContacts,
  importDeals,
  listImportPresets,
  normalizeImportValue,
  parseAmount,
  parseImportDate,
} from '@/lib/crm-import';
import { addMember, createTeam } from '@/lib/teams';
import { guessMapping, hubspotMapping, presetMapping } from '@/components/crm/csv';
import { makeUser } from './helpers';

async function pipelineWithStages(userId: string) {
  const p = await createPipeline(userId, 'Sales');
  const s1 = (await createStage(userId, p.id, { name: 'Discovery' }))!;
  const s2 = (await createStage(userId, p.id, { name: 'Closed won' }))!;
  return { p, s1, s2 };
}

describe('Import: preset HubSpot (csv.ts)', () => {
  it('mapea las columnas reales de un export de contactos', () => {
    const headers = [
      'Record ID',
      'First Name',
      'Last Name',
      'Email',
      'Phone Number',
      'Job Title',
      'Lifecycle Stage',
      'Lead Status',
      'Contact owner',
      'Associated Company',
      'Country/Region',
      'Create Date',
      'Favorite color',
    ];
    expect(hubspotMapping(headers, 'contacts', [{ name: 'favorite_color', label: 'Favorite color' }])).toEqual([
      '',
      'firstName',
      'lastName',
      'email',
      'phone',
      'jobTitle',
      'lifecycleStage',
      'leadStatus',
      'ownerEmail',
      'companyName',
      'country',
      '',
      'custom.favorite_color',
    ]);
  });

  it('mapea empresas y deals', () => {
    expect(
      hubspotMapping(
        ['Company name', 'Company Domain Name', 'Number of Employees', 'Company owner', 'Parent Company', 'Industry'],
        'companies',
      ),
    ).toEqual(['name', 'domain', 'employees', 'ownerEmail', 'parentCompanyName', 'industry']);
    expect(
      hubspotMapping(
        [
          'Deal Name',
          'Pipeline',
          'Deal Stage',
          'Amount',
          'Deal currency code',
          'Close Date',
          'Deal owner',
          'Associated Company',
          'Associated Contact',
          'Deal Type',
        ],
        'deals',
      ),
    ).toEqual(['name', 'pipeline', 'stage', 'amount', 'currency', 'closeDate', 'ownerEmail', 'companyName', 'contactEmail', '']);
  });

  it('auto-detect no repite destinos y un preset guardado se aplica por header', () => {
    expect(guessMapping(['Email', 'Mail'], 'contacts')).toEqual(['email', '']);
    expect(presetMapping(['Correo', 'X'], { correo: 'email', X: 'bogus' }, ['email'])).toEqual(['email', '']);
  });
});

describe('Import: parsers', () => {
  it('montos, fechas, emails y valores de HubSpot', () => {
    expect(parseAmount('1,234.50')).toBe(1234.5);
    expect(parseAmount('1.234,50')).toBe(1234.5);
    expect(parseAmount('$1,234')).toBe(1234);
    expect(parseAmount('12,5')).toBe(12.5);
    expect(parseAmount('abc')).toBeNull();
    expect(parseImportDate('2026-10-01 00:00')).toBe('2026-10-01');
    expect(parseImportDate('10/03/2026')).toBe('2026-10-03');
    expect(parseImportDate('25/03/2026')).toBe('2026-03-25');
    expect(parseImportDate('31/02/2026')).toBeNull();
    expect(extractEmails('Jane Doe (JANE@x.com); bob@y.com')).toEqual([
      { email: 'jane@x.com', name: 'Jane Doe' },
      { email: 'bob@y.com', name: '' },
    ]);
    expect(normalizeImportValue('lifecycleStage', 'Marketing Qualified Lead')).toBe('mql');
    expect(normalizeImportValue('leadStatus', 'Attempted to Contact')).toBe('in_progress');
    expect(normalizeImportValue('source', 'Organic Search')).toBe('organic');
  });
});

describe('Import: contactos', () => {
  it('asocia la empresa por dominio como primaria y convierte custom fields', async () => {
    const u = await makeUser('imp');
    const acme = await createCompany(u.id, { name: 'Acme', domain: 'acme.io' });
    await createCustomField(u.id, { entity: 'contacts', name: 'score', label: 'Score', type: 'number' });
    await createCustomField(u.id, { entity: 'contacts', name: 'vip', label: 'VIP', type: 'boolean' });
    await createCustomField(u.id, {
      entity: 'contacts',
      name: 'tier',
      label: 'Tier',
      type: 'select',
      options: ['Gold', 'Silver'],
    });
    const res = await importContacts(
      u.id,
      [
        {
          email: 'ana@acme.io',
          firstName: 'Ana',
          companyDomain: 'https://www.ACME.io/about',
          custom: { score: '1,200', vip: 'Sí', tier: 'gold' },
        },
        { email: 'bo@new.co', companyName: 'NewCo', custom: { tier: 'Bronze' }, ownerEmail: 'ghost@x.com' },
      ],
      'skip',
    );
    expect(res.created).toBe(2);
    expect(res.errors.some((e) => e.startsWith('Row 2:') && e.includes('Bronze'))).toBe(true);
    expect(res.errors.some((e) => e.startsWith('Row 2:') && e.includes('ghost@x.com'))).toBe(true);

    const ana = (await getDb()
      .prepare("SELECT * FROM crm_contacts WHERE user_id = ? AND email = 'ana@acme.io'")
      .get(u.id)) as { id: string; company_id: string; custom: string; owner_id: string };
    expect(ana.company_id).toBe(acme.id);
    expect(JSON.parse(ana.custom)).toEqual({ score: 1200, vip: true, tier: 'Gold' });
    expect(ana.owner_id).toBe(u.id);
    const assoc = (await getDb()
      .prepare('SELECT is_primary FROM crm_contact_companies WHERE contact_id = ? AND company_id = ?')
      .get(ana.id, acme.id)) as { is_primary: number };
    expect(assoc.is_primary).toBe(1);

    const newco = (await getDb()
      .prepare("SELECT id FROM crm_companies WHERE user_id = ? AND name = 'NewCo'")
      .get(u.id)) as { id: string } | undefined;
    expect(newco).toBeTruthy();
  });

  it('owner por email o nombre de un miembro del team', async () => {
    const owner = await makeUser('impo');
    const member = await makeUser('impm');
    const team = await createTeam(owner.id, 'Ventas');
    await addMember(team.id, member.id);
    const outsider = await makeUser('impx');
    const res = await importContacts(
      owner.id,
      [
        { email: 'a@a.co', ownerEmail: member.email.toUpperCase() },
        { email: 'b@a.co', ownerEmail: outsider.email },
      ],
      'skip',
    );
    expect(res.created).toBe(2);
    const rows = (await getDb()
      .prepare('SELECT email, owner_id FROM crm_contacts WHERE user_id = ? ORDER BY email')
      .all(owner.id)) as Array<{ email: string; owner_id: string }>;
    expect(rows.find((r) => r.email === 'a@a.co')?.owner_id).toBe(member.id);
    expect(rows.find((r) => r.email === 'b@a.co')?.owner_id).toBe(owner.id);
    expect(res.errors).toHaveLength(1);
  });

  it('no reusa una empresa de otro workspace con el mismo dominio', async () => {
    const a = await makeUser('impa');
    const b = await makeUser('impb');
    const foreign = await createCompany(b.id, { name: 'Shared', domain: 'shared.io' });
    await importContacts(a.id, [{ email: 'x@shared.io', companyDomain: 'shared.io' }], 'skip');
    const c = (await getDb()
      .prepare("SELECT company_id FROM crm_contacts WHERE user_id = ? AND email = 'x@shared.io'")
      .get(a.id)) as { company_id: string };
    expect(c.company_id).toBeTruthy();
    expect(c.company_id).not.toBe(foreign.id);
    const own = (await getDb().prepare('SELECT user_id FROM crm_companies WHERE id = ?').get(c.company_id)) as {
      user_id: string;
    };
    expect(own.user_id).toBe(a.id);
  });
});

describe('Import: empresas', () => {
  it('empresa madre por nombre (aunque venga después) y avisa si no existe', async () => {
    const u = await makeUser('impc');
    const res = await importCompanies(
      u.id,
      [
        { name: 'Acme Brasil', domain: 'acme.com.br', parentCompanyName: 'acme global' },
        { name: 'Acme Global', domain: 'acme.com' },
        { name: 'Solo', parentCompanyDomain: 'nope.io' },
      ],
      'skip',
    );
    expect(res.created).toBe(3);
    const br = (await getDb()
      .prepare("SELECT parent_company_id FROM crm_companies WHERE user_id = ? AND domain = 'acme.com.br'")
      .get(u.id)) as { parent_company_id: string };
    const global = (await getDb()
      .prepare("SELECT id FROM crm_companies WHERE user_id = ? AND domain = 'acme.com'")
      .get(u.id)) as { id: string };
    expect(br.parent_company_id).toBe(global.id);
    expect(res.errors.some((e) => e.startsWith('Row 3:'))).toBe(true);
  });
});

describe('Import: deals', () => {
  it('pipeline/etapa por nombre, monto, moneda, owner, empresa y contactos', async () => {
    const u = await makeUser('impd');
    const member = await makeUser('impdm');
    const team = await createTeam(u.id, 'T');
    await addMember(team.id, member.id);
    const { p, s2 } = await pipelineWithStages(u.id);
    await getDb().prepare('UPDATE crm_stages SET is_won = 1 WHERE id = ?').run(s2.id);
    const existingContact = (await importContacts(u.id, [{ email: 'jane@acme.io', firstName: 'Jane' }], 'skip')).created;
    expect(existingContact).toBe(1);

    const res = await importDeals(
      u.id,
      [
        {
          name: 'Acme renewal',
          pipeline: 'sales',
          stage: 'closed WON',
          amount: '1.234,50',
          currency: 'eur',
          closeDate: '25/03/2026',
          ownerEmail: member.email,
          companyName: 'Acme',
          companyDomain: 'acme.io',
          contactEmail: 'Jane Doe (jane@acme.io); New Person (newp@acme.io)',
        },
        { name: 'Second', amount: '$2,000', stage: 'Unknown stage' },
        { amount: '10' },
      ],
      'skip',
    );
    expect(res.created).toBe(2);
    expect(res.errors.some((e) => e.startsWith('Row 2:') && e.includes('Unknown stage'))).toBe(true);
    expect(res.errors.some((e) => e.startsWith('Row 3:'))).toBe(true);

    const deal = (await getDb()
      .prepare("SELECT * FROM crm_deals WHERE user_id = ? AND name = 'Acme renewal'")
      .get(u.id)) as {
      id: string;
      pipeline_id: string;
      stage_id: string;
      amount: number;
      currency: string;
      close_date: string;
      owner_id: string;
      closed_at: string | null;
    };
    expect(deal.pipeline_id).toBe(p.id);
    expect(deal.stage_id).toBe(s2.id);
    expect(deal.amount).toBe(1234.5);
    expect(deal.currency).toBe('EUR');
    expect(deal.close_date).toBe('2026-03-25');
    expect(deal.owner_id).toBe(member.id);
    expect(deal.closed_at).toBeTruthy();

    const companies = (await getDb()
      .prepare(
        'SELECT co.domain, dc.is_primary FROM crm_deal_companies dc JOIN crm_companies co ON co.id = dc.company_id WHERE dc.deal_id = ?',
      )
      .all(deal.id)) as Array<{ domain: string; is_primary: number }>;
    expect(companies).toEqual([{ domain: 'acme.io', is_primary: 1 }]);
    const contacts = (await getDb()
      .prepare(
        'SELECT c.email, c.first_name FROM crm_deal_contacts dc JOIN crm_contacts c ON c.id = dc.contact_id WHERE dc.deal_id = ? ORDER BY c.email',
      )
      .all(deal.id)) as Array<{ email: string; first_name: string }>;
    expect(contacts).toEqual([
      { email: 'jane@acme.io', first_name: 'Jane' },
      { email: 'newp@acme.io', first_name: 'New' },
    ]);
    // La empresa creada por el import muestra el deal.
    const company = await getCompany(
      u.id,
      ((await getDb().prepare("SELECT id FROM crm_companies WHERE user_id = ? AND domain = 'acme.io'").get(u.id)) as {
        id: string;
      }).id,
    );
    expect(company?.deals.map((d) => d.name)).toContain('Acme renewal');

    // mode update: mismo nombre en el mismo pipeline → actualiza.
    const upd = await importDeals(u.id, [{ name: 'acme RENEWAL', amount: '5000' }], 'update');
    expect(upd.updated).toBe(1);
    const after = (await getDb().prepare('SELECT amount FROM crm_deals WHERE id = ?').get(deal.id)) as {
      amount: number;
    };
    expect(after.amount).toBe(5000);
  });
});

describe('Import: presets', () => {
  it('CRUD aislado por workspace', async () => {
    const a = await makeUser('ipa');
    const b = await makeUser('ipb');
    const preset = await createImportPreset(a.id, { entity: 'deals', name: 'Mi CRM', mapping: { Titulo: 'name' } });
    expect((await listImportPresets(a.id, 'deals')).map((p) => p.name)).toEqual(['Mi CRM']);
    expect(await listImportPresets(a.id, 'contacts')).toEqual([]);
    expect(await listImportPresets(b.id)).toEqual([]);
    expect(await deleteImportPreset(b.id, preset.id)).toBe(false);
    expect(await deleteImportPreset(a.id, preset.id)).toBe(true);
    expect(await listImportPresets(a.id)).toEqual([]);
  });
});

/**
 * Seed CRM — demo data.
 * Idempotent: wipes every crm_* row of the demo user and recreates the dataset.
 * Run with: npm run seed
 */
import { getDb, upsertUser } from '../lib/db';

const USER_ID = 'demo';
const EMAIL = 'demo@zerosoftware.ai';

// Deterministic PRNG so re-seeds produce the same dataset (ids aside).
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(7);

function pickWeighted<T>(pairs: Array<[T, number]>): T {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [value, weight] of pairs) {
    r -= weight;
    if (r <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function int(min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

/** Timestamp UTC 'YYYY-MM-DD HH:MM:SS' daysOffset days in the past (negative = future). */
function ts(daysOffset: number): string {
  const d = new Date(Date.now() - daysOffset * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Date-only 'YYYY-MM-DD'. */
function dateStr(daysOffset: number): string {
  return ts(daysOffset).slice(0, 10);
}

function ascii(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// ---------- Data pools ----------

const COMPANIES: Array<{ name: string; domain: string; industry: string }> = [
  { name: 'Kallpa Software', domain: 'kallpa.dev', industry: 'SaaS' },
  { name: 'Frigo Andino', domain: 'frigoandino.com', industry: 'Logistics' },
  { name: 'Mercado Simple', domain: 'mercadosimple.com', industry: 'E-commerce' },
  { name: 'Pampa Agtech', domain: 'pampaag.com', industry: 'Agtech' },
  { name: 'Rio Analytics', domain: 'rioanalytics.com.br', industry: 'SaaS' },
  { name: 'Café & Código', domain: 'cafecodigo.mx', industry: 'Consulting' },
  { name: 'Andes Pay', domain: 'andespay.com', industry: 'Fintech' },
  { name: 'Litoral Games', domain: 'litoralgames.com', industry: 'Gaming' },
  { name: 'Salud Norte', domain: 'saludnorte.com', industry: 'Healthtech' },
  { name: 'Aula Viva', domain: 'aulaviva.co', industry: 'Edtech' },
  { name: 'Terra Firma Propiedades', domain: 'terrafirma.uy', industry: 'Real Estate' },
  { name: 'Brasa Foods', domain: 'brasafoods.com.ar', industry: 'Manufacturing' },
  { name: 'Montevideo Metrics', domain: 'mvdmetrics.com', industry: 'SaaS' },
  { name: 'Córdoba Cloud', domain: 'cordobacloud.com', industry: 'SaaS' },
  { name: 'Selva Logistics', domain: 'selvalogistics.com', industry: 'Logistics' },
  { name: 'Northbeam Labs', domain: 'northbeamlabs.com', industry: 'SaaS' },
  { name: 'Cedar & Co', domain: 'cedarco.com', industry: 'Consulting' },
  { name: 'Bluebird Health', domain: 'bluebirdhealth.com', industry: 'Healthtech' },
  { name: 'Fathom Retail', domain: 'fathomretail.com', industry: 'E-commerce' },
  { name: 'Ironline Manufacturing', domain: 'ironlinemfg.com', industry: 'Manufacturing' },
  { name: 'Lantern Education', domain: 'lanternedu.com', industry: 'Edtech' },
  { name: 'Quillpay', domain: 'quillpay.com', industry: 'Fintech' },
  { name: 'Summit Realty Group', domain: 'summitrealty.co', industry: 'Real Estate' },
  { name: 'Harvest Moon Farms', domain: 'harvestmoonfarms.com', industry: 'Agtech' },
  { name: 'Pixel Forge Studios', domain: 'pixelforge.gg', industry: 'Gaming' },
  { name: 'Beacon Marketing Co', domain: 'beaconmarketing.co', industry: 'Marketing' },
  { name: 'Vista Freight', domain: 'vistafreight.com', industry: 'Logistics' },
  { name: 'Nordwind Health', domain: 'nordwindhealth.de', industry: 'Healthtech' },
  { name: 'Berlin Metrics', domain: 'berlinmetrics.de', industry: 'SaaS' },
  { name: 'Costa Digital', domain: 'costadigital.es', industry: 'Marketing' },
  { name: 'Duero Wines Export', domain: 'duerowines.es', industry: 'E-commerce' },
  { name: 'Alpen Logistics', domain: 'alpenlogistics.ch', industry: 'Logistics' },
  { name: 'Fjord Games', domain: 'fjordgames.no', industry: 'Gaming' },
  { name: 'Lusitana Tech', domain: 'lusitanatech.pt', industry: 'SaaS' },
  { name: 'Galway Finance', domain: 'galwayfinance.ie', industry: 'Fintech' },
  { name: 'Tulip Realty', domain: 'tuliprealty.nl', industry: 'Real Estate' },
  { name: 'Baltic Learning', domain: 'balticlearning.ee', industry: 'Edtech' },
  { name: 'Rhône Agro', domain: 'rhoneagro.fr', industry: 'Agtech' },
  { name: 'Milano Moda Group', domain: 'milanomoda.it', industry: 'E-commerce' },
  { name: 'Thames Consulting', domain: 'thamesconsulting.uk', industry: 'Consulting' },
];

const FIRST_NAMES = [
  'Martín', 'Sofía', 'Lucía', 'Diego', 'Camila', 'Joaquín', 'Valentina', 'Mateo', 'Ana',
  'Bruno', 'Thiago', 'Mariana', 'Pedro', 'Julia', 'Rafael', 'Fernanda', 'John', 'Sarah',
  'Michael', 'Emily', 'David', 'Laura', 'James', 'Olivia', 'Daniel', 'Emma', 'Carlos',
  'Isabella', 'Lucas', 'Mia',
];

const LAST_NAMES = [
  'González', 'Rodríguez', 'Silva', 'Santos', 'Pereira', 'Fernández', 'López', 'Martínez',
  'Costa', 'Oliveira', 'Smith', 'Johnson', 'Brown', 'Miller', 'García', 'Hernández',
  'Díaz', 'Torres', 'Ramírez', 'Souza',
];

const JOB_TITLES = [
  'CEO', 'Founder', 'CTO', 'VP Sales', 'Head of Growth', 'Account Executive', 'SDR',
  'Marketing Manager', 'Product Manager', 'Operations Manager', 'CFO', 'Data Analyst',
  'Customer Success Manager', 'Business Developer', 'HR Lead', 'Engineer',
];

const LOCATIONS: Array<[[string, string], number]> = [
  [['Montevideo', 'UY'], 3],
  [['Buenos Aires', 'AR'], 3],
  [['Córdoba', 'AR'], 1],
  [['São Paulo', 'BR'], 2],
  [['Mexico City', 'MX'], 2],
  [['Madrid', 'ES'], 2],
  [['Barcelona', 'ES'], 1],
  [['New York', 'US'], 2],
  [['Austin', 'US'], 1],
  [['San Francisco', 'US'], 1],
  [['Miami', 'US'], 1],
];

const LIFECYCLE: Array<[string, number]> = [
  ['lead', 30],
  ['mql', 15],
  ['sql', 15],
  ['opportunity', 12],
  ['customer', 20],
  ['subscriber', 5],
  ['evangelist', 3],
];

const SOURCES: Array<[string, number]> = [
  ['organic', 25],
  ['referral', 20],
  ['ads', 15],
  ['social', 12],
  ['email', 12],
  ['event', 8],
  ['other', 8],
];

const PRIORITIES: Array<[string, number]> = [
  ['low', 25],
  ['medium', 50],
  ['high', 25],
];

function leadStatusFor(lifecycle: string): string {
  switch (lifecycle) {
    case 'subscriber':
      return pickWeighted([['new', 5], ['open', 5]]);
    case 'lead':
      return pickWeighted([['new', 6], ['open', 3], ['bad_timing', 1]]);
    case 'mql':
      return pickWeighted([['open', 4], ['in_progress', 4], ['unqualified', 2]]);
    case 'sql':
      return pickWeighted([['in_progress', 6], ['connected', 4]]);
    case 'opportunity':
      return pickWeighted([['open_deal', 8], ['connected', 2]]);
    default:
      return 'connected'; // customer, evangelist
  }
}

const LOST_REASONS = ['price', 'timing', 'competitor', 'no budget', 'went silent'];

const DEAL_KINDS = ['New business', 'Expansion', 'Renewal', 'Pilot', 'Annual plan', 'Migration'];
const PARTNERSHIP_KINDS = ['Integration partnership', 'Co-marketing', 'Reseller agreement', 'Referral program'];

const NOTE_BODIES = [
  'Met at the trade show booth. Interested in the team plan, asked for a deck.',
  'Champion is the Head of Growth. Budget approved for Q3, needs security review.',
  'Asked about SSO and audit logs. Sending docs tomorrow.',
  'Warm intro from a mutual contact. Very aligned with our pricing model.',
  'They currently track everything in spreadsheets. Pain is real.',
  'Decision maker is the CFO; keep the pitch short and numbers-first.',
  'Waiting on legal to review the MSA. No blockers expected.',
  'Prefers async communication over email, hates calls.',
  'Renewal risk: usage dropped last month. Schedule a check-in.',
  'Great product fit. They want to start with a 2-week pilot.',
];

const TASK_SUBJECTS = [
  'Follow up on the proposal',
  'Send pricing deck',
  'Book demo with the technical team',
  'Prepare contract draft',
  'Check in on trial usage',
  'Send onboarding checklist',
  'Review renewal terms',
  'Intro call with the new champion',
  'Share case study',
  'Confirm meeting agenda',
];

const CALL_OUTCOMES = ['connected', 'voicemail', 'no answer', 'rescheduled', 'busy'];
const MEETING_DURATIONS = [15, 30, 45, 60];

const EMAIL_SUBJECTS = [
  'Re: pricing question',
  'Following up on our conversation',
  'Proposal attached',
  'Quick intro',
  'Trial extension',
  'Next steps',
  'Deck you asked for',
  'Checking in',
];

const COMPETITORS = ['HubSpot', 'Salesforce', 'Pipedrive', 'Zoho', 'a spreadsheet'];

// ---------- Seed ----------

function main() {
  const db = getDb();
  upsertUser({ id: USER_ID, email: EMAIL, name: 'Demo User', image: null });

  const insertCompany = db.prepare(
    `INSERT INTO crm_companies
       (id, user_id, name, domain, industry, employees, phone, website, city, country,
        lifecycle_stage, custom, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
  );
  const insertContact = db.prepare(
    `INSERT INTO crm_contacts
       (id, user_id, first_name, last_name, email, phone, job_title, website, city, country,
        lifecycle_stage, lead_status, source, company_id, custom, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertPipeline = db.prepare(
    'INSERT INTO crm_pipelines (id, user_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const insertStage = db.prepare(
    `INSERT INTO crm_stages (id, pipeline_id, name, probability, position, is_won, is_lost)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertDeal = db.prepare(
    `INSERT INTO crm_deals
       (id, user_id, pipeline_id, stage_id, name, amount, currency, close_date, priority,
        source, description, lost_reason, position, closed_at, custom, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertDealContact = db.prepare(
    'INSERT OR IGNORE INTO crm_deal_contacts (deal_id, contact_id) VALUES (?, ?)',
  );
  const insertActivity = db.prepare(
    `INSERT INTO crm_activities
       (id, user_id, type, subject, body, due_at, done, done_at, direction, outcome,
        duration_min, contact_id, company_id, deal_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertList = db.prepare(
    'INSERT INTO crm_lists (id, user_id, name, entity, kind, filter, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const insertListMember = db.prepare(
    'INSERT OR IGNORE INTO crm_list_members (list_id, contact_id) VALUES (?, ?)',
  );
  const insertCustomField = db.prepare(
    `INSERT INTO crm_custom_fields (id, user_id, entity, name, label, type, options, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertSavedView = db.prepare(
    'INSERT INTO crm_saved_views (id, user_id, entity, name, query, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );

  const counters = { companies: 0, contacts: 0, deals: 0, won: 0, lost: 0, activities: 0 };

  const seedAll = db.transaction(() => {
    // ---- Wipe previous demo data (single transaction with the re-seed) ----
    db.prepare(
      'DELETE FROM crm_deal_contacts WHERE deal_id IN (SELECT id FROM crm_deals WHERE user_id = ?)',
    ).run(USER_ID);
    db.prepare(
      'DELETE FROM crm_list_members WHERE list_id IN (SELECT id FROM crm_lists WHERE user_id = ?)',
    ).run(USER_ID);
    db.prepare(
      'DELETE FROM crm_stages WHERE pipeline_id IN (SELECT id FROM crm_pipelines WHERE user_id = ?)',
    ).run(USER_ID);
    for (const table of [
      'crm_activities',
      'crm_deals',
      'crm_pipelines',
      'crm_lists',
      'crm_contacts',
      'crm_companies',
      'crm_custom_fields',
      'crm_saved_views',
      'crm_imports',
    ]) {
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(USER_ID);
    }

    // ---- Companies ----
    const companyIds: string[] = [];
    const companyDomain: string[] = [];
    for (const c of COMPANIES) {
      const id = crypto.randomUUID();
      const [city, country] = pickWeighted(LOCATIONS);
      const employees = Math.round(3 * Math.exp(rand() * Math.log(5000 / 3)));
      const createdAt = ts(60 + rand() * 120);
      insertCompany.run(
        id,
        USER_ID,
        c.name,
        c.domain,
        c.industry,
        employees,
        `+${int(1, 598)} ${int(100, 999)} ${int(100, 999)} ${int(100, 999)}`,
        `https://${c.domain}`,
        city,
        country,
        pickWeighted([
          ['lead', 40],
          ['opportunity', 20],
          ['customer', 30],
          ['mql', 10],
        ]),
        createdAt,
        createdAt,
      );
      companyIds.push(id);
      companyDomain.push(c.domain);
      counters.companies++;
    }

    // ---- Contacts ----
    interface SeedContact {
      id: string;
      companyIdx: number | null; // index into companyIds
      lifecycle: string;
    }
    const contacts: SeedContact[] = [];
    const customers: string[] = [];
    for (let i = 0; i < 200; i++) {
      const id = crypto.randomUUID();
      const first = pick(FIRST_NAMES);
      const last = pick(LAST_NAMES);
      const withCompany = rand() < 0.85;
      const companyIdx = withCompany ? int(0, companyIds.length - 1) : null;
      const domain =
        companyIdx !== null ? companyDomain[companyIdx] : pick(['gmail.com', 'outlook.com']);
      const email = `${ascii(first)}.${ascii(last)}@${domain}`;
      const lifecycle = pickWeighted(LIFECYCLE);
      const [city, country] = pickWeighted(LOCATIONS);
      const createdAt = ts(rand() * 120);
      // ~40% rellena el custom field team_size.
      const custom =
        rand() < 0.4 ? JSON.stringify({ team_size: pick(['1-10', '11-50', '51-200', '200+']) }) : '{}';
      insertContact.run(
        id,
        USER_ID,
        first,
        last,
        email,
        rand() < 0.8 ? `+${int(1, 598)} ${int(90, 99)} ${int(100, 999)} ${int(100, 999)}` : '',
        pick(JOB_TITLES),
        '',
        city,
        country,
        lifecycle,
        leadStatusFor(lifecycle),
        pickWeighted(SOURCES),
        companyIdx !== null ? companyIds[companyIdx] : null,
        custom,
        createdAt,
        createdAt,
      );
      contacts.push({ id, companyIdx, lifecycle });
      if (lifecycle === 'customer') customers.push(id);
      counters.contacts++;
    }

    // ---- Pipelines & stages ----
    const createdAtPipes = ts(150);
    const salesPipelineId = crypto.randomUUID();
    const partnersPipelineId = crypto.randomUUID();
    insertPipeline.run(salesPipelineId, USER_ID, 'Sales', 0, createdAtPipes);
    insertPipeline.run(partnersPipelineId, USER_ID, 'Partnerships', 1, createdAtPipes);

    interface SeedStage {
      id: string;
      isWon: boolean;
      isLost: boolean;
    }
    const makeStages = (pipelineId: string, defs: Array<[string, number, boolean, boolean]>) => {
      const stages: SeedStage[] = [];
      defs.forEach(([name, probability, isWon, isLost], position) => {
        const id = crypto.randomUUID();
        insertStage.run(id, pipelineId, name, probability, position, isWon ? 1 : 0, isLost ? 1 : 0);
        stages.push({ id, isWon, isLost });
      });
      return stages;
    };

    const salesStages = makeStages(salesPipelineId, [
      ['Discovery', 20, false, false],
      ['Qualified', 40, false, false],
      ['Proposal', 60, false, false],
      ['Negotiation', 80, false, false],
      ['Closed won', 100, true, false],
      ['Closed lost', 0, false, true],
    ]);
    const partnerStages = makeStages(partnersPipelineId, [
      ['Exploration', 25, false, false],
      ['Alignment', 50, false, false],
      ['Agreement', 100, true, false],
      ['Dropped', 0, false, true],
    ]);

    // ---- Deals ----
    const positionCounter = new Map<string, number>();
    const nextPosition = (stageId: string): number => {
      const n = (positionCounter.get(stageId) ?? 0) + 1;
      positionCounter.set(stageId, n);
      return n * 1024;
    };

    interface SeedDeal {
      id: string;
      primaryContact: SeedContact;
    }
    const deals: SeedDeal[] = [];

    const contactsWithCompany = contacts.filter((c) => c.companyIdx !== null);

    // Distribución exacta barajada: 13 won (~20%), 8 lost (~12%), 44 open.
    const fates: Array<'open' | 'won' | 'lost'> = [
      ...Array<'open' | 'won' | 'lost'>(13).fill('won'),
      ...Array<'open' | 'won' | 'lost'>(8).fill('lost'),
      ...Array<'open' | 'won' | 'lost'>(44).fill('open'),
    ];
    for (let i = fates.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [fates[i], fates[j]] = [fates[j], fates[i]];
    }

    for (let i = 0; i < 65; i++) {
      const isSales = i < 52;
      const pipelineId = isSales ? salesPipelineId : partnersPipelineId;
      const stages = isSales ? salesStages : partnerStages;
      const openStages = stages.filter((s) => !s.isWon && !s.isLost);
      const wonStage = stages.find((s) => s.isWon)!;
      const lostStage = stages.find((s) => s.isLost)!;

      const fate = fates[i];
      const stage =
        fate === 'won'
          ? wonStage
          : fate === 'lost'
            ? lostStage
            : pickWeighted(openStages.map((s) => [s, 1] as [SeedStage, number]));

      // Amount log-normal $500–$60k, redondeado a centenas.
      const amount = Math.round((500 * Math.exp(rand() * Math.log(120))) / 100) * 100;

      // Contacto primario con empresa → el deal "pertenece" a esa empresa.
      const primary = pick(contactsWithCompany);
      const companyName = COMPANIES[primary.companyIdx!].name;
      const name = isSales
        ? `${companyName} — ${pick(DEAL_KINDS)}`
        : `${companyName} — ${pick(PARTNERSHIP_KINDS)}`;

      let closeDate: string;
      let closedAt: string | null = null;
      let lostReason = '';
      let createdDaysAgo: number;
      if (fate === 'open') {
        closeDate = dateStr(-int(1, 90)); // futuro
        createdDaysAgo = rand() * 90;
      } else {
        const closedDaysAgo = 1 + rand() * 59; // -60..-1 días
        closeDate = dateStr(closedDaysAgo);
        closedAt = ts(closedDaysAgo + rand() * 2 - 1);
        if (fate === 'lost') lostReason = pick(LOST_REASONS);
        createdDaysAgo = closedDaysAgo + int(10, 90);
      }

      const id = crypto.randomUUID();
      const createdAt = ts(createdDaysAgo);
      // ~40% rellena el custom field competitor.
      const custom = rand() < 0.4 ? JSON.stringify({ competitor: pick(COMPETITORS) }) : '{}';
      insertDeal.run(
        id,
        USER_ID,
        pipelineId,
        stage.id,
        name,
        amount,
        'USD',
        closeDate,
        pickWeighted(PRIORITIES),
        pickWeighted(SOURCES),
        rand() < 0.3 ? 'Seeded demo deal. ' + pick(NOTE_BODIES) : '',
        lostReason,
        nextPosition(stage.id),
        closedAt,
        custom,
        createdAt,
        createdAt,
      );

      // 1–3 contactos por deal.
      insertDealContact.run(id, primary.id);
      const extra = int(0, 2);
      for (let e = 0; e < extra; e++) insertDealContact.run(id, pick(contacts).id);

      deals.push({ id, primaryContact: primary });
      counters.deals++;
      if (fate === 'won') counters.won++;
      if (fate === 'lost') counters.lost++;
    }

    // ---- Activities (~420) ----
    for (let i = 0; i < 420; i++) {
      const type = pickWeighted([
        ['note', 30],
        ['task', 25],
        ['call', 20],
        ['meeting', 15],
        ['email', 10],
      ] as Array<['note' | 'task' | 'call' | 'meeting' | 'email', number]>);

      // 40% cuelga de un deal (con su contacto primario y empresa); el resto de un contacto.
      let contactId: string;
      let companyId: string | null;
      let dealId: string | null = null;
      if (rand() < 0.4) {
        const deal = pick(deals);
        dealId = deal.id;
        contactId = deal.primaryContact.id;
        companyId =
          deal.primaryContact.companyIdx !== null
            ? companyIds[deal.primaryContact.companyIdx]
            : null;
      } else {
        const contact = pick(contacts);
        contactId = contact.id;
        companyId = contact.companyIdx !== null ? companyIds[contact.companyIdx] : null;
      }

      const createdDaysAgo = rand() * 60;
      const createdAt = ts(createdDaysAgo);
      let subject = '';
      let body = '';
      let dueAt: string | null = null;
      let done = 0;
      let doneAt: string | null = null;
      let direction = '';
      let outcome = '';
      let durationMin: number | null = null;

      switch (type) {
        case 'note':
          subject = pick(['Note', 'Call notes', 'Research', 'Context', 'Meeting notes']);
          body = pick(NOTE_BODIES);
          break;
        case 'task': {
          subject = pick(TASK_SUBJECTS);
          dueAt = ts(createdDaysAgo - int(-15, 15)); // due entre -15 y +15 días
          if (rand() < 0.4) {
            done = 1;
            const doneDaysAgo = Math.max(0, createdDaysAgo - rand() * 10);
            doneAt = ts(doneDaysAgo);
          }
          break;
        }
        case 'call':
          subject = pick(['Discovery call', 'Follow-up call', 'Cold call', 'Check-in call']);
          direction = pickWeighted([
            ['outbound', 7],
            ['inbound', 3],
          ]);
          outcome = pick(CALL_OUTCOMES);
          durationMin = int(3, 45);
          break;
        case 'meeting':
          subject = pick(['Demo', 'Quarterly review', 'Kickoff', 'Negotiation meeting', 'Onsite visit']);
          durationMin = pick(MEETING_DURATIONS);
          break;
        case 'email':
          subject = pick(EMAIL_SUBJECTS);
          direction = pickWeighted([
            ['outbound', 6],
            ['inbound', 4],
          ]);
          body = rand() < 0.5 ? 'Seeded demo email thread.' : '';
          break;
      }

      insertActivity.run(
        crypto.randomUUID(),
        USER_ID,
        type,
        subject,
        body,
        dueAt,
        done,
        doneAt,
        direction,
        outcome,
        durationMin,
        contactId,
        companyId,
        dealId,
        createdAt,
        createdAt,
      );
      counters.activities++;
    }

    // ---- Lists ----
    const listsCreatedAt = ts(30);
    insertList.run(
      crypto.randomUUID(),
      USER_ID,
      'Active SQLs',
      'contacts',
      'dynamic',
      JSON.stringify({ lifecycle: 'sql' }),
      listsCreatedAt,
    );
    const newsletterId = crypto.randomUUID();
    insertList.run(newsletterId, USER_ID, 'Q3 newsletter', 'contacts', 'static', '{}', listsCreatedAt);
    for (let i = 0; i < 30; i++) insertListMember.run(newsletterId, pick(contacts).id);
    const vipId = crypto.randomUUID();
    insertList.run(vipId, USER_ID, 'VIP customers', 'contacts', 'static', '{}', listsCreatedAt);
    const vipPicks = [...customers].sort(() => rand() - 0.5).slice(0, 12);
    for (const contactId of vipPicks) insertListMember.run(vipId, contactId);

    // ---- Custom fields ----
    insertCustomField.run(
      crypto.randomUUID(),
      USER_ID,
      'contacts',
      'team_size',
      'Team size',
      'select',
      JSON.stringify(['1-10', '11-50', '51-200', '200+']),
      0,
    );
    insertCustomField.run(
      crypto.randomUUID(),
      USER_ID,
      'deals',
      'competitor',
      'Competitor',
      'text',
      '[]',
      0,
    );

    // ---- Saved views ----
    insertSavedView.run(
      crypto.randomUUID(),
      USER_ID,
      'contacts',
      'Hot SQLs',
      JSON.stringify({ lifecycle: 'sql', sort: 'name' }),
      listsCreatedAt,
    );
    insertSavedView.run(
      crypto.randomUUID(),
      USER_ID,
      'contacts',
      'New leads',
      JSON.stringify({ lifecycle: 'lead', sort: 'newest' }),
      listsCreatedAt,
    );
  });
  seedAll();

  console.log(`\n0 — crm seed complete`);
  console.log(`    user:       ${EMAIL} (id=${USER_ID})`);
  console.log(`    companies:  ${counters.companies}`);
  console.log(`    contacts:   ${counters.contacts}`);
  console.log(`    pipelines:  2 (Sales ×6 stages, Partnerships ×4 stages)`);
  console.log(`    deals:      ${counters.deals} (${counters.won} won, ${counters.lost} lost, ${counters.deals - counters.won - counters.lost} open)`);
  console.log(`    activities: ${counters.activities}`);
  console.log(`    lists:      3 · custom fields: 2 · saved views: 2\n`);
}

main();

/**
 * Lines: el HubSpot falso de tests y demo. Es la cuenta falsa compartida
 * (lib/hubspot/fake-portal.ts) con los datos de arranque de Lines: tres
 * empresas, cuatro contactos, dos negocios, dos dueños y las propiedades que
 * muestran las pantallas. Los datos son inventados. Nada sale a internet.
 * Server-only.
 *
 * Tokens: cualquiera que empiece con "pat-" vale (con "svc" es una service
 * key). Si contiene "noscope" solo lee contactos (para probar el error de
 * permisos); si contiene "readonly" lee todo pero no puede escribir (ni notas
 * ni propiedades); con "noobjschema" no puede leer el esquema de contactos ni
 * negocios.
 */
import type { FetchLike } from './groups-provider';
import { FakeHubspotPortal, fakeHubspotPortal, resetFakeHubspotPortal, type FakeProps, type FakePropertyDef } from './hubspot/fake-portal';

export type { FakePropertyDef } from './hubspot/fake-portal';

type Props = FakeProps;
export const FAKE_HUBSPOT_PORTAL = '424242';


const OWNERS: Record<string, { firstName: string; lastName: string; email: string }> = {
  '71': { firstName: 'Paula', lastName: 'Ortiz', email: 'paula@zerosoft.example' },
  '72': { firstName: 'Bruno', lastName: 'Lima', email: 'bruno@zerosoft.example' },
};

const PIPELINES = [
  {
    id: 'default',
    label: 'Sales pipeline',
    stages: [
      { id: 'appointmentscheduled', label: 'Appointment scheduled' },
      { id: 'qualifiedtobuy', label: 'Qualified to buy' },
      { id: 'contractsent', label: 'Contract sent' },
      { id: 'closedwon', label: 'Closed won' },
    ],
  },
];

const PROP_GROUPS = [
  { name: 'companyinformation', label: 'Company information', displayOrder: 0 },
  { name: 'account_health', label: 'Account health', displayOrder: 1 },
  { name: 'company_activity', label: 'Activity', displayOrder: 2 },
];

const LIFECYCLE_OPTIONS = [
  { label: 'Subscriber', value: 'subscriber' },
  { label: 'Lead', value: 'lead' },
  { label: 'Marketing qualified lead', value: 'marketingqualifiedlead' },
  { label: 'Sales qualified lead', value: 'salesqualifiedlead' },
  { label: 'Opportunity', value: 'opportunity' },
  { label: 'Customer', value: 'customer' },
  { label: 'Evangelist', value: 'evangelist' },
  { label: 'Other', value: 'other' },
];

/** Propiedades de empresa del HubSpot falso: las de siempre, algunas propias, una calculada y una oculta. */
function companyProps(): FakePropertyDef[] {
  const info = 'companyinformation';
  const health = 'account_health';
  const sys = { hubspotDefined: true, readOnlyValue: true, groupName: 'company_activity' };
  return [
    { name: 'name', label: 'Company name', type: 'string', fieldType: 'text', groupName: info, hubspotDefined: true },
    { name: 'domain', label: 'Company domain name', type: 'string', fieldType: 'text', groupName: info, hubspotDefined: true },
    { name: 'description', label: 'Description', type: 'string', fieldType: 'textarea', groupName: info, hubspotDefined: true },
    { name: 'phone', label: 'Phone number', type: 'string', fieldType: 'phonenumber', groupName: info, hubspotDefined: true },
    { name: 'city', label: 'City', type: 'string', fieldType: 'text', groupName: info, hubspotDefined: true },
    { name: 'country', label: 'Country/Region', type: 'string', fieldType: 'text', groupName: info, hubspotDefined: true },
    {
      name: 'industry',
      label: 'Industry',
      type: 'enumeration',
      fieldType: 'select',
      groupName: info,
      hubspotDefined: true,
      options: [
        { label: 'Transportation', value: 'TRANSPORTATION' },
        { label: 'Retail', value: 'RETAIL' },
        { label: 'Food production', value: 'FOOD_PRODUCTION' },
        { label: 'Computer software', value: 'COMPUTER_SOFTWARE' },
      ],
    },
    { name: 'numberofemployees', label: 'Number of employees', type: 'number', fieldType: 'number', groupName: info, hubspotDefined: true },
    { name: 'annualrevenue', label: 'Annual revenue', type: 'number', fieldType: 'number', groupName: info, hubspotDefined: true },
    { name: 'lifecyclestage', label: 'Lifecycle stage', type: 'enumeration', fieldType: 'radio', groupName: info, hubspotDefined: true, options: LIFECYCLE_OPTIONS },
    { name: 'hubspot_owner_id', label: 'Company owner', type: 'enumeration', fieldType: 'select', groupName: info, hubspotDefined: true, referencedObjectType: 'OWNER' },
    {
      name: 'plan_tier',
      label: 'Plan',
      type: 'enumeration',
      fieldType: 'select',
      groupName: health,
      options: [
        { label: 'Starter', value: 'starter' },
        { label: 'Growth', value: 'growth' },
        { label: 'Scale', value: 'scale' },
      ],
    },
    { name: 'renewal_date', label: 'Renewal date', type: 'date', fieldType: 'date', groupName: health },
    { name: 'last_review_at', label: 'Last business review', type: 'datetime', fieldType: 'date', groupName: health },
    { name: 'is_strategic', label: 'Strategic account', type: 'bool', fieldType: 'booleancheckbox', groupName: health, options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
    {
      name: 'products_used',
      label: 'Products in use',
      type: 'enumeration',
      fieldType: 'checkbox',
      groupName: health,
      options: [
        { label: 'Inbox', value: 'inbox' },
        { label: 'Broadcasts', value: 'broadcasts' },
        { label: 'Analytics', value: 'analytics' },
      ],
    },
    { name: 'health_score', label: 'Health score', type: 'number', fieldType: 'number', groupName: health },
    { name: 'csm_notes', label: 'Success notes', type: 'string', fieldType: 'textarea', groupName: health },
    { name: 'seats_per_employee', label: 'Seats per employee', type: 'number', fieldType: 'calculation_equation', groupName: health, calculated: true },
    { name: 'internal_sync_key', label: 'Internal sync key', type: 'string', fieldType: 'text', groupName: health, hidden: true },
    { name: 'createdate', label: 'Create date', type: 'datetime', fieldType: 'date', ...sys },
    { name: 'hs_lastmodifieddate', label: 'Last modified date', type: 'datetime', fieldType: 'date', ...sys },
    { name: 'hs_object_id', label: 'Record ID', type: 'number', fieldType: 'number', ...sys },
    { name: 'hs_merged_object_ids', label: 'Merged record IDs', type: 'enumeration', fieldType: 'checkbox', ...sys, hidden: true },
  ];
}

const CONTACT_GROUPS = [
  { name: 'contactinformation', label: 'Contact information', displayOrder: 0 },
  { name: 'sales_properties', label: 'Sales', displayOrder: 1 },
  { name: 'contact_activity', label: 'Activity', displayOrder: 2 },
];

const DEAL_GROUPS = [
  { name: 'dealinformation', label: 'Deal information', displayOrder: 0 },
  { name: 'deal_terms', label: 'Terms', displayOrder: 1 },
  { name: 'deal_activity', label: 'Activity', displayOrder: 2 },
];

/** Propiedades de contacto del HubSpot falso: las de siempre, algunas propias, de solo lectura y una oculta. */
function contactProps(): FakePropertyDef[] {
  const info = 'contactinformation';
  const sales = 'sales_properties';
  const sys = { hubspotDefined: true, readOnlyValue: true, groupName: 'contact_activity' };
  return [
    { name: 'firstname', label: 'First name', type: 'string', fieldType: 'text', groupName: info, hubspotDefined: true },
    { name: 'lastname', label: 'Last name', type: 'string', fieldType: 'text', groupName: info, hubspotDefined: true },
    { name: 'email', label: 'Email', type: 'string', fieldType: 'text', groupName: info, hubspotDefined: true },
    { name: 'phone', label: 'Phone number', type: 'string', fieldType: 'phonenumber', groupName: info, hubspotDefined: true },
    { name: 'mobilephone', label: 'Mobile phone number', type: 'string', fieldType: 'phonenumber', groupName: info, hubspotDefined: true },
    { name: 'hs_whatsapp_phone_number', label: 'WhatsApp phone number', type: 'string', fieldType: 'phonenumber', groupName: info, hubspotDefined: true },
    { name: 'jobtitle', label: 'Job title', type: 'string', fieldType: 'text', groupName: info, hubspotDefined: true },
    { name: 'company', label: 'Company name', type: 'string', fieldType: 'text', groupName: info, hubspotDefined: true },
    { name: 'city', label: 'City', type: 'string', fieldType: 'text', groupName: info, hubspotDefined: true },
    { name: 'lifecyclestage', label: 'Lifecycle stage', type: 'enumeration', fieldType: 'radio', groupName: sales, hubspotDefined: true, options: LIFECYCLE_OPTIONS },
    {
      name: 'hs_lead_status',
      label: 'Lead status',
      type: 'enumeration',
      fieldType: 'select',
      groupName: sales,
      hubspotDefined: true,
      options: [
        { label: 'New', value: 'NEW' },
        { label: 'Open', value: 'OPEN' },
        { label: 'In progress', value: 'IN_PROGRESS' },
        { label: 'Connected', value: 'CONNECTED' },
      ],
    },
    { name: 'hubspot_owner_id', label: 'Contact owner', type: 'enumeration', fieldType: 'select', groupName: sales, hubspotDefined: true, referencedObjectType: 'OWNER' },
    {
      name: 'preferred_channel',
      label: 'Preferred channel',
      type: 'enumeration',
      fieldType: 'select',
      groupName: sales,
      options: [
        { label: 'WhatsApp', value: 'whatsapp' },
        { label: 'Email', value: 'email' },
        { label: 'Phone', value: 'phone' },
      ],
    },
    { name: 'decision_maker', label: 'Decision maker', type: 'bool', fieldType: 'booleancheckbox', groupName: sales, options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
    { name: 'associatedcompanyid', label: 'Primary company ID', type: 'number', fieldType: 'number', groupName: info, hubspotDefined: true, hidden: true },
    { name: 'createdate', label: 'Create date', type: 'datetime', fieldType: 'date', ...sys },
    { name: 'hs_object_id', label: 'Record ID', type: 'number', fieldType: 'number', ...sys },
  ];
}

/** Propiedades de negocio del HubSpot falso. */
function dealProps(): FakePropertyDef[] {
  const info = 'dealinformation';
  const terms = 'deal_terms';
  const sys = { hubspotDefined: true, readOnlyValue: true, groupName: 'deal_activity' };
  const stages = PIPELINES.flatMap((p) => p.stages.map((s) => ({ label: s.label, value: s.id })));
  return [
    { name: 'dealname', label: 'Deal name', type: 'string', fieldType: 'text', groupName: info, hubspotDefined: true },
    { name: 'dealstage', label: 'Deal stage', type: 'enumeration', fieldType: 'radio', groupName: info, hubspotDefined: true, options: stages },
    { name: 'pipeline', label: 'Pipeline', type: 'enumeration', fieldType: 'select', groupName: info, hubspotDefined: true, options: PIPELINES.map((p) => ({ label: p.label, value: p.id })) },
    { name: 'amount', label: 'Amount', type: 'number', fieldType: 'number', groupName: info, hubspotDefined: true },
    { name: 'closedate', label: 'Close date', type: 'datetime', fieldType: 'date', groupName: info, hubspotDefined: true },
    { name: 'hubspot_owner_id', label: 'Deal owner', type: 'enumeration', fieldType: 'select', groupName: info, hubspotDefined: true, referencedObjectType: 'OWNER' },
    { name: 'hs_deal_stage_probability', label: 'Deal probability', type: 'number', fieldType: 'number', groupName: info, hubspotDefined: true, calculated: true },
    { name: 'deal_currency_code', label: 'Currency', type: 'enumeration', fieldType: 'select', groupName: terms, hubspotDefined: true, options: [{ label: 'US Dollar', value: 'USD' }, { label: 'Euro', value: 'EUR' }] },
    {
      name: 'dealtype',
      label: 'Deal type',
      type: 'enumeration',
      fieldType: 'select',
      groupName: terms,
      hubspotDefined: true,
      options: [
        { label: 'New business', value: 'newbusiness' },
        { label: 'Existing business', value: 'existingbusiness' },
      ],
    },
    { name: 'contract_months', label: 'Contract length (months)', type: 'number', fieldType: 'number', groupName: terms },
    { name: 'next_step', label: 'Next step', type: 'string', fieldType: 'textarea', groupName: terms, hubspotDefined: true },
    { name: 'createdate', label: 'Create date', type: 'datetime', fieldType: 'date', ...sys },
    { name: 'hs_object_id', label: 'Record ID', type: 'number', fieldType: 'number', ...sys },
  ];
}

function seed(): FakeHubspotPortal {
  const p = new FakeHubspotPortal({ portalId: FAKE_HUBSPOT_PORTAL });
  const created = '2026-01-15T12:00:00.000Z';
  const company = (id: string, properties: Props) => p.companies.set(id, { id, properties: { ...properties, hs_object_id: id, createdate: created, hs_lastmodifieddate: created } });
  const contact = (id: string, properties: Props) => p.contacts.set(id, { id, properties });
  const deal = (id: string, properties: Props) => p.deals.set(id, { id, properties });
  for (const [id, o] of Object.entries(OWNERS)) p.owners.set(id, { id, ...o });
  p.pipelines = PIPELINES.map((x) => ({ ...x, stages: x.stages.map((s) => ({ ...s })) }));
  p.props = { companies: companyProps(), contacts: contactProps(), deals: dealProps() };
  p.propGroups = { companies: PROP_GROUPS, contacts: CONTACT_GROUPS, deals: DEAL_GROUPS };
  company('9001', {
    name: 'Acme Logistics',
    domain: 'acme-logistics.example',
    hubspot_owner_id: '71',
    lifecyclestage: 'customer',
    industry: 'TRANSPORTATION',
    numberofemployees: '250',
    city: 'Rosario',
    phone: '+54 341 555 0100',
    plan_tier: 'growth',
    renewal_date: '2027-03-01',
    is_strategic: 'true',
    products_used: 'inbox;broadcasts',
    health_score: '82',
    seats_per_employee: '0.4',
    internal_sync_key: 'acme-001',
  });
  company('9002', {
    name: 'Globex Retail',
    domain: 'globex-retail.example',
    hubspot_owner_id: '72',
    lifecyclestage: 'lead',
    industry: 'RETAIL',
    numberofemployees: '40',
    plan_tier: 'starter',
    renewal_date: '2026-12-10',
    is_strategic: 'false',
    products_used: 'inbox',
    health_score: '55',
  });
  company('9003', { name: 'Initech Foods', domain: 'initech-foods.example', hubspot_owner_id: '', lifecyclestage: 'opportunity', industry: 'FOOD_PRODUCTION', numberofemployees: '900' });
  deal('8001', {
    dealname: 'Acme Logistics renewal',
    dealstage: 'contractsent',
    pipeline: 'default',
    amount: '12000',
    deal_currency_code: 'USD',
    closedate: '2026-12-15T00:00:00Z',
    hubspot_owner_id: '71',
    dealtype: 'existingbusiness',
    contract_months: '12',
    hs_deal_stage_probability: '0.8',
  });
  deal('8002', { dealname: 'Globex Retail pilot', dealstage: 'qualifiedtobuy', pipeline: 'default', amount: '4500', deal_currency_code: 'USD', closedate: '2027-01-20T00:00:00Z', hubspot_owner_id: '72' });
  contact('7001', {
    firstname: 'Dana',
    lastname: 'Rivers',
    email: 'dana@acme-logistics.example',
    phone: '+54 9 11 5555-0142',
    company: 'Acme Logistics',
    associatedcompanyid: '9001',
    hubspot_owner_id: '71',
    lifecyclestage: 'customer',
    jobtitle: 'Operations lead',
    hs_lead_status: 'CONNECTED',
    preferred_channel: 'whatsapp',
  });
  contact('7002', { firstname: 'Omar', lastname: 'Castell', email: 'omar@globex-retail.example', mobilephone: '+1 (415) 555-0177', company: 'Globex Retail', associatedcompanyid: '9002', hubspot_owner_id: '72', lifecyclestage: 'lead' });
  contact('7003', { firstname: 'Lena', lastname: 'Duarte', email: 'lena@initech-foods.example', phone: '+52 55 5555 0199', company: 'Initech Foods', associatedcompanyid: '9003', lifecyclestage: 'opportunity' });
  contact('7004', { firstname: 'Nico', lastname: 'Duarte', email: 'nico@initech-foods.example', hs_whatsapp_phone_number: '+525555550199', company: 'Initech Foods', associatedcompanyid: '9003', lifecyclestage: 'opportunity' });
  for (const [c, co] of [['7001', '9001'], ['7002', '9002'], ['7003', '9003'], ['7004', '9003']]) p.associate('contacts', c, 'companies', co, { primary: true });
  p.associate('contacts', '7001', 'deals', '8001');
  p.associate('contacts', '7002', 'deals', '8002');
  return p;
}

const NAME = 'lines';

/** El HubSpot falso (tests: mirar las llamadas, agregar o borrar registros). */
export function fakeHubspot(): FakeHubspotPortal {
  return fakeHubspotPortal(NAME, seed);
}

export function resetFakeHubspot(): void {
  resetFakeHubspotPortal(NAME, seed);
}

/** "Alguien editó la empresa en HubSpot": cambia propiedades y la fecha de modificación. Devuelve esa fecha. */
export function editFakeCompany(id: string, properties: Props): string {
  return fakeHubspot().edit('companies', id, properties);
}

/** Fusiona `loserId` en `winnerId` como HubSpot: la primera deja de existir y la segunda guarda su id. */
export function mergeFakeCompanies(loserId: string, winnerId: string): void {
  fakeHubspot().merge('companies', loserId, winnerId);
}

export const fakeHubspotFetch: FetchLike = (url, init) => fakeHubspot().fetch(url, init);

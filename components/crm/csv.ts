/**
 * Import CSV — parser y auto-mapeo (módulo puro, sin React, testeable con tsx).
 * Lo usa ImportPanel; no importar desde server code.
 */

export type ImportEntity = 'contacts' | 'companies' | 'deals';

export const IMPORT_FIELDS: Record<ImportEntity, string[]> = {
  contacts: [
    'fullName',
    'firstName',
    'lastName',
    'email',
    'phone',
    'jobTitle',
    'website',
    'city',
    'country',
    'lifecycleStage',
    'leadStatus',
    'source',
    'ownerEmail',
    'companyName',
    'companyDomain',
  ],
  companies: [
    'name',
    'domain',
    'industry',
    'employees',
    'phone',
    'website',
    'city',
    'country',
    'lifecycleStage',
    'ownerEmail',
    'parentCompanyName',
    'parentCompanyDomain',
  ],
  deals: [
    'name',
    'pipeline',
    'stage',
    'amount',
    'currency',
    'closeDate',
    'ownerEmail',
    'priority',
    'source',
    'description',
    'companyName',
    'companyDomain',
    'contactEmail',
  ],
};

/** Prefijo de los campos custom en el mapeo: `custom.<name>`. */
export const CUSTOM_PREFIX = 'custom.';

/** Normaliza un header: lower, sin nada que no sea [a-z0-9]. */
export function normHeader(h: string): string {
  return h.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}

/** Aliases normalizados (lower, sin nada que no sea [a-z0-9]) → campo destino. */
const ALIASES: Record<string, string> = {
  firstname: 'firstName',
  first: 'firstName',
  nombre: 'firstName',
  givenname: 'firstName',
  lastname: 'lastName',
  last: 'lastName',
  apellido: 'lastName',
  surname: 'lastName',
  email: 'email',
  mail: 'email',
  correo: 'email',
  emailaddress: 'email',
  phone: 'phone',
  telefono: 'phone',
  tel: 'phone',
  mobile: 'phone',
  jobtitle: 'jobTitle',
  title: 'jobTitle',
  cargo: 'jobTitle',
  position: 'jobTitle',
  role: 'jobTitle',
  website: 'website',
  web: 'website',
  site: 'website',
  sitio: 'website',
  url: 'website',
  city: 'city',
  ciudad: 'city',
  country: 'country',
  pais: 'country',
  lifecyclestage: 'lifecycleStage',
  lifecycle: 'lifecycleStage',
  leadstatus: 'leadStatus',
  status: 'leadStatus',
  source: 'source',
  origen: 'source',
  name: 'name',
  company: 'name',
  companyname: 'name',
  empresa: 'name',
  domain: 'domain',
  dominio: 'domain',
  industry: 'industry',
  industria: 'industry',
  sector: 'industry',
  employees: 'employees',
  empleados: 'employees',
  size: 'employees',
  headcount: 'employees',
};

/**
 * Parser CSV RFC 4180 minimal: comillas dobles (escape ""), comas,
 * saltos \n / \r\n y campos multilínea entre comillas.
 * Devuelve filas sin contenido filtradas.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      pushField();
      i++;
      continue;
    }
    if (c === '\n') {
      pushRow();
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    field += c;
    i++;
  }
  pushRow();
  // Descarta filas sin ningún contenido (p.ej. la última línea vacía).
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Aliases que dependen de la entidad (un "name" de deal es el nombre del deal, etc.). */
const ENTITY_ALIASES: Record<ImportEntity, Record<string, string>> = {
  contacts: {
    name: 'fullName',
    fullname: 'fullName',
    contactname: 'fullName',
    company: 'companyName',
    companyname: 'companyName',
    empresa: 'companyName',
    companydomain: 'companyDomain',
    domain: 'companyDomain',
    owner: 'ownerEmail',
    owneremail: 'ownerEmail',
  },
  companies: {
    owner: 'ownerEmail',
    owneremail: 'ownerEmail',
    parentcompany: 'parentCompanyName',
    parent: 'parentCompanyName',
    parentdomain: 'parentCompanyDomain',
  },
  deals: {
    name: 'name',
    dealname: 'name',
    deal: 'name',
    title: 'name',
    pipeline: 'pipeline',
    stage: 'stage',
    dealstage: 'stage',
    etapa: 'stage',
    amount: 'amount',
    value: 'amount',
    monto: 'amount',
    valor: 'amount',
    currency: 'currency',
    moneda: 'currency',
    closedate: 'closeDate',
    expectedclosedate: 'closeDate',
    owner: 'ownerEmail',
    owneremail: 'ownerEmail',
    priority: 'priority',
    prioridad: 'priority',
    source: 'source',
    description: 'description',
    descripcion: 'description',
    company: 'companyName',
    companyname: 'companyName',
    empresa: 'companyName',
    companydomain: 'companyDomain',
    domain: 'companyDomain',
    contact: 'contactEmail',
    contactemail: 'contactEmail',
    email: 'contactEmail',
  },
};

export interface MappableCustomField {
  name: string;
  label: string;
}

/** Campos destino válidos de una entidad, incluidos sus custom fields. */
export function importTargets(entity: ImportEntity, customFields: MappableCustomField[] = []): string[] {
  return [...IMPORT_FIELDS[entity], ...customFields.map((f) => `${CUSTOM_PREFIX}${f.name}`)];
}

/**
 * Auto-mapeo header → campo destino por alias; '' si no hay match. Los custom
 * fields se reconocen por name o label. Cada destino se usa una sola vez.
 */
export function guessMapping(
  headers: string[],
  entity: ImportEntity,
  customFields: MappableCustomField[] = [],
): string[] {
  const valid = new Set(IMPORT_FIELDS[entity]);
  const custom = new Map<string, string>();
  for (const f of customFields) {
    custom.set(normHeader(f.name), `${CUSTOM_PREFIX}${f.name}`);
    custom.set(normHeader(f.label), `${CUSTOM_PREFIX}${f.name}`);
  }
  const used = new Set<string>();
  return headers.map((h) => {
    const norm = normHeader(h);
    const entityHit = ENTITY_ALIASES[entity][norm];
    const generic = ALIASES[norm];
    const hit =
      (entityHit && valid.has(entityHit) ? entityHit : '') ||
      (generic && valid.has(generic) ? generic : '') ||
      custom.get(norm) ||
      '';
    if (!hit || used.has(hit)) return '';
    used.add(hit);
    return hit;
  });
}

/**
 * Preset "HubSpot export": nombres de columna exactos de los CSV que exporta
 * HubSpot (normalizados). null = columna que se ignora a propósito.
 */
export const HUBSPOT_COLUMNS: Record<ImportEntity, Record<string, string | null>> = {
  contacts: {
    recordid: null,
    firstname: 'firstName',
    lastname: 'lastName',
    email: 'email',
    phonenumber: 'phone',
    mobilephonenumber: 'phone',
    jobtitle: 'jobTitle',
    websiteurl: 'website',
    city: 'city',
    countryregion: 'country',
    country: 'country',
    lifecyclestage: 'lifecycleStage',
    leadstatus: 'leadStatus',
    originalsource: 'source',
    originaltrafficsource: 'source',
    contactowner: 'ownerEmail',
    associatedcompany: 'companyName',
    companyname: 'companyName',
    createdate: null,
  },
  companies: {
    recordid: null,
    companyname: 'name',
    name: 'name',
    companydomainname: 'domain',
    industry: 'industry',
    numberofemployees: 'employees',
    phonenumber: 'phone',
    city: 'city',
    countryregion: 'country',
    lifecyclestage: 'lifecycleStage',
    companyowner: 'ownerEmail',
    websiteurl: 'website',
    parentcompany: 'parentCompanyName',
    createdate: null,
  },
  deals: {
    recordid: null,
    dealname: 'name',
    pipeline: 'pipeline',
    dealstage: 'stage',
    amount: 'amount',
    currency: 'currency',
    dealcurrencycode: 'currency',
    closedate: 'closeDate',
    dealowner: 'ownerEmail',
    priority: 'priority',
    dealdescription: 'description',
    associatedcompany: 'companyName',
    associatedcontact: 'contactEmail',
    dealtype: null,
    createdate: null,
  },
};

/**
 * Presets de exports de otros CRMs: nombres de columna normalizados de los CSV
 * que exporta cada uno. null = columna que se ignora a propósito.
 */
export const CSV_PRESETS = ['hubspot', 'salesforce', 'zoho', 'pipedrive', 'attio', 'close'] as const;
export type CsvPreset = (typeof CSV_PRESETS)[number];

/** Salesforce y Zoho exportan casi las mismas columnas (Account = empresa, Opportunity/Deal = deal). */
const SALESFORCE_COLUMNS: Record<ImportEntity, Record<string, string | null>> = {
  contacts: {
    contactid: null,
    leadid: null,
    firstname: 'firstName',
    lastname: 'lastName',
    fullname: 'fullName',
    email: 'email',
    phone: 'phone',
    mobile: 'phone',
    mobilephone: 'phone',
    title: 'jobTitle',
    mailingcity: 'city',
    mailingcountry: 'country',
    city: 'city',
    country: 'country',
    leadsource: 'source',
    leadstatus: 'leadStatus',
    contactowner: 'ownerEmail',
    leadowner: 'ownerEmail',
    owneremail: 'ownerEmail',
    accountname: 'companyName',
    company: 'companyName',
    website: 'website',
    createddate: null,
  },
  companies: {
    accountid: null,
    accountname: 'name',
    website: 'website',
    industry: 'industry',
    employees: 'employees',
    phone: 'phone',
    billingcity: 'city',
    billingcountry: 'country',
    accountowner: 'ownerEmail',
    parentaccount: 'parentCompanyName',
    createddate: null,
  },
  deals: {
    opportunityid: null,
    opportunityname: 'name',
    dealname: 'name',
    stage: 'stage',
    amount: 'amount',
    opportunitycurrency: 'currency',
    currency: 'currency',
    closedate: 'closeDate',
    closingdate: 'closeDate',
    opportunityowner: 'ownerEmail',
    dealowner: 'ownerEmail',
    accountname: 'companyName',
    leadsource: 'source',
    description: 'description',
    contactemail: 'contactEmail',
    primarycontactemail: 'contactEmail',
    pipeline: 'pipeline',
    probability: null,
    createddate: null,
  },
};

const PRESET_COLUMNS: Record<CsvPreset, Record<ImportEntity, Record<string, string | null>>> = {
  hubspot: HUBSPOT_COLUMNS,
  salesforce: SALESFORCE_COLUMNS,
  zoho: {
    contacts: { ...SALESFORCE_COLUMNS.contacts, recordid: null, secondaryemail: null, createdtime: null },
    companies: { ...SALESFORCE_COLUMNS.companies, recordid: null, createdtime: null },
    deals: { ...SALESFORCE_COLUMNS.deals, recordid: null, contactname: 'contactEmail', createdtime: null },
  },
  pipedrive: {
    contacts: {
      personid: null,
      personname: 'fullName',
      name: 'fullName',
      personfirstname: 'firstName',
      personlastname: 'lastName',
      personemail: 'email',
      personemailwork: 'email',
      emailwork: 'email',
      personphone: 'phone',
      personphonework: 'phone',
      phonework: 'phone',
      personjobtitle: 'jobTitle',
      personorganization: 'companyName',
      organization: 'companyName',
      personowner: 'ownerEmail',
      owner: 'ownerEmail',
      personlabel: null,
    },
    companies: {
      organizationid: null,
      organizationname: 'name',
      name: 'name',
      organizationwebsite: 'website',
      organizationindustry: 'industry',
      organizationaddress: null,
      organizationowner: 'ownerEmail',
      owner: 'ownerEmail',
      organizationnumberofemployees: 'employees',
    },
    deals: {
      dealid: null,
      dealtitle: 'name',
      title: 'name',
      dealvalue: 'amount',
      value: 'amount',
      dealcurrency: 'currency',
      dealpipeline: 'pipeline',
      dealstage: 'stage',
      dealexpectedclosedate: 'closeDate',
      dealowner: 'ownerEmail',
      dealorganization: 'companyName',
      dealcontactperson: 'contactEmail',
      dealstatus: null,
    },
  },
  attio: {
    contacts: {
      recordid: null,
      name: 'fullName',
      firstname: 'firstName',
      lastname: 'lastName',
      emailaddresses: 'email',
      phonenumbers: 'phone',
      jobtitle: 'jobTitle',
      company: 'companyName',
      primarylocation: 'city',
      owner: 'ownerEmail',
    },
    companies: {
      recordid: null,
      name: 'name',
      domains: 'domain',
      categories: 'industry',
      primarylocation: 'city',
      employeerange: null,
      owner: 'ownerEmail',
    },
    deals: {
      recordid: null,
      name: 'name',
      dealname: 'name',
      dealstage: 'stage',
      stage: 'stage',
      dealvalue: 'amount',
      value: 'amount',
      dealowner: 'ownerEmail',
      owner: 'ownerEmail',
      associatedcompany: 'companyName',
      associatedpeople: 'contactEmail',
    },
  },
  close: {
    contacts: {
      id: null,
      leadid: null,
      contactname: 'fullName',
      name: 'fullName',
      title: 'jobTitle',
      primaryemail: 'email',
      emails: 'email',
      primaryphone: 'phone',
      phones: 'phone',
      leadname: 'companyName',
      leadurl: null,
    },
    companies: {
      id: null,
      leadid: null,
      displayname: 'name',
      name: 'name',
      url: 'website',
      statuslabel: null,
      primaryaddresscity: 'city',
      primaryaddresscountry: 'country',
      leadowner: 'ownerEmail',
    },
    deals: {
      id: null,
      leadname: 'companyName',
      statuslabel: 'stage',
      pipelinename: 'pipeline',
      value: 'amount',
      valuecurrency: 'currency',
      datewon: 'closeDate',
      expecteddate: 'closeDate',
      username: 'ownerEmail',
      note: 'description',
      contactname: null,
      contactemail: 'contactEmail',
    },
  },
};

/**
 * Mapeo de un preset de CRM. Las columnas que el preset no conoce caen al
 * auto-detect (custom fields incluidos); cada destino se usa una sola vez.
 */
export function presetColumnsMapping(
  preset: CsvPreset,
  headers: string[],
  entity: ImportEntity,
  customFields: MappableCustomField[] = [],
): string[] {
  const fallback = guessMapping(headers, entity, customFields);
  const table = PRESET_COLUMNS[preset][entity];
  const valid = new Set(IMPORT_FIELDS[entity]);
  const used = new Set<string>();
  const out = headers.map((h) => {
    const norm = normHeader(h);
    if (!(norm in table)) return undefined;
    const hit = table[norm];
    if (!hit || !valid.has(hit) || used.has(hit)) return '';
    used.add(hit);
    return hit;
  });
  return out.map((m, i) => {
    if (m !== undefined) return m;
    const f = fallback[i];
    if (!f || used.has(f)) return '';
    used.add(f);
    return f;
  });
}

/** Mapeo del preset HubSpot (atajo de presetColumnsMapping). */
export function hubspotMapping(
  headers: string[],
  entity: ImportEntity,
  customFields: MappableCustomField[] = [],
): string[] {
  return presetColumnsMapping('hubspot', headers, entity, customFields);
}

/**
 * Ajustes de una fila mapeada antes de mandarla: "Nombre completo" se parte en
 * nombre y apellido (si no vinieron aparte) y las celdas con varios emails o
 * dominios ("a@x.com, b@y.com", como exportan Attio y Close) quedan con el primero.
 */
export function finalizeRow(row: Record<string, string>): Record<string, string> {
  const out = { ...row };
  if (out.fullName !== undefined) {
    const parts = out.fullName.trim().split(/\s+/).filter(Boolean);
    if (!out.firstName && parts.length) out.firstName = parts[0];
    if (!out.lastName && parts.length > 1) out.lastName = parts.slice(1).join(' ');
    delete out.fullName;
  }
  for (const key of ['email', 'domain', 'companyDomain'] as const) {
    if (out[key]) out[key] = out[key].split(/[,;\s]+/).filter(Boolean)[0] ?? '';
  }
  return out;
}

/** Aplica un preset guardado ({ header: campo }) a los headers actuales. */
export function presetMapping(headers: string[], mapping: Record<string, string>, valid: string[]): string[] {
  const allowed = new Set(valid);
  const byNorm = new Map(Object.entries(mapping).map(([h, f]) => [normHeader(h), f]));
  return headers.map((h) => {
    const f = mapping[h] ?? byNorm.get(normHeader(h)) ?? '';
    return allowed.has(f) ? f : '';
  });
}

/** Mapeo actual como objeto { header: campo } (para guardar un preset). */
export function mappingToObject(headers: string[], mapping: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((h, i) => {
    if (mapping[i]) out[h] = mapping[i];
  });
  return out;
}

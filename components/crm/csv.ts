/**
 * Import CSV — parser y auto-mapeo (módulo puro, sin React, testeable con tsx).
 * Lo usa ImportPanel; no importar desde server code.
 */

export type ImportEntity = 'contacts' | 'companies';

export const IMPORT_FIELDS: Record<ImportEntity, string[]> = {
  contacts: [
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
  ],
};

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

/** Auto-mapeo header → campo destino por alias; '' si no hay match. */
export function guessMapping(headers: string[], entity: ImportEntity): string[] {
  const valid = new Set(IMPORT_FIELDS[entity]);
  return headers.map((h) => {
    const norm = h.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    const hit = ALIASES[norm];
    return hit && valid.has(hit) ? hit : '';
  });
}

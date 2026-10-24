/**
 * CRM — datos de una empresa a partir de su dominio. Server-only.
 *
 * Dos fuentes, en este orden:
 * 1. El sitio de la empresa (siempre): meta tags, JSON-LD Organization y
 *    links a redes (lib/crm-site-profile.ts), bajado con safeFetch.
 * 2. Un proveedor externo opcional para lo que los sitios casi nunca
 *    publican (rubro, cantidad de empleados, ubicación): People Data Labs
 *    Company Enrichment si está CRM_ENRICH_PDL_API_KEY.
 *
 * CRM_ENRICH_FAKE=1 (tests) no sale a internet: usa un HTML fijo por dominio
 * que pasa por el mismo parser y un proveedor falso.
 *
 * enrichCompany completa solo los campos vacíos (salvo overwrite) y pasa por
 * updateCompany: queda en el historial y dispara los workflows como una
 * edición a mano.
 */
import { getDb, type CrmCompanyRow } from './db';
import { nameFromDomain, normalizeCompanyDomain } from './crm-domain';
import { parseSiteProfile, type SiteProfile } from './crm-site-profile';
import { fetchHome } from './crm-logos';
import { updateCompany, type CompanyInput } from './crm';

export interface CompanyEnrichment {
  domain: string;
  name: string;
  website: string;
  description: string;
  phone: string;
  industry: string;
  employees: number | null;
  foundedYear: number | null;
  city: string;
  country: string;
  linkedin: string;
  twitter: string;
  facebook: string;
  instagram: string;
  /** De dónde salió cada dato ('site' siempre que el sitio respondió). */
  sources: Array<'site' | 'provider'>;
}

export type ProviderData = Partial<Omit<CompanyEnrichment, 'domain' | 'website' | 'sources'>>;

export function enrichProviderName(): 'pdl' | 'fake' | null {
  if (process.env.CRM_ENRICH_FAKE === '1') return 'fake';
  if (process.env.CRM_ENRICH_PDL_API_KEY) return 'pdl';
  return null;
}

/** HTML fijo para CRM_ENRICH_FAKE (sin red): ejercita el mismo parser. */
export function fakeHomeHtml(domain: string): string {
  const name = nameFromDomain(domain);
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name,
    description: `${name} builds tools for small teams.`,
    telephone: '+1 415 555 0100',
    foundingDate: '2015-03-01',
    address: { '@type': 'PostalAddress', addressLocality: 'Austin', addressCountry: 'US' },
    sameAs: [`https://www.linkedin.com/company/${domain.split('.')[0]}`, `https://x.com/${domain.split('.')[0]}`],
  };
  return `<!doctype html><html><head><title>${name} | Home</title>
<meta property="og:site_name" content="${name}">
<meta name="description" content="${name} builds tools for small teams.">
<script type="application/ld+json">${JSON.stringify(ld)}</script></head>
<body><a href="https://www.facebook.com/${domain.split('.')[0]}">Facebook</a></body></html>`;
}

/** URL de PDL sin protocolo ("linkedin.com/company/x") → https://… */
function withScheme(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) return '';
  const s = v.trim();
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/** Respuesta de PDL Company Enrichment → campos nuestros. Puro. */
export function mapPdlCompany(json: Record<string, unknown>): ProviderData {
  const loc = (json.location && typeof json.location === 'object' ? json.location : {}) as Record<string, unknown>;
  const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const count = typeof json.employee_count === 'number' ? json.employee_count : null;
  const sizeMin = typeof json.size === 'string' ? Number(json.size.match(/\d+/)?.[0] ?? NaN) : NaN;
  const industry = str(json.industry, 120);
  return {
    name: str(json.display_name, 120) || str(json.name, 120),
    description: str(json.summary, 500) || str(json.headline, 500),
    industry: industry ? industry.charAt(0).toUpperCase() + industry.slice(1) : '',
    employees: count ?? (Number.isFinite(sizeMin) ? sizeMin : null),
    foundedYear: typeof json.founded === 'number' ? json.founded : null,
    city: str(loc.locality, 120).replace(/\b\w/g, (c) => c.toUpperCase()),
    country: str(loc.country, 120).replace(/\b\w/g, (c) => c.toUpperCase()),
    linkedin: withScheme(json.linkedin_url),
    twitter: withScheme(json.twitter_url),
    facebook: withScheme(json.facebook_url),
  };
}

/** Proveedor externo (null si no hay ninguno configurado o no conoce el dominio). */
export async function providerLookup(domain: string): Promise<ProviderData | null> {
  const provider = enrichProviderName();
  if (provider === 'fake') {
    return { industry: 'Software', employees: 120, city: 'Austin', country: 'United States' };
  }
  if (provider !== 'pdl') return null;
  try {
    const url = `https://api.peopledatalabs.com/v5/company/enrich?website=${encodeURIComponent(domain)}`;
    const res = await fetch(url, {
      headers: { 'X-Api-Key': process.env.CRM_ENRICH_PDL_API_KEY ?? '', accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return json ? mapPdlCompany(json) : null;
  } catch {
    return null;
  }
}

/** Une sitio y proveedor: el sitio manda en lo que publica, el proveedor completa el resto. Puro. */
export function mergeEnrichment(domain: string, site: SiteProfile | null, provider: ProviderData | null): CompanyEnrichment {
  const pick = <K extends keyof ProviderData>(k: K, fromSite: CompanyEnrichment[K] | undefined): CompanyEnrichment[K] => {
    const s = fromSite;
    if (s !== undefined && s !== null && s !== '') return s;
    const p = provider?.[k] as CompanyEnrichment[K] | undefined;
    return (p ?? (typeof s === 'number' || s === null ? null : '')) as CompanyEnrichment[K];
  };
  const sources: CompanyEnrichment['sources'] = [];
  if (site) sources.push('site');
  if (provider && Object.values(provider).some((v) => v !== '' && v !== null && v !== undefined)) sources.push('provider');
  return {
    domain,
    website: `https://${domain}`,
    name: pick('name', site?.name) || nameFromDomain(domain),
    description: pick('description', site?.description),
    phone: pick('phone', site?.phone),
    industry: pick('industry', site?.industry),
    employees: pick('employees', site?.employees ?? null),
    foundedYear: pick('foundedYear', site?.foundedYear ?? null),
    city: pick('city', site?.city),
    country: pick('country', site?.country),
    linkedin: pick('linkedin', site?.linkedin),
    twitter: pick('twitter', site?.twitter),
    facebook: pick('facebook', site?.facebook),
    instagram: pick('instagram', site?.instagram),
    sources,
  };
}

/** Todo lo que se sabe del dominio (sitio + proveedor). null = dominio inválido. */
export async function enrichDomain(rawDomain: string): Promise<CompanyEnrichment | null> {
  const domain = normalizeCompanyDomain(rawDomain);
  if (!domain) return null;
  const fake = enrichProviderName() === 'fake';
  const [home, provider] = await Promise.all([
    fake ? Promise.resolve({ html: fakeHomeHtml(domain), url: `https://${domain}/` }) : fetchHome(domain),
    providerLookup(domain),
  ]);
  const site = home ? parseSiteProfile(home.html, home.url) : null;
  return mergeEnrichment(domain, site, provider);
}

/** Campos de la empresa que completa el enrichment, en orden de la ficha. */
export const ENRICH_FIELDS = [
  'name',
  'website',
  'description',
  'phone',
  'industry',
  'employees',
  'foundedYear',
  'city',
  'country',
  'linkedinUrl',
  'twitterUrl',
  'facebookUrl',
  'instagramUrl',
] as const;
export type EnrichField = (typeof ENRICH_FIELDS)[number];

const FIELD_COLUMN: Record<EnrichField, keyof CrmCompanyRow> = {
  name: 'name',
  website: 'website',
  description: 'description',
  phone: 'phone',
  industry: 'industry',
  employees: 'employees',
  foundedYear: 'founded_year',
  city: 'city',
  country: 'country',
  linkedinUrl: 'linkedin_url',
  twitterUrl: 'twitter_url',
  facebookUrl: 'facebook_url',
  instagramUrl: 'instagram_url',
};

function valueFor(e: CompanyEnrichment, f: EnrichField): string | number | null {
  switch (f) {
    case 'linkedinUrl':
      return e.linkedin;
    case 'twitterUrl':
      return e.twitter;
    case 'facebookUrl':
      return e.facebook;
    case 'instagramUrl':
      return e.instagram;
    default:
      return e[f];
  }
}

/** Patch con lo que falta en la empresa (o todo, con overwrite). Puro. */
export function enrichmentPatch(
  company: Partial<CrmCompanyRow>,
  e: CompanyEnrichment,
  overwrite = false,
): { patch: CompanyInput; filled: EnrichField[] } {
  const patch: Record<string, unknown> = {};
  const filled: EnrichField[] = [];
  for (const f of ENRICH_FIELDS) {
    const next = valueFor(e, f);
    if (next === null || next === '') continue;
    const current = company[FIELD_COLUMN[f]];
    const empty = current === null || current === undefined || current === '';
    if (!empty && (!overwrite || current === next)) continue;
    patch[f] = next;
    filled.push(f);
  }
  return { patch: patch as CompanyInput, filled };
}

/** ¿Completar la empresa recién creada? Si tiene dominio (CRM_ENRICH_ON_CREATE=0 lo apaga). */
export function shouldEnrichOnCreate(company: Pick<CrmCompanyRow, 'domain' | 'website'>): boolean {
  if (process.env.CRM_ENRICH_ON_CREATE === '0') return false;
  return !!normalizeCompanyDomain(company.domain || company.website);
}

export type EnrichCompanyResult =
  | { ok: true; company: CrmCompanyRow; filled: EnrichField[]; sources: CompanyEnrichment['sources'] }
  | { ok: false; reason: 'not_found' | 'no_domain' };

/** Completa una empresa desde su dominio (al crearla y a pedido desde la ficha). */
export async function enrichCompany(
  workspaceId: string,
  companyId: string,
  opts: { overwrite?: boolean; actorEmail?: string } = {},
): Promise<EnrichCompanyResult> {
  const db = getDb();
  const company = (await db.prepare('SELECT * FROM crm_companies WHERE id = ? AND user_id = ?').get(companyId, workspaceId)) as
    | CrmCompanyRow
    | undefined;
  if (!company) return { ok: false, reason: 'not_found' };
  const domain = normalizeCompanyDomain(company.domain || company.website);
  if (!domain) return { ok: false, reason: 'no_domain' };
  const e = await enrichDomain(domain);
  if (!e) return { ok: false, reason: 'no_domain' };
  const { patch, filled } = enrichmentPatch(company, e, opts.overwrite);
  // El nombre que alguien escribió no se pisa, ni con overwrite.
  if (company.name && patch.name !== undefined) {
    delete patch.name;
    filled.splice(filled.indexOf('name'), 1);
  }
  if (!company.domain) (patch as Record<string, unknown>).domain = domain;
  const updated = Object.keys(patch).length
    ? await updateCompany(workspaceId, companyId, patch, undefined, opts.actorEmail ?? '')
    : company;
  await db
    .prepare("UPDATE crm_companies SET enriched_at = datetime('now') WHERE id = ?")
    .run(companyId);
  const fresh = (await db.prepare('SELECT * FROM crm_companies WHERE id = ?').get(companyId)) as CrmCompanyRow;
  return { ok: true, company: fresh ?? updated ?? company, filled, sources: e.sources };
}

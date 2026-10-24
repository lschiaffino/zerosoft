/**
 * CRM — perfil de una empresa a partir del HTML de su sitio (puro: sin red).
 *
 * Lo básico de parseSiteMeta (nombre, descripción, teléfono, íconos) más el
 * bloque JSON-LD Organization que publican muchos sitios (descripción,
 * teléfono, dirección, cantidad de empleados, año de fundación, rubro, logo y
 * sameAs) y los perfiles de redes enlazados en la página.
 */
import { clean, decodeEntities, parseSiteMeta, type SiteMeta } from './crm-domain';

export interface SiteProfile extends SiteMeta {
  industry: string;
  employees: number | null;
  foundedYear: number | null;
  city: string;
  country: string;
  linkedin: string;
  twitter: string;
  facebook: string;
  instagram: string;
}

export const SOCIAL_KEYS = ['linkedin', 'twitter', 'facebook', 'instagram'] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];

/** Perfiles de redes que se reconocen en los links del sitio. */
const SOCIAL_RE: Record<SocialKey, RegExp> = {
  linkedin: /^https?:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\/(company|school|showcase)\/[^/?#\s"']+/i,
  twitter: /^https?:\/\/(www\.|mobile\.)?(twitter|x)\.com\/(?!intent\b|share\b|home\b|search\b|hashtag\b)[A-Za-z0-9_]{1,30}(?=[/?#]|$)/i,
  facebook: /^https?:\/\/(www\.|m\.|[a-z]{2}-[a-z]{2}\.)?facebook\.com\/(?!sharer|share\b|dialog\b|plugins\b|tr\b)[^/?#\s"']+/i,
  instagram: /^https?:\/\/(www\.)?instagram\.com\/(?!p\/|reel\/|explore\b)[A-Za-z0-9_.]{1,30}(?=[/?#]|$)/i,
};

/** Link de red social normalizado (https, sin query ni barra final); '' si no es un perfil. */
export function socialProfile(url: string, key: SocialKey): string {
  const m = url.trim().match(SOCIAL_RE[key]);
  return m ? m[0].replace(/\/+$/, '').replace(/^http:/i, 'https:') : '';
}

/** Objetos JSON-LD del HTML (aplana @graph y listas). Tolera JSON roto. */
export function jsonLdObjects(html: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const push = (v: unknown, depth = 0) => {
    if (depth > 4) return;
    if (Array.isArray(v)) v.forEach((x) => push(x, depth + 1));
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      out.push(o);
      if (Array.isArray(o['@graph'])) (o['@graph'] as unknown[]).forEach((x) => push(x, depth + 1));
    }
  };
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.slice(0, 600_000).matchAll(re)) {
    try {
      push(JSON.parse(m[1].trim()));
    } catch {
      // JSON-LD inválido: se ignora ese bloque.
    }
  }
  return out;
}

const ORG_TYPE = /(Organization|Corporation|Business|NGO|Store|ProfessionalService)$/;

function typesOf(o: Record<string, unknown>): string[] {
  const t = o['@type'];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string');
}

function text(v: unknown, max = 200): string {
  if (typeof v === 'string') return clean(v, max);
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.length ? text(v[0], max) : '';
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return text(o.name ?? o['@value'] ?? o.url ?? '', max);
  }
  return '';
}

/** "51-200", 120, {value: 120}, {minValue: 11, maxValue: 50} → un número (el primero del rango). */
export function employeesFrom(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  if (typeof v === 'string') {
    const m = v.replace(/(\d)[,.](?=\d{3}\b)/g, '$1').match(/\d+/);
    return m ? Number(m[0]) : null;
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return employeesFrom(o.value ?? o.minValue ?? o.maxValue);
  }
  return null;
}

function yearFrom(v: unknown): number | null {
  const m = text(v).match(/\b(1[6-9]\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

export function parseSiteProfile(html: string, baseUrl: string): SiteProfile {
  const base = parseSiteMeta(html, baseUrl);
  const out: SiteProfile = {
    ...base,
    industry: '',
    employees: null,
    foundedYear: null,
    city: '',
    country: '',
    linkedin: '',
    twitter: '',
    facebook: '',
    instagram: '',
  };
  const links: string[] = [];
  const org = jsonLdObjects(html).find((o) => typesOf(o).some((t) => ORG_TYPE.test(t)));
  if (org) {
    const name = text(org.name ?? org.legalName, 120);
    if (name && !out.name) out.name = name;
    const description = text(org.description, 500);
    if (description && !out.description) out.description = description;
    const phone = text(org.telephone, 40);
    if (phone && !out.phone) out.phone = phone;
    out.industry = text(org.industry, 120);
    out.employees = employeesFrom(org.numberOfEmployees);
    out.foundedYear = yearFrom(org.foundingDate);
    const addr = Array.isArray(org.address) ? org.address[0] : org.address;
    if (addr && typeof addr === 'object') {
      const a = addr as Record<string, unknown>;
      out.city = text(a.addressLocality, 120);
      out.country = text(a.addressCountry, 120);
    }
    const logo = text(org.logo, 2000);
    if (logo) {
      try {
        const u = new URL(logo, baseUrl);
        if (u.protocol === 'https:' || u.protocol === 'http:') {
          out.icons = [u.toString(), ...out.icons.filter((i) => i !== u.toString())].slice(0, 5);
        }
      } catch {
        // logo inválido
      }
    }
    for (const s of Array.isArray(org.sameAs) ? org.sameAs : [org.sameAs]) if (typeof s === 'string') links.push(s);
  }
  for (const m of html.slice(0, 600_000).matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)) links.push(decodeEntities(m[1]));
  for (const key of SOCIAL_KEYS) {
    for (const l of links) {
      const p = socialProfile(l, key);
      if (p) {
        out[key] = p;
        break;
      }
    }
  }
  return out;
}

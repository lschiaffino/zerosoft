import { randomBytes } from 'crypto';
import { lookup, resolveCname, resolveTxt } from 'dns/promises';
import { getDb } from './db';
import { isAppHost, isValidHostname, normalizeHost } from './hosts';

/**
 * Dominios propios para Link (go.tuempresa.com/promo). En Vercel se agregan al
 * proyecto vía API (VERCEL_TOKEN + VERCEL_PROJECT_ID [+ VERCEL_TEAM_ID]) y
 * Vercel emite el certificado; en self-host se verifica por DNS que el dominio
 * apunte a este servidor. En ambos casos la propiedad se prueba con un TXT
 * con un token por dominio (_zerosoft-verify.<host>): apuntar el CNAME no
 * alcanza (un CNAME colgante de otro dueño se podría reclamar).
 */

export interface LinkDomainRow {
  id: string;
  user_id: string;
  hostname: string;
  verified: number;
  verified_at: string | null;
  root_url: string | null;
  /** Token del TXT de propiedad (null en dominios verificados antes del TXT). */
  verify_token: string | null;
  created_at: string;
}

export interface DnsInstruction {
  type: 'CNAME' | 'A' | 'TXT';
  name: string;
  value: string;
}

const VERCEL_API = 'https://api.vercel.com';

/** Un dominio sin verificar se libera después de estos días (anti-squatting). */
export const UNVERIFIED_TTL_DAYS = 7;

export const VERIFY_PREFIX = '_zerosoft-verify';

function newVerifyToken(): string {
  return randomBytes(16).toString('hex');
}

/** Valor del TXT de propiedad. */
export function verifyTxtValue(token: string): string {
  return `zerosoft-verify=${token}`;
}

function vercelConfigured(): boolean {
  return Boolean(process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID);
}

function vercelQuery(): string {
  return process.env.VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : '';
}

async function vercel(path: string, init: RequestInit = {}): Promise<Response | null> {
  return fetch(`${VERCEL_API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${process.env.VERCEL_TOKEN}`, 'content-type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
}

/**
 * Sufijos públicos de dos niveles (com.ar, com.br, co.uk…): el dominio
 * registrable tiene un label más. Sin la Public Suffix List completa, cubre
 * el patrón <com|net|org|…>.<ccTLD> de los mercados principales.
 */
const SECOND_LEVEL = new Set(['com', 'net', 'org', 'gob', 'gov', 'edu', 'co', 'ac', 'mil', 'nom', 'int', 'ltd', 'plc', 'or', 'ne', 'go']);

/** Dominio registrable (la zona DNS donde el usuario crea los registros). */
export function registrableDomain(hostname: string): string {
  const labels = hostname.split('.');
  const n = labels.length;
  const multi = n >= 3 && labels[n - 1].length === 2 && SECOND_LEVEL.has(labels[n - 2]);
  return labels.slice(-(multi ? 3 : 2)).join('.');
}

/** Nombre del registro relativo a la zona: '' en el apex, 'links.go' en links.go.empresa.com. */
function recordLabel(hostname: string): string {
  const zone = registrableDomain(hostname);
  return hostname === zone ? '' : hostname.slice(0, -(zone.length + 1));
}

function routingInstruction(hostname: string): DnsInstruction {
  const appHost = (process.env.SHORT_DOMAIN ?? process.env.NEXTAUTH_URL ?? 'zerosoft.ai').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const label = recordLabel(hostname);
  if (vercelConfigured()) {
    return label
      ? { type: 'CNAME', name: label, value: 'cname.vercel-dns.com' }
      : { type: 'A', name: '@', value: '76.76.21.21' };
  }
  return { type: 'CNAME', name: label || '@', value: appHost };
}

/** Qué registros DNS tiene que crear el usuario: el que apunta a nosotros y el TXT de propiedad. */
export function dnsInstructions(hostname: string, token?: string | null): DnsInstruction[] {
  const out = [routingInstruction(hostname)];
  if (token) {
    out.push({
      type: 'TXT',
      name: [VERIFY_PREFIX, recordLabel(hostname)].filter(Boolean).join('.'),
      value: verifyTxtValue(token),
    });
  }
  return out;
}

export async function listDomains(userId: string): Promise<LinkDomainRow[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM link_domains WHERE user_id = ? ORDER BY created_at ASC')
    .all(userId)) as LinkDomainRow[];
  // Pendientes de antes del TXT: se les asigna token para poder verificarlos.
  for (const row of rows) {
    if (row.verified !== 1 && !row.verify_token) row.verify_token = await ensureVerifyToken(row);
  }
  return rows;
}

async function ensureVerifyToken(domain: LinkDomainRow): Promise<string> {
  if (domain.verify_token) return domain.verify_token;
  const token = newVerifyToken();
  await getDb()
    .prepare('UPDATE link_domains SET verify_token = COALESCE(verify_token, ?) WHERE id = ?')
    .run(token, domain.id);
  const row = (await getDb().prepare('SELECT verify_token FROM link_domains WHERE id = ?').get(domain.id)) as
    | { verify_token: string | null }
    | undefined;
  return row?.verify_token ?? token;
}

/** El TXT _zerosoft-verify.<host> tiene el token del dominio. */
async function hasOwnershipTxt(hostname: string, token: string): Promise<boolean> {
  const records = await resolveTxt(`${VERIFY_PREFIX}.${hostname}`).catch(() => [] as string[][]);
  const expected = verifyTxtValue(token);
  return records.some((chunks) => chunks.join('').trim() === expected);
}

export async function getUserDomain(userId: string, id: string): Promise<LinkDomainRow | undefined> {
  return (await getDb()
    .prepare('SELECT * FROM link_domains WHERE id = ? AND user_id = ?')
    .get(id, userId)) as LinkDomainRow | undefined;
}

/** Dominio verificado servido por este host (para resolver /slug en un dominio propio). */
export async function getVerifiedDomainByHost(host: string): Promise<LinkDomainRow | undefined> {
  const h = normalizeHost(host).replace(/:\d+$/, '');
  return (await getDb()
    .prepare('SELECT * FROM link_domains WHERE hostname = ? AND verified = 1')
    .get(h)) as LinkDomainRow | undefined;
}

export type AddDomainError = 'invalid_hostname' | 'domain_taken' | 'app_host' | 'provider_error';

export async function addDomain(
  userId: string,
  rawHostname: string,
): Promise<{ ok: true; domain: LinkDomainRow } | { ok: false; code: AddDomainError }> {
  const hostname = normalizeHost(rawHostname).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!isValidHostname(hostname)) return { ok: false, code: 'invalid_hostname' };
  if (isAppHost(hostname)) return { ok: false, code: 'app_host' };
  // Un alta que nunca se verificó no bloquea el dominio para siempre.
  await getDb()
    .prepare(
      `DELETE FROM link_domains WHERE hostname = ? AND verified = 0 AND created_at < datetime('now', ?)`,
    )
    .run(hostname, `-${UNVERIFIED_TTL_DAYS} days`);
  const existing = await getDb().prepare('SELECT 1 AS x FROM link_domains WHERE hostname = ?').get(hostname);
  if (existing) return { ok: false, code: 'domain_taken' };

  if (vercelConfigured()) {
    const res = await vercel(`/v10/projects/${process.env.VERCEL_PROJECT_ID}/domains${vercelQuery()}`, {
      method: 'POST',
      body: JSON.stringify({ name: hostname }),
    });
    if (!res) return { ok: false, code: 'provider_error' };
    if (!res.ok) {
      // 409 puede ser "ya está en este proyecto" (reintento) o "es de otro
      // proyecto/cuenta": solo se acepta si el dominio figura en el nuestro.
      if (res.status !== 409) return { ok: false, code: 'provider_error' };
      const mine = await vercel(
        `/v9/projects/${process.env.VERCEL_PROJECT_ID}/domains/${encodeURIComponent(hostname)}${vercelQuery()}`,
      );
      if (!mine?.ok) return { ok: false, code: 'provider_error' };
    }
  }

  const id = crypto.randomUUID();
  await getDb()
    .prepare('INSERT INTO link_domains (id, user_id, hostname, verify_token) VALUES (?, ?, ?, ?)')
    .run(id, userId, hostname, newVerifyToken());
  return { ok: true, domain: (await getUserDomain(userId, id))! };
}

/** Verifica el DNS (y en Vercel, la config del proyecto). Marca verified si está listo. */
export async function verifyDomain(userId: string, id: string): Promise<{ verified: boolean; reason?: string }> {
  const domain = await getUserDomain(userId, id);
  if (!domain) return { verified: false, reason: 'not_found' };
  if (domain.verified === 1) return { verified: true };
  let ok = false;
  let reason: string | undefined;

  // Propiedad: el TXT con el token del dominio. Sin esto no se verifica nada.
  const token = await ensureVerifyToken(domain);
  if (!(await hasOwnershipTxt(domain.hostname, token))) return { verified: false, reason: 'txt_missing' };

  if (vercelConfigured()) {
    const res = await vercel(`/v6/domains/${encodeURIComponent(domain.hostname)}/config${vercelQuery()}`);
    const cfg = res?.ok ? ((await res.json().catch(() => null)) as { misconfigured?: boolean } | null) : null;
    // Además, Vercel tiene que dar el dominio por verificado en el proyecto.
    const projectPath = `/v9/projects/${process.env.VERCEL_PROJECT_ID}/domains/${encodeURIComponent(domain.hostname)}`;
    const pd = await vercel(`${projectPath}${vercelQuery()}`);
    let projectVerified = pd?.ok ? ((await pd.json().catch(() => null)) as { verified?: boolean } | null)?.verified : false;
    if (projectVerified === false && pd?.ok) {
      const v = await vercel(`${projectPath}/verify${vercelQuery()}`, { method: 'POST' });
      projectVerified = v?.ok ? ((await v.json().catch(() => null)) as { verified?: boolean } | null)?.verified : false;
    }
    ok = cfg?.misconfigured === false && projectVerified === true;
    if (!ok) reason = 'dns_not_ready';
  } else {
    const target = routingInstruction(domain.hostname).value;
    const cnames = await resolveCname(domain.hostname).catch(() => [] as string[]);
    if (cnames.some((c) => c.replace(/\.$/, '') === target)) ok = true;
    else {
      const [mine, theirs] = await Promise.all([
        lookup(target, { all: true }).catch(() => []),
        lookup(domain.hostname, { all: true }).catch(() => []),
      ]);
      const mineSet = new Set(mine.map((a) => a.address));
      ok = theirs.length > 0 && theirs.every((a) => mineSet.has(a.address));
      if (!ok) reason = 'dns_not_ready';
    }
  }

  if (ok && domain.verified !== 1) {
    await getDb()
      .prepare('UPDATE link_domains SET verified = 1, verified_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }
  return { verified: ok, reason };
}

/** No se borra un dominio con links (dejarían de resolver o chocarían con otros slugs). */
export async function deleteDomain(
  userId: string,
  id: string,
): Promise<{ ok: true } | { ok: false; code: 'not_found' | 'has_links' }> {
  const domain = await getUserDomain(userId, id);
  if (!domain) return { ok: false, code: 'not_found' };
  const used = await getDb().prepare('SELECT 1 AS x FROM links WHERE domain_id = ? LIMIT 1').get(id);
  if (used) return { ok: false, code: 'has_links' };
  if (vercelConfigured()) {
    await vercel(`/v9/projects/${process.env.VERCEL_PROJECT_ID}/domains/${encodeURIComponent(domain.hostname)}${vercelQuery()}`, {
      method: 'DELETE',
    });
  }
  await getDb().prepare('DELETE FROM link_domains WHERE id = ?').run(id);
  return { ok: true };
}

export async function setDomainRootUrl(userId: string, id: string, rootUrl: string | null): Promise<boolean> {
  const res = await getDb()
    .prepare('UPDATE link_domains SET root_url = ? WHERE id = ? AND user_id = ?')
    .run(rootUrl, id, userId);
  return res.changes > 0;
}

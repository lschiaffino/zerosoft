import { lookup, resolveCname } from 'dns/promises';
import { getDb } from './db';
import { isAppHost, isValidHostname, normalizeHost } from './hosts';

/**
 * Dominios propios para Link (go.tuempresa.com/promo). En Vercel se agregan al
 * proyecto vía API (VERCEL_TOKEN + VERCEL_PROJECT_ID [+ VERCEL_TEAM_ID]) y
 * Vercel emite el certificado; en self-host se verifica por DNS que el dominio
 * apunte a este servidor.
 */

export interface LinkDomainRow {
  id: string;
  user_id: string;
  hostname: string;
  verified: number;
  verified_at: string | null;
  root_url: string | null;
  created_at: string;
}

export interface DnsInstruction {
  type: 'CNAME' | 'A';
  name: string;
  value: string;
}

const VERCEL_API = 'https://api.vercel.com';

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

function isApex(hostname: string): boolean {
  return hostname.split('.').length === 2;
}

/** Qué registro DNS tiene que crear el usuario. */
export function dnsInstructions(hostname: string): DnsInstruction[] {
  const appHost = (process.env.SHORT_DOMAIN ?? process.env.NEXTAUTH_URL ?? 'zerosoft.ai').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (vercelConfigured()) {
    return isApex(hostname)
      ? [{ type: 'A', name: '@', value: '76.76.21.21' }]
      : [{ type: 'CNAME', name: hostname.split('.')[0], value: 'cname.vercel-dns.com' }];
  }
  return [{ type: 'CNAME', name: isApex(hostname) ? '@' : hostname.split('.')[0], value: appHost }];
}

export async function listDomains(userId: string): Promise<LinkDomainRow[]> {
  return (await getDb()
    .prepare('SELECT * FROM link_domains WHERE user_id = ? ORDER BY created_at ASC')
    .all(userId)) as LinkDomainRow[];
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
  const existing = await getDb().prepare('SELECT 1 AS x FROM link_domains WHERE hostname = ?').get(hostname);
  if (existing) return { ok: false, code: 'domain_taken' };

  if (vercelConfigured()) {
    const res = await vercel(`/v10/projects/${process.env.VERCEL_PROJECT_ID}/domains${vercelQuery()}`, {
      method: 'POST',
      body: JSON.stringify({ name: hostname }),
    });
    // 409 = ya está en el proyecto (reintento): se acepta.
    if (!res || (!res.ok && res.status !== 409)) return { ok: false, code: 'provider_error' };
  }

  const id = crypto.randomUUID();
  await getDb().prepare('INSERT INTO link_domains (id, user_id, hostname) VALUES (?, ?, ?)').run(id, userId, hostname);
  return { ok: true, domain: (await getUserDomain(userId, id))! };
}

/** Verifica el DNS (y en Vercel, la config del proyecto). Marca verified si está listo. */
export async function verifyDomain(userId: string, id: string): Promise<{ verified: boolean; reason?: string }> {
  const domain = await getUserDomain(userId, id);
  if (!domain) return { verified: false, reason: 'not_found' };
  let ok = false;
  let reason: string | undefined;

  if (vercelConfigured()) {
    const res = await vercel(`/v6/domains/${encodeURIComponent(domain.hostname)}/config${vercelQuery()}`);
    const cfg = res?.ok ? ((await res.json().catch(() => null)) as { misconfigured?: boolean } | null) : null;
    ok = cfg?.misconfigured === false;
    if (!ok) reason = 'dns_not_ready';
  } else {
    const target = dnsInstructions(domain.hostname)[0].value;
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

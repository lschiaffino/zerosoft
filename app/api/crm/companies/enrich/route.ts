import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { fetchSiteInfo } from '@/lib/crm-logos';
import { rateLimit } from '@/lib/rate-limit';
import { crmError, unauthorized } from '@/lib/crm-http';
import { getDb } from '@/lib/db';
import { normalizeCompanyDomain } from '@/lib/crm-domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Datos básicos de una empresa a partir de su dominio (?domain=): nombre,
 * sitio y teléfono que publica la home. Además avisa si ya hay una empresa
 * con ese dominio en el workspace (para no crear un duplicado).
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const domain = normalizeCompanyDomain(req.nextUrl.searchParams.get('domain'));
  if (!domain) return crmError(400, 'invalid_input');
  if (process.env.RATE_LIMIT_DISABLED !== 'true' && !(await rateLimit(`crm-enrich:${user.id}`, 60, 3600)).ok) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const existing = (await getDb()
    .prepare(
      `SELECT id, name FROM crm_companies WHERE user_id = ?
         AND (lower(domain) = ? OR lower(domain) = ? OR lower(domain) LIKE ? OR lower(domain) LIKE ?) LIMIT 1`,
    )
    .get(user.id, domain, `www.${domain}`, `%//${domain}%`, `%//www.${domain}%`)) as { id: string; name: string } | undefined;
  const info = await fetchSiteInfo(domain);
  return NextResponse.json({
    domain,
    name: info?.name ?? '',
    website: info?.website ?? `https://${domain}`,
    phone: info?.phone ?? '',
    description: info?.description ?? '',
    existing: existing ?? null,
  });
}

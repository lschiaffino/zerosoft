import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { enrichDomain } from '@/lib/crm-enrich';
import { rateLimit } from '@/lib/rate-limit';
import { crmError, unauthorized } from '@/lib/crm-http';
import { getDb } from '@/lib/db';
import { normalizeCompanyDomain } from '@/lib/crm-domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Datos de una empresa a partir de su dominio (?domain=): nombre, sitio,
 * teléfono, descripción, redes, dirección, rubro y tamaño (lib/crm-enrich.ts:
 * el sitio y, si está configurado, un proveedor externo). Además avisa si ya hay una empresa
 * con ese dominio en el workspace (para no crear un duplicado). Con ?check=1
 * solo hace eso último (sin ir al sitio): lo usan el aviso mientras se
 * escribe y el submit del alta rápida.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const domain = normalizeCompanyDomain(req.nextUrl.searchParams.get('domain'));
  if (!domain) return crmError(400, 'invalid_input');
  const checkOnly = req.nextUrl.searchParams.get('check') === '1';
  const bucket = checkOnly ? `crm-enrich-check:${user.id}` : `crm-enrich:${user.id}`;
  if (process.env.RATE_LIMIT_DISABLED !== 'true' && !(await rateLimit(bucket, checkOnly ? 600 : 60, 3600)).ok) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const existing = (await getDb()
    .prepare(
      `SELECT id, name FROM crm_companies WHERE user_id = ?
         AND (lower(domain) = ? OR lower(domain) = ? OR lower(domain) LIKE ? OR lower(domain) LIKE ?) LIMIT 1`,
    )
    .get(user.id, domain, `www.${domain}`, `%//${domain}%`, `%//www.${domain}%`)) as { id: string; name: string } | undefined;
  if (checkOnly) return NextResponse.json({ domain, existing: existing ?? null });
  const info = await enrichDomain(domain);
  return NextResponse.json({
    domain,
    name: info?.name ?? '',
    website: info?.website ?? `https://${domain}`,
    phone: info?.phone ?? '',
    description: info?.description ?? '',
    industry: info?.industry ?? '',
    employees: info?.employees ?? null,
    foundedYear: info?.foundedYear ?? null,
    city: info?.city ?? '',
    country: info?.country ?? '',
    linkedinUrl: info?.linkedin ?? '',
    twitterUrl: info?.twitter ?? '',
    facebookUrl: info?.facebook ?? '',
    instagramUrl: info?.instagram ?? '',
    sources: info?.sources ?? [],
    existing: existing ?? null,
  });
}

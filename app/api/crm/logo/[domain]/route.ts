import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { discoverLogo, getCompanyLogo } from '@/lib/crm-logos';
import { rateLimit } from '@/lib/rate-limit';
import { unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

class Limited extends Error {}

/**
 * Logo de una empresa por dominio (favicon del sitio, cacheado). 404 si el
 * sitio no tiene: la UI muestra las iniciales. Las búsquedas nuevas (no
 * cacheadas) se limitan por usuario.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ domain: string }> }) {
  const { domain } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  let logo;
  try {
    logo = await getCompanyLogo(decodeURIComponent(domain), {
      discover: async (d) => {
        if (process.env.RATE_LIMIT_DISABLED !== 'true' && !(await rateLimit(`crm-logo:${user.id}`, 200, 3600)).ok) {
          throw new Limited();
        }
        return discoverLogo(d);
      },
    });
  } catch (err) {
    if (err instanceof Limited) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    throw err;
  }
  if (!logo || logo.status !== 'ok' || !logo.data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'private, max-age=3600' } });
  }
  return new NextResponse(Buffer.from(logo.data), {
    headers: {
      'content-type': logo.contentType,
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff',
      // Un SVG de un sitio ajeno servido desde acá no puede correr scripts.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}

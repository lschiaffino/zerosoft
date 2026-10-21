import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { createLinksBulk, linkQuotaRemaining, parseBulkLines } from '@/lib/links';
import { viewerOf } from '@/lib/link-folders';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

// El CSV de resultados se arma en el cliente con lo que ya devolvió este POST:
// pedirlo acá volvería a crear todos los links (duplicados, cuota y rate limit).
const bulkSchema = z.object({
  /** Una fila por línea: `url` o `url, slug, título` (comas o tabs). */
  urls: z.string().min(1),
  domainId: z.string().max(64).nullish(),
  folderId: z.string().max(64).nullish(),
  tag: z.string().max(40).optional(),
  utmSource: z.string().max(100).optional(),
  utmMedium: z.string().max(100).optional(),
  utmCampaign: z.string().max(100).optional(),
});

export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, 'link-bulk', 10, 600);
  if (limited) return limited;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const urls = parseBulkLines(parsed.data.urls);

  if (urls.length === 0) {
    return NextResponse.json({ error: 'empty' }, { status: 400 });
  }
  if (urls.length > 200) {
    return NextResponse.json({ error: 'too_many' }, { status: 400 });
  }
  if ((await linkQuotaRemaining(user.id)) < urls.length) {
    return NextResponse.json({ error: 'quota_exceeded' }, { status: 429 });
  }

  const result = await createLinksBulk(user.id, {
    rows: urls,
    domainId: parsed.data.domainId ?? null,
    folderId: parsed.data.folderId ?? null,
    viewer: viewerOf(user),
    tag: parsed.data.tag,
    utmSource: parsed.data.utmSource,
    utmMedium: parsed.data.utmMedium,
    utmCampaign: parsed.data.utmCampaign,
    createdBy: realUserId(user),
  });

  return NextResponse.json({ results: result, total: urls.length, created: result.filter((r) => r.status === 'created').length }, { status: 201 });
}

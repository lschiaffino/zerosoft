import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { bulkResultsToCsv, createLinksBulk, linkQuotaRemaining } from '@/lib/links';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

const bulkSchema = z.object({
  urls: z.string().min(1),
  tag: z.string().max(40).optional(),
  utmSource: z.string().max(100).optional(),
  utmMedium: z.string().max(100).optional(),
  utmCampaign: z.string().max(100).optional(),
  download: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, 'link-bulk', 10, 600);
  if (limited) return limited;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const urls = parsed.data.urls
    .split('\n')
    .map((u) => u.trim())
    .filter(Boolean);

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
    urls,
    tag: parsed.data.tag,
    utmSource: parsed.data.utmSource,
    utmMedium: parsed.data.utmMedium,
    utmCampaign: parsed.data.utmCampaign,
  });

  if (parsed.data.download) {
    const csv = bulkResultsToCsv(result);
    return new NextResponse(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="links.csv"',
      },
    });
  }

  return NextResponse.json({ results: result, total: urls.length, created: result.filter((r) => r.status === 'created').length }, { status: 201 });
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { limitByIp } from '@/lib/rate-limit';
import { getCurrentUser } from '@/lib/session';
import { createLink, listLinks, toLinkDto } from '@/lib/links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

const createSchema = z.object({
  url: z.string().min(1),
  domainId: z.string().max(64).nullish(),
  slug: z.string().max(32).optional(),
  title: z.string().max(200).optional(),
  tags: z.array(z.string().max(40)).max(5).optional(),
  expiresAt: z.string().optional(),
  maxClicks: z.number().int().positive().optional(),
  password: z.string().min(1).max(100).optional(),
  redirectType: z.union([z.literal(301), z.literal(302)]).optional(),
  utmSource: z.string().max(100).optional(),
  utmMedium: z.string().max(100).optional(),
  utmCampaign: z.string().max(100).optional(),
  ogTitle: z.string().max(200).optional(),
  ogDescription: z.string().max(500).optional(),
  ogImage: z.string().max(500).optional(),
});

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const archived = sp.get('archived');
  const sort = sp.get('sort');
  const result = await listLinks(user.id, {
    q: sp.get('q') ?? undefined,
    tag: sp.get('tag') ?? undefined,
    archived: archived === '1' || archived === 'all' ? archived : '0',
    sort: sort === 'clicks' ? 'clicks' : 'created',
    page: Number(sp.get('page') ?? '1') || 1,
    pageSize: Number(sp.get('pageSize') ?? '10') || 10,
  });

  return NextResponse.json({
    links: result.links.map(toLinkDto),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  });
}

export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, 'link-create', 60, 60);
  if (limited) return limited;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_url' }, { status: 400 });

  const result = await createLink(user.id, parsed.data);
  if (!result.ok) {
    const status = result.code === 'slug_taken' ? 409 : result.code === 'quota_exceeded' ? 429 : 400;
    return NextResponse.json({ error: result.code }, { status });
  }
  return NextResponse.json(toLinkDto(result.link), { status: 201 });
}

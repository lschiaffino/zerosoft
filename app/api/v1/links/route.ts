import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { createLink, listLinks, toLinkDto } from '@/lib/links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  url: z.string().min(1),
  slug: z.string().max(32).optional(),
  title: z.string().max(200).optional(),
  tags: z.array(z.string().max(40)).max(5).optional(),
});

export async function POST(req: NextRequest) {
  const auth = requireApiUser(req);
  if ('res' in auth) return auth.res;

  const body: unknown = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return apiError(400, 'invalid_url', 'A valid "url" is required.');

  const result = createLink(auth.user.id, parsed.data);
  if (!result.ok) {
    const messages: Record<string, string> = {
      invalid_url: 'The destination URL is not valid.',
      invalid_slug: 'The slug is not valid (2–32 chars: a-z 0-9 - _).',
      slug_taken: 'That slug is already taken.',
      invalid_date: 'The expiration date is not valid.',
    };
    return apiError(400, result.code, messages[result.code]);
  }

  const dto = toLinkDto(result.link);
  return NextResponse.json(
    {
      id: dto.id,
      slug: dto.slug,
      short_url: dto.short_url,
      url: dto.url,
      title: dto.title,
      tags: dto.tags,
      created_at: dto.created_at,
    },
    { status: 201 },
  );
}

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req);
  if ('res' in auth) return auth.res;

  const sp = req.nextUrl.searchParams;
  const result = listLinks(auth.user.id, {
    archived: 'all',
    page: Number(sp.get('page') ?? '1') || 1,
    pageSize: Number(sp.get('pageSize') ?? '10') || 10,
  });

  return NextResponse.json({
    links: result.links.map((l) => {
      const dto = toLinkDto(l);
      return {
        id: dto.id,
        slug: dto.slug,
        short_url: dto.short_url,
        url: dto.url,
        title: dto.title,
        tags: dto.tags,
        clicks: dto.clicks,
        archived: dto.archived,
        created_at: dto.created_at,
      };
    }),
    total: result.total,
  });
}

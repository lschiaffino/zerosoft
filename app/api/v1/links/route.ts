import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { createLink, listLinks, toLinkDto } from '@/lib/links';
import { listDomains } from '@/lib/link-domains';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  url: z.string().min(1),
  /** Hostname de un dominio propio verificado (ej. go.empresa.com). */
  domain: z.string().max(253).optional(),
  slug: z.string().max(32).optional(),
  title: z.string().max(200).optional(),
  tags: z.array(z.string().max(40)).max(5).optional(),
  /** Pasar los query params del link corto al destino (default true). */
  forwardParams: z.boolean().optional(),
  /** A dónde redirige cuando vence o llega a max_clicks. */
  expiredUrl: z.string().max(2000).nullish(),
});

export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, 'v1-link-create', 120, 60);
  if (limited) return limited;
  const auth = await requireApiUser(req, 'links:write');
  if ('res' in auth) return auth.res;

  const body: unknown = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join('.') ?? '';
    if (!field || field === 'url') return apiError(400, 'invalid_url', 'A valid "url" is required.');
    return apiError(400, 'bad_request', `Invalid "${field}": ${issue?.message ?? 'invalid value'}.`);
  }

  let domainId: string | null = null;
  if (parsed.data.domain) {
    const domain = (await listDomains(auth.user.id)).find(
      (d) => d.hostname === parsed.data.domain!.toLowerCase() && d.verified === 1,
    );
    if (!domain) return apiError(400, 'invalid_domain', 'That domain is not a verified domain of yours.');
    domainId = domain.id;
  }
  const result = await createLink(auth.user.id, { ...parsed.data, domainId });
  if (!result.ok) {
    const messages: Record<string, string> = {
      invalid_url: 'The destination URL is not valid.',
      invalid_slug: 'The slug is not valid (2–32 chars: a-z 0-9 - _).',
      slug_taken: 'That slug is already taken.',
      invalid_date: 'The expiration date is not valid.',
      invalid_domain: 'That domain is not a verified domain of yours.',
      self_link: 'The destination cannot be another short link of ours.',
      invalid_expired_url: 'The expired URL is not a valid http(s) URL.',
      quota_exceeded: 'Daily link creation quota reached. Try again later.',
    };
    return apiError(result.code === 'quota_exceeded' ? 429 : 400, result.code, messages[result.code]);
  }

  const dto = toLinkDto(result.link);
  return NextResponse.json(
    {
      id: dto.id,
      slug: dto.slug,
      domain: dto.domain,
      short_url: dto.short_url,
      url: dto.url,
      title: dto.title,
      tags: dto.tags,
      forward_params: dto.forward_params,
      expired_url: dto.expired_url,
      created_at: dto.created_at,
    },
    { status: 201 },
  );
}

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'links:read');
  if ('res' in auth) return auth.res;

  const sp = req.nextUrl.searchParams;
  const result = await listLinks(auth.user.id, {
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

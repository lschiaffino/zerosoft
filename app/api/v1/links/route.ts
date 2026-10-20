import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { createLink, listLinks, toLinkDto, type CreateLinkError } from '@/lib/links';
import { listDomains } from '@/lib/link-domains';
import { linkTargetingSchema } from '@/lib/link-targeting';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lo mismo que se puede cargar al crear desde la app (salvo la contraseña en claro, que no se devuelve nunca). */
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
  redirectType: z.union([z.literal(301), z.literal(302)]).optional(),
  /** ISO 8601. */
  expiresAt: z.string().max(40).nullish(),
  maxClicks: z.number().int().positive().max(1_000_000_000).nullish(),
  password: z.string().min(1).max(100).optional(),
  utmSource: z.string().max(100).optional(),
  utmMedium: z.string().max(100).optional(),
  utmCampaign: z.string().max(100).optional(),
  utmTerm: z.string().max(100).optional(),
  utmContent: z.string().max(100).optional(),
  ogTitle: z.string().max(200).optional(),
  ogDescription: z.string().max(500).optional(),
  ogImage: z.string().max(500).optional(),
  targeting: linkTargetingSchema.nullish(),
  /** Id propio del cliente, único por workspace; después se lee con /api/v1/links/ext_<id>. */
  externalId: z.string().max(255).nullish(),
});

const MESSAGES: Record<CreateLinkError, string> = {
  invalid_url: 'The destination URL is not valid.',
  invalid_slug: 'The slug is not valid (2–32 chars: a-z 0-9 - _).',
  slug_taken: 'That slug is already taken.',
  invalid_date: 'The expiration date is not valid.',
  invalid_domain: 'That domain is not a verified domain of yours.',
  self_link: 'The destination cannot be another short link of ours.',
  invalid_expired_url: 'The expired URL is not a valid http(s) URL.',
  invalid_og_image: 'The OG image is not a valid http(s) URL.',
  invalid_external_id: 'The externalId is not valid (1–255 chars: letters, digits and . _ : @ -).',
  external_id_taken: 'Another link of this workspace already uses that externalId.',
  invalid_targeting_url: 'A targeting destination is not a valid http(s) URL.',
  empty_rule: 'Each targeting rule needs at least one country or device.',
  ab_needs_two: 'An A/B test needs at least two variants.',
  ab_zero_weight: 'A/B weights must add up to more than zero.',
  quota_exceeded: 'Daily link creation quota reached. Try again later.',
};

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

  const { domain, ...input } = parsed.data;
  let domainId: string | null = null;
  if (domain) {
    const found = (await listDomains(auth.user.id)).find((d) => d.hostname === domain.toLowerCase() && d.verified === 1);
    if (!found) return apiError(400, 'invalid_domain', MESSAGES.invalid_domain);
    domainId = found.id;
  }
  const result = await createLink(auth.user.id, {
    ...input,
    expiresAt: input.expiresAt ?? null,
    maxClicks: input.maxClicks ?? null,
    domainId,
    createdBy: auth.personId,
  });
  if (!result.ok) {
    const status =
      result.code === 'quota_exceeded' ? 429 : result.code === 'slug_taken' || result.code === 'external_id_taken' ? 409 : 400;
    return apiError(status, result.code, MESSAGES[result.code]);
  }

  return NextResponse.json(toLinkDto(result.link), { status: 201 });
}

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'links:read');
  if ('res' in auth) return auth.res;

  const sp = req.nextUrl.searchParams;
  const result = await listLinks(auth.user.id, {
    archived: 'all',
    creator: sp.get('creator') ?? undefined,
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
        external_id: dto.external_id,
        created_by: dto.created_by,
        created_at: dto.created_at,
      };
    }),
    total: result.total,
  });
}

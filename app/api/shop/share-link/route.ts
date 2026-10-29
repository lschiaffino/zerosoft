import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureStore, getCollectionRow, getProductRow } from '@/lib/shop';
import { readJson, shopActor, shopJson } from '@/lib/shop-http';
import { userCanUseApp } from '@/lib/workspace';
import { createLink, toLinkDto } from '@/lib/links';
import { viewerOf } from '@/lib/link-folders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  kind: z.enum(['store', 'product', 'collection']),
  id: z.string().max(80).optional(),
  utmSource: z.string().trim().max(100).optional(),
  utmMedium: z.string().trim().max(100).optional(),
  utmCampaign: z.string().trim().max(100).optional(),
});

/**
 * POST /api/shop/share-link: link corto de Link (con UTM) a la tienda, un
 * producto o una colección. Necesita también la app Link.
 */
export async function POST(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  if (!userCanUseApp(a.user, 'link')) return shopJson({ error: 'link_unavailable' }, 403);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return shopJson({ error: 'invalid_input' }, 400);
  const input = parsed.data;
  const store = await ensureStore(a.actor.ws);
  const base = `${(process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '')}/store/${store.handle}`;
  let url = base;
  let title = store.name;
  if (input.kind === 'product') {
    const p = input.id ? await getProductRow(a.actor.ws, input.id) : null;
    if (!p) return shopJson({ error: 'not_found' }, 404);
    url = `${base}/products/${p.handle}`;
    title = p.title;
  } else if (input.kind === 'collection') {
    const c = input.id ? await getCollectionRow(a.actor.ws, input.id) : null;
    if (!c) return shopJson({ error: 'not_found' }, 404);
    url = `${base}/collections/${c.handle}`;
    title = c.title;
  }
  const res = await createLink(a.actor.ws, {
    url,
    title,
    utmSource: input.utmSource || undefined,
    utmMedium: input.utmMedium || undefined,
    utmCampaign: input.utmCampaign || undefined,
    createdBy: a.actor.person,
    viewer: viewerOf(a.user),
  } as Parameters<typeof createLink>[1]);
  if (!res.ok) return shopJson({ error: res.code }, 400);
  const dto = toLinkDto(res.link);
  return shopJson({ link: { id: dto.id, shortUrl: dto.short_url, url: dto.url } }, 201);
}

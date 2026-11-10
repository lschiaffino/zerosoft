import { NextResponse } from 'next/server';
import { getAllSlugs, getPost, productOfPost } from '@/lib/blog';
import { blogCoverSVG } from '@/lib/blog-cover';
import { PRODUCT_CONFIG } from '@/lib/products';
import { siteCard, type CardResult } from '@/lib/og/cards';
import { sharedCard } from '@/lib/og/shared-cards';
import { OG_CACHE_IMMUTABLE, OG_CACHE_SHORT, renderOg } from '@/lib/og/render';

export const runtime = 'nodejs';

/**
 * Tarjetas para compartir (og:image, PNG) de todo lo público, en el idioma
 * de la página. `?f=sq` da la versión cuadrada (1200×1200); `?v=<hash>` (lo
 * pone lib/og/url.ts) la vuelve inmutable.
 *
 * Sitio (lib/og/cards.ts):
 *   /api/og/home/<locale>
 *   /api/og/product/<app>[/<locale>]
 *   /api/og/blog/<locale>/<slug>   (y /api/og/blog/<slug>, inglés, URLs viejas)
 *   /api/og/tool/<slug>[/<locale>] ("hub" = /tools)
 *   /api/og/changelog[/<locale>]
 *   /api/og/compare/<locale>/<slug>
 *   /api/og/page/<locale>/<key>     (páginas fijas de lib/seo-routes.ts)
 *   /api/og/feedback-board/<locale>[/roadmap]
 *   /api/og/cover/<slug>            (la portada de un post, SVG, para la página misma)
 *
 * Contenido de un workspace (lib/og/shared-cards.ts), solo si es público:
 *   /api/og/rec/<share>, /api/og/help/<handle>/<slug>[/<locale>],
 *   /api/og/note/<token>, /api/og/whiteboard/<token>, /api/og/design/<token>,
 *   /api/og/form/<key>, /api/og/book/<handle>[/<slug>],
 *   /api/og/store/<handle>[/<product>], /api/og/job/<handle>[/<slug>],
 *   /api/og/board/<id> (ítem del board de feedback)
 */

const SITE_KINDS = new Set(['home', 'product', 'blog', 'tool', 'changelog', 'compare', 'page', 'feedback-board']);

/** Contenido de un workspace: si deja de ser público, la tarjeta se va en minutos. */
const SHARED_CACHE = 'public, max-age=300, s-maxage=300';

const notFound = () => new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' } });

export async function GET(req: Request, props: { params: Promise<{ card: string[] }> }) {
  const { card } = await props.params;
  const [kind, ...args] = card.map((p) => decodeURIComponent(p));
  if (!kind || args.length > 3 || args.some((a) => a.length > 200)) return notFound();
  const query = new URL(req.url).searchParams;

  // Portada de un post (SVG, lib/blog-cover.ts): determinística por slug, se cachea mucho.
  if (kind === 'cover') {
    const [slug] = args;
    const post = slug ? getPost('en', slug) : null;
    if (!slug || !post || getAllSlugs().indexOf(slug) < 0) return notFound();
    const product = productOfPost(post);
    return new NextResponse(blogCoverSVG(slug, product ? PRODUCT_CONFIG[product].color : null), {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400',
      },
    });
  }

  let result: CardResult | null;
  try {
    result = SITE_KINDS.has(kind) ? await siteCard(kind, args[0], args[1]) : await sharedCard(kind, args);
  } catch {
    result = null;
  }
  if (!result) return notFound();

  const format = query.get('f') === 'sq' ? 'square' : 'wide';
  const cache = result.shared ? SHARED_CACHE : query.has('v') ? OG_CACHE_IMMUTABLE : OG_CACHE_SHORT;
  try {
    const res = await renderOg(result.spec, { format, cache });
    // ImageResponse renderiza en el stream: forzarlo acá para que una foto rota caiga al plan B.
    const body = await res.arrayBuffer();
    return new NextResponse(body, { headers: res.headers });
  } catch {
    if (!result.spec.poster) throw new Error('og_render_failed');
    // La miniatura no se pudo leer: la tarjeta sin foto.
    const res = await renderOg({ ...result.spec, poster: undefined }, { format, cache });
    return new NextResponse(await res.arrayBuffer(), { headers: res.headers });
  }
}

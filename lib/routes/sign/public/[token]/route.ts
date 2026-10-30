import { NextRequest } from 'next/server';
import { markViewed, publicView } from '@/lib/sign/signing';
import { publicResolve, type PublicCtx } from '@/lib/sign/public-http';
import { metaOf, sJson } from '@/lib/sign/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: lo que ve el destinatario con su link (estado, sus campos; nunca valores de otros). */
export async function GET(req: NextRequest, ctx: PublicCtx) {
  const p = await publicResolve(req, ctx, 'view', 120);
  if ('res' in p) return p.res;
  const view = await publicView(p.r, p.sessionOk);
  // Abierto recién cuando ve el documento (después del código, si hace falta).
  if (view.state === 'ready') await markViewed(p.r, metaOf(req)).catch(() => undefined);
  return sJson(view);
}

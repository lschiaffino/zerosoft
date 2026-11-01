import { NextRequest } from 'next/server';
import { accountOrders, sendAccountLink } from '@/lib/shop-pages';
import { publishedStore } from '@/lib/shop-storefront';
import { publicOrigin, readJson, shopJson, shopLimit } from '@/lib/shop-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ handle: string }> };


/** POST { email }: manda el link a "mis pedidos". Siempre la misma respuesta, sea o no cliente. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { handle } = await params;
  const limited = await shopLimit(req, 'account', 5, 600, handle);
  if (limited) return limited;
  const store = await publishedStore(handle);
  if (!store) return shopJson({ error: 'not_found' }, 404);
  const body = ((await readJson(req)) ?? {}) as { email?: string };
  const email = String(body.email ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return shopJson({ error: 'invalid_email' }, 400);
  await sendAccountLink(store.row, email, publicOrigin(req)).catch((err: unknown) => console.error('[shop] account link failed', err instanceof Error ? err.message : 'error'));
  return shopJson({ ok: true });
}

/** GET ?token=…: los pedidos de ese email mientras el link siga vigente. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { handle } = await params;
  const limited = await shopLimit(req, 'account-read', 60, 600, handle);
  if (limited) return limited;
  const store = await publishedStore(handle);
  if (!store) return shopJson({ error: 'not_found' }, 404);
  const data = await accountOrders(store.row, req.nextUrl.searchParams.get('token') ?? '');
  return data ? shopJson(data, 200, { 'cache-control': 'no-store' }) : shopJson({ error: 'link_expired' }, 410);
}

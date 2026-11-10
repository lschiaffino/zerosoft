import { NextRequest, NextResponse } from 'next/server';
import { isComingSoon, isProductKey } from '@/lib/products';

export const dynamic = 'force-dynamic';

/**
 * Respuesta de la API de una app cortada (lib/session.ts redirige acá): 403
 * con el motivo. "coming_soon" si la app todavía no salió; "app_disabled" si
 * el workspace la apagó o no la abrió para esta persona.
 */
function blocked(req: NextRequest): NextResponse {
  const raw = req.nextUrl.searchParams.get('app') ?? '';
  const app = isProductKey(raw) ? raw : null;
  const error = app && isComingSoon(app) ? 'coming_soon' : 'app_disabled';
  return NextResponse.json({ error, app }, { status: 403, headers: { 'cache-control': 'no-store' } });
}

export const GET = blocked;
export const POST = blocked;
export const PUT = blocked;
export const PATCH = blocked;
export const DELETE = blocked;

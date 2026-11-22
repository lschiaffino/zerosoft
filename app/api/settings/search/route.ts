import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { settingsSearchIndex } from '@/lib/settings-search-server';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * El índice de la búsqueda de Ajustes de la persona (?locale=en|es|pt): solo
 * los ajustes que puede abrir. El navegador lo pide una vez y busca local.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const locale = req.nextUrl.searchParams.get('locale') ?? user.locale ?? 'en';
  const items = await settingsSearchIndex(user, locale);
  return NextResponse.json({ items }, { headers: { 'cache-control': 'no-store' } });
}

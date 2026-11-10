import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { settingsNavGroups } from '@/lib/settings-nav-server';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOCALES = ['en', 'es', 'pt'];

/**
 * La nav de Ajustes de la persona, para la ventana de Ajustes de la app de
 * escritorio (la pinta junto a sus secciones nativas). ?locale=en|es|pt;
 * ?desktop=1 suma las secciones nativas en Este dispositivo.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const raw = req.nextUrl.searchParams.get('locale') ?? '';
  const locale = LOCALES.includes(raw) ? raw : LOCALES.includes(user.locale ?? '') ? user.locale! : 'en';
  const desktop = req.nextUrl.searchParams.get('desktop') === '1';
  const groups = await settingsNavGroups(user, locale, { desktop });
  return NextResponse.json({ groups }, { headers: { 'cache-control': 'no-store' } });
}

/**
 * Las rutas que empiezan el OAuth de una integración (Gmail, Calendar,
 * Outlook, Notion, Slack, Linear) se abren como navegación completa. La app
 * de escritorio las abre en el navegador del sistema (el proveedor no deja
 * hacer OAuth en un webview), donde puede no haber sesión: en vez de un 401
 * en JSON, la persona entra y vuelve a la misma ruta de inicio.
 *
 * Solo para navegaciones (Accept: text/html): un fetch sigue recibiendo el
 * 401. La vuelta es el path + query de esta misma request, así que nunca sale
 * del sitio (y /auth/signin la valida otra vez con safeCallbackUrl).
 *
 * Una sola vuelta: la ruta de inicio vuelve marcada con ?signin=1. Si después
 * de entrar sigue sin acceso (una app que la persona no tiene responde como
 * sin sesión), recibe el 401 en vez de ir y volver del login sin fin.
 */
import { NextResponse } from 'next/server';
import { requestLocale } from './request-locale';
import { signInPath } from './return-path';

/** Marca de "ya pasó por el login" en la vuelta a la ruta de inicio. */
export const SIGNIN_MARK = 'signin';

function cookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** Sin sesión en una ruta de inicio de OAuth: al login y de vuelta acá, o el 401 de siempre. */
export function signInToConnect(req: Request): NextResponse {
  const url = new URL(req.url);
  const navigation = (req.headers.get('accept') ?? '').includes('text/html');
  if (!navigation || url.searchParams.has(SIGNIN_MARK)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const locale = requestLocale(cookie(req, 'NEXT_LOCALE'), req.headers.get('accept-language'));
  const back = new URL(url);
  back.searchParams.set(SIGNIN_MARK, '1');
  return NextResponse.redirect(new URL(signInPath(locale, `${back.pathname}${back.search}`), url), 307);
}

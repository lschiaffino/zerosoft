import { headers } from 'next/headers';
import { surfaceForHost } from './host-rewrite';
import { authBaseUrl } from './board-urls';
import { boardPath } from './board-paths';

/**
 * Contexto de la request del board: ¿se sirve en el subdominio
 * (feedback.zerosoft.ai) o bajo /feedback-board del sitio? Decide la forma de
 * los links y adónde mandar el login.
 */
export interface BoardContext {
  locale: string;
  onSurface: boolean;
  origin: string;
}

export async function getBoardContext(locale: string): Promise<BoardContext> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.includes('.localhost') ? 'http' : 'https');
  return { locale, onSurface: surfaceForHost(host) === 'board', origin: host ? `${proto}://${host}` : '' };
}

/**
 * Link de login que vuelve a `path` del board. El login siempre se hace en el
 * host principal (NEXTAUTH_URL): desde el subdominio se pasa la URL absoluta.
 */
export function boardLoginHref(ctx: BoardContext, path = ''): string {
  const target = boardPath(ctx.locale, ctx.onSurface, path);
  if (ctx.onSurface) {
    const back = `${ctx.origin}${target}`;
    return `${authBaseUrl()}/${ctx.locale}/auth/signin?callbackUrl=${encodeURIComponent(back)}`;
  }
  return `/${ctx.locale}/auth/signin?callbackUrl=${encodeURIComponent(target)}`;
}

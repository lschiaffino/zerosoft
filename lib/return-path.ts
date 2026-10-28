/**
 * A dónde volver después del login. Puro (sin next-auth), para poder testearlo.
 *
 * El path viaja como ?callbackUrl= al sign-in y de ahí a la cookie de
 * next-auth, así que tiene que ser interno (nunca otro host) y caber en una
 * cookie: si es muy largo se recorta el parámetro más largo (p. ej. la
 * selección de un clip) en vez de perder todo el destino.
 */

/** Header interno con el path + query de la request (lo pone el middleware). */
export const RETURN_PATH_HEADER = 'x-zs-return-path';

/**
 * Header interno con el path de una request a la API de una app (lo pone el
 * middleware, siempre pisado): lib/session.ts lo usa para el acceso por app.
 */
export const API_PATH_HEADER = 'x-zs-api-path';

/** Tope del path de vuelta (la cookie de next-auth tiene ~4 KB en total). */
export const RETURN_PATH_MAX = 1500;

const DUMMY_ORIGIN = 'http://internal.invalid';

/** El path solo si es interno del sitio: "/algo", sin host, esquema ni barras dobles. */
export function safeInternalPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > 8000) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  // Caracteres de control o barras invertidas: algunos navegadores los normalizan a "//".
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  try {
    const u = new URL(raw, DUMMY_ORIGIN);
    if (u.origin !== DUMMY_ORIGIN) return null;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}

/**
 * Achica el path hasta `max` caracteres recortando el valor del parámetro más
 * largo; si ni así entra, queda solo el path sin query.
 */
export function fitReturnPath(path: string, max = RETURN_PATH_MAX): string {
  if (path.length <= max) return path;
  const u = new URL(path, DUMMY_ORIGIN);
  const base = u.pathname;
  if (base.length > max) return '/';
  const params = [...u.searchParams.entries()];
  const build = () => {
    const q = new URLSearchParams(params).toString();
    return q ? `${base}?${q}` : base;
  };
  for (let guard = 0; guard <= params.length; guard++) {
    if (build().length <= max) return build();
    let longest = -1;
    for (let i = 0; i < params.length; i++) if (longest < 0 || params[i][1].length > params[longest][1].length) longest = i;
    if (longest < 0 || params[longest][1].length === 0) break;
    // Búsqueda binaria del prefijo más largo que entra (codificado, un carácter ocupa hasta 9).
    const [key, value] = params[longest];
    let lo = 0;
    let hi = value.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      params[longest] = [key, value.slice(0, mid)];
      if (build().length <= max) lo = mid;
      else hi = mid - 1;
    }
    params[longest] = [key, value.slice(0, lo)];
  }
  const fitted = build();
  return fitted.length <= max ? fitted : base;
}

/** Link al sign-in que vuelve a `returnTo` (si es seguro); si no, el sign-in a secas. */
export function signInPath(locale: string, returnTo?: string | null): string {
  const safe = safeInternalPath(returnTo);
  const signin = `/${locale}/auth/signin`;
  if (!safe) return signin;
  return `${signin}?callbackUrl=${encodeURIComponent(fitReturnPath(safe))}`;
}

/** Path + query a partir de un pathname y sus searchParams (para las páginas). */
export function pathWithQuery(pathname: string, params: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string') q.set(k, v);
    else if (Array.isArray(v)) for (const item of v) q.append(k, item);
  }
  const s = q.toString();
  return s ? `${pathname}?${s}` : pathname;
}

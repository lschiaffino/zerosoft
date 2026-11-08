/**
 * Pista de sesión para el navegador: la cookie zs_who (no httpOnly) que el
 * middleware pone en las páginas de la app cuando hay sesión y borra cuando no
 * (ver withWhoCookie en middleware.ts). Es un hash, no identifica a nadie.
 *
 * El header del sitio la usa para mostrar "Ir a la app" en vez de "Entrar" sin
 * leer la sesión en el servidor: así el HTML del sitio es igual para todos y
 * sale estático del CDN. Es solo una pista de interfaz: los permisos los
 * decide siempre el servidor.
 */
export const WHO_COOKIE = 'zs_who';

/** ¿El header Cookie (o document.cookie) trae la pista de sesión? */
export function hasSessionHint(cookieHeader: string | null | undefined): boolean {
  return (cookieHeader ?? '').split(';').some((part) => {
    const i = part.indexOf('=');
    return i > 0 && part.slice(0, i).trim() === WHO_COOKIE && part.slice(i + 1).trim() !== '';
  });
}

/** Al cerrar sesión: la pista se va con ella (el próximo pedido a la app la vuelve a poner si hace falta). */
export function clearSessionHint(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${WHO_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * Pista de sesión para el navegador: la cookie zs_who (no httpOnly) que el
 * middleware pone en las páginas de la app cuando hay sesión y borra cuando no
 * (ver withWhoCookie en middleware.ts). Es un hash, no identifica a nadie.
 *
 * El header del sitio la usa para mostrar "Dashboard" en vez de "Entrar" sin
 * leer la sesión en el servidor: así el HTML del sitio es igual para todos y
 * sale estático del CDN. Es solo una pista de interfaz: los permisos los
 * decide siempre el servidor.
 */
export const WHO_COOKIE = 'zs_who';

/**
 * Script en línea al principio del <body>, antes del primer paint: con la
 * pista, <html data-session="in">. El header trae las dos variantes y el CSS
 * (.hd-in / .hd-out en styles/site.css) muestra la que va, sin parpadeo. Sin
 * JavaScript queda "Entrar".
 */
export const SESSION_HINT_SCRIPT =
  "try{if(/(?:^|;\\s*)zs_who=[^;\\s]/.test(document.cookie))document.documentElement.setAttribute('data-session','in')}catch(e){}";

/** Al cerrar sesión: la pista se va con ella (el próximo pedido a la app la vuelve a poner si hace falta). */
export function clearSessionHint(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${WHO_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  document.documentElement.removeAttribute('data-session');
}

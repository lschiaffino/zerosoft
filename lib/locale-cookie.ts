/**
 * Cookie de idioma (NEXT_LOCALE) del lado del navegador. El middleware de
 * next-intl la escribía en la respuesta de cada página cuando cambiaba; en las
 * páginas del sitio, que salen estáticas del CDN, una respuesta con Set-Cookie
 * no se cachea. El middleware la saca de esas respuestas (stripSiteLocaleCookie)
 * y este script la deja igual en el navegador: la ruta raíz y las APIs que leen
 * el idioma de la cookie siguen viendo el último idioma visitado.
 */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

const LOCALES = ['en', 'es', 'pt'];

/** Script en línea: pone NEXT_LOCALE=<locale> si falta o es otro (cookie de sesión, como next-intl). */
export function localeCookieScript(locale: string): string {
  if (!LOCALES.includes(locale)) return '';
  return (
    `try{if(!/(?:^|;\\s*)${LOCALE_COOKIE}=${locale}(?:;|$)/.test(document.cookie))` +
    `document.cookie='${LOCALE_COOKIE}=${locale}; path=/; samesite=lax'}catch(e){}`
  );
}

/**
 * Respuesta de una página del sitio (no /app, no redirección): sin el
 * Set-Cookie de NEXT_LOCALE. Lo demás queda igual.
 */
export function stripLocaleSetCookie(headers: Headers): void {
  const all = headers.getSetCookie();
  if (!all.some((c) => c.startsWith(`${LOCALE_COOKIE}=`))) return;
  headers.delete('set-cookie');
  for (const c of all) if (!c.startsWith(`${LOCALE_COOKIE}=`)) headers.append('set-cookie', c);
}

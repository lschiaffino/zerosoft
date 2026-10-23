// Zona horaria del navegador en la cookie `tz` (ver lib/user-tz.ts, server).
// Sin dependencias de React ni de Next: lo usan el script inline del layout,
// TimezoneCookie y los tests.

/** Evento que avisa que la cookie tz cambió y el servidor ya puede usarla. */
export const TZ_CHANGED_EVENT = 'zs:tz-changed';

/** Atributo que marca una página con fechas que dependen de "hoy" en tu zona. */
export const TZ_DEPENDENT_ATTR = 'data-tz-dependent';

/**
 * Script inline al final del body: escribe la cookie antes
 * de cualquier request de la app. Así la primera visita al sitio o al login
 * ya deja la cookie para la app y casi nunca hace falta refrescar.
 */
export const TZ_COOKIE_SCRIPT =
  "try{var z=Intl.DateTimeFormat().resolvedOptions().timeZone,m=document.cookie.match(/(?:^|;\\s*)tz=([^;]*)/);" +
  "if(z&&(!m||decodeURIComponent(m[1])!==z))document.cookie='tz='+encodeURIComponent(z)+'; path=/; max-age=31536000; samesite=lax'}catch(e){}";

/**
 * Qué hacer al hidratar, sabiendo con qué zona armó el servidor la página
 * (`serverTz`) y cuál tiene el navegador:
 * - 'none': coinciden (o no se sabe la del navegador).
 * - 'refresh': la página muestra fechas de "hoy" (crm/tareas, analytics):
 *   hay que volver a pedirla.
 * - 'notify': solo el resto del shell (el contador de tareas del sidebar)
 *   depende de la zona; alcanza con avisarle, sin re-renderizar la página.
 */
export function tzAction(serverTz: string, browserTz: string | null, pageDependsOnTz: boolean): 'none' | 'refresh' | 'notify' {
  if (!browserTz || browserTz === serverTz) return 'none';
  return pageDependsOnTz ? 'refresh' : 'notify';
}

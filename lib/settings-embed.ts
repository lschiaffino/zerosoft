/**
 * La ventana de Ajustes de la app de escritorio carga las secciones web
 * (perfil, workspace, ajustes de cada app) en su propio webview, con un user
 * agent que termina en `zerosoft-settings/<versión>` (desktop/src-tauri,
 * commands.rs: settings_user_agent). Con esa marca /app se arma sin el chrome
 * de la app (sidebar, banda, ⌘K): solo la nav de Ajustes y la sección.
 */
export const SETTINGS_EMBED_UA = 'zerosoft-settings/';

export function isSettingsEmbed(userAgent: string | null | undefined): boolean {
  return typeof userAgent === 'string' && userAgent.includes(SETTINGS_EMBED_UA);
}

/**
 * Rutas que la ventana de Ajustes abre adentro (con o sin locale): /app/settings/**,
 * /app/<app>/settings/** y /app/chat/widgets (los ajustes de Chat). El resto va a la
 * ventana principal. La misma regla en Rust: desktop/src-tauri/src/nav.rs (settings_route).
 */
const SETTINGS_ROUTE = /^(?:\/(?:en|es|pt))?\/app\/(?:settings|[a-z0-9-]+\/settings|chat\/widgets)(?:\/|$)/;

export function isSettingsRoute(pathname: string): boolean {
  return SETTINGS_ROUTE.test(pathname);
}

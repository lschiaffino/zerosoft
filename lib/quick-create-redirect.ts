/**
 * Paths viejos de alta (/new) cuyo formulario ahora es un modal rápido sobre
 * la lista (?new=1). El middleware los redirige con un 307 de verdad, antes de
 * renderizar nada.
 *
 * Por qué no alcanza con el redirect() de la página: en la primera carga el
 * redirect llega dentro del stream RSC y el router del cliente navega mientras
 * hidrata. Si en ese momento otra cosa pide router.refresh() (TimezoneCookie
 * la primera vez que guarda la zona horaria), el Router de Next 15 renderiza
 * con un estado pendiente y tira el error #310 de React (más hooks que en el
 * render anterior). Con el 307 la página que se hidrata ya es la lista.
 *
 * Solo sin query: con parámetros (?full=1, ?companyId=…) la página decide.
 * Puro: lo usan el middleware y los tests.
 */
const QUICK_CREATE_NEW = /^\/(en|es|pt)\/app\/(calendar\/event-types|calendar\/routing|crm\/companies|crm\/contacts|crm\/deals)\/new\/?$/;

/** El alta de issue de Track abre el modal en el team (?newIssue=1). */
const TRACK_ISSUE_NEW = /^\/(en|es|pt)\/app\/track\/(?:projects|team)\/([^/]+)\/issues\/new\/?$/;

export function quickCreateRedirect(pathname: string, search: string): string | null {
  if (search && search !== '?') return null;
  const m = QUICK_CREATE_NEW.exec(pathname);
  if (m) return `/${m[1]}/app/${m[2]}?new=1`;
  const t = TRACK_ISSUE_NEW.exec(pathname);
  if (t) return `/${t[1]}/app/track/team/${t[2]}?newIssue=1`;
  return null;
}

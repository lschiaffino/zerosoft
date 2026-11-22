/**
 * Todos los teams de Track del workspace, página por página.
 *
 * GET /api/track/projects devuelve como mucho 100 por pedido (lib/track-data.ts,
 * listProjects). Pedir solo `pageSize=100` dejaba afuera a los teams que venían
 * después en el orden por nombre: con más de 100, un team nuevo no aparecía en
 * el sidebar, no recibía issues arrastrados ni salía en "Mover a team".
 *
 * Devuelve null si falla el primer pedido (el que llama decide qué mostrar);
 * si falla una página posterior, devuelve lo que juntó hasta ahí.
 */

const PAGE_SIZE = 100;
/** Tope de seguridad: 50 páginas son 5.000 teams. */
const MAX_PAGES = 50;

type Page<T> = { rows: T[]; total?: number };

export async function fetchAllTrackTeams<T>(
  fetcher: (url: string) => Promise<Response> = (url) => fetch(url),
): Promise<T[] | null> {
  const all: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetcher(`/api/track/projects?pageSize=${PAGE_SIZE}&page=${page}`).catch(() => null);
    if (!res?.ok) return page === 1 ? null : all;
    const data = (await res.json().catch(() => null)) as Page<T> | null;
    if (!data || !Array.isArray(data.rows)) return page === 1 ? null : all;
    all.push(...data.rows);
    const total = typeof data.total === 'number' ? data.total : null;
    if (data.rows.length < PAGE_SIZE || (total !== null && all.length >= total)) break;
  }
  return all;
}

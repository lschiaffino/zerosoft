/**
 * Respuestas con datos de la persona (avisos, ajustes, búsqueda, workspaces):
 * ningún caché intermedio ni del navegador las guarda ni las sirve a otra.
 * Ahora que el sitio sale del CDN, las APIs del chrome lo dicen explícito.
 */
export const PRIVATE_NO_STORE = 'private, no-store';

export function noStore<R extends Response>(res: R): R {
  res.headers.set('Cache-Control', PRIVATE_NO_STORE);
  return res;
}

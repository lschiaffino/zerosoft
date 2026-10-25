/** Favoritos de Docs del lado del cliente: evento para que el sidebar se entere sin recargar. */
export const DOCS_FAVORITES_EVENT = 'docs:favorites';

export interface DocsFavoriteRow {
  id: string;
  title: string;
  icon: string | null;
}

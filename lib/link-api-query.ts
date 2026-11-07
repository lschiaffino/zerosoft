import type { ListLinksParams } from '@/lib/links';

/**
 * Filtros de GET /api/v1/links a partir de la query string. Valores que no
 * entienden se ignoran (no se devuelve un 400 por un filtro suelto).
 * `archived=true|false` filtra; sin el parámetro vienen todos.
 */
export function parseLinkListQuery(sp: URLSearchParams): ListLinksParams {
  const text = (key: string, max: number): string | undefined => {
    const v = sp.get(key)?.trim();
    return v ? v.slice(0, max) : undefined;
  };
  const archivedRaw = sp.get('archived');
  return {
    q: text('q', 100),
    tag: text('tag', 40),
    folder: text('folder', 64),
    creator: text('creator', 64),
    archived: archivedRaw === 'true' ? '1' : archivedRaw === 'false' ? '0' : 'all',
    sort: sp.get('sort') === 'clicks' ? 'clicks' : 'created',
    page: Number(sp.get('page') ?? '1') || 1,
    pageSize: Number(sp.get('pageSize') ?? '10') || 10,
  };
}

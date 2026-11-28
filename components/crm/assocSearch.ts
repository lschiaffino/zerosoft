/**
 * Búsqueda de registros para asociar (vista previa, timeline): la ruta de
 * asociaciones devuelve hasta 20 (lib/crm-assoc-search.ts) con el alcance de
 * quien mira. La de Cmd+K corta en 5 por tipo y no sirve para elegir.
 */
export interface AssocHit {
  id: string;
  name: string;
  meta: string;
}

const TYPE = { contacts: 'contact', companies: 'company', deals: 'deal' } as const;

export async function searchAssociable(plural: keyof typeof TYPE, q: string): Promise<AssocHit[]> {
  const qs = new URLSearchParams({ type: TYPE[plural], q });
  const res = await fetch(`/api/crm/associations/search?${qs.toString()}`).catch(() => null);
  if (!res?.ok) return [];
  const data = (await res.json().catch(() => null)) as { results?: AssocHit[] } | null;
  return Array.isArray(data?.results) ? data.results : [];
}

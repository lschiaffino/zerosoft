import type { DocsPageSummary } from './docs-types';

/**
 * El sidebar de Docs no recibe todas las páginas (con 300 eran 76 KB en cada
 * carga): como en Notion, el árbol arranca plegado y llegan el primer nivel,
 * la rama abierta (ancestros de la página actual y sus hermanas) y los hijos de
 * la actual. Cada página trae cuántas hijas tiene, así la flecha aparece sin
 * bajarlas; las de una rama cerrada se piden al desplegarla.
 */
export interface SidebarSlice {
  pages: DocsPageSummary[];
  /** Total de páginas del workspace que ve (el contador del encabezado). */
  total: number;
  /** Las últimas editadas, para el buscador rápido (⌘P) sin escribir. */
  recent: DocsPageSummary[];
}

function withCounts(pages: DocsPageSummary[], counts: Map<string, number>): DocsPageSummary[] {
  return pages.map((p) => ({ ...p, child_count: counts.get(p.id) ?? 0 }));
}

function childCounts(all: DocsPageSummary[]): Map<string, number> {
  const ids = new Set(all.map((p) => p.id));
  const counts = new Map<string, number>();
  for (const p of all) if (p.parent_id && ids.has(p.parent_id)) counts.set(p.parent_id, (counts.get(p.parent_id) ?? 0) + 1);
  return counts;
}

export function sidebarSlice(all: DocsPageSummary[], currentId?: string | null): SidebarSlice {
  const byId = new Map(all.map((p) => [p.id, p]));
  // La rama abierta: la página actual y sus ancestros (sus hijas van completas).
  const open = new Set<string>();
  let cur = currentId ? byId.get(currentId) : undefined;
  while (cur && !open.has(cur.id)) {
    open.add(cur.id);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  // Primer nivel: sin madre o con una madre que no ve (como hace buildPageTree).
  const pages = all.filter((p) => !p.parent_id || !byId.has(p.parent_id) || open.has(p.parent_id));
  const recent = [...all].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 8);
  return { pages: withCounts(pages, childCounts(all)), total: all.length, recent };
}

/** Hijas de una página (al desplegarla en el sidebar), con su cantidad de hijas. */
export function sidebarChildren(all: DocsPageSummary[], parentId: string): DocsPageSummary[] {
  return withCounts(
    all.filter((p) => p.parent_id === parentId),
    childCounts(all),
  );
}

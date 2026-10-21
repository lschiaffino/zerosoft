/**
 * Tipos y helpers puros de Docs (sin dependencia de DB/fs).
 * Usado por componentes cliente.
 */

export type DocsBlockType =
  | 'paragraph'
  | 'heading'
  | 'bulleted_list_item'
  | 'numbered_list_item'
  | 'todo'
  | 'quote'
  | 'code'
  | 'divider'
  | 'table'
  | 'database'
  | 'image'
  | 'file'
  | 'toggle'
  | 'callout';

/** Niveles de anidado (Tab): el bloque cuelga del anterior con un nivel menos. */
export const DOCS_MAX_INDENT = 6;

export type DocsDatabaseColumnType = 'text' | 'number' | 'select' | 'date';

export type DocsDatabaseView = 'table' | 'gallery';

export interface DocsDatabaseColumn {
  id: string;
  name: string;
  type: DocsDatabaseColumnType;
  options?: string[];
}

export interface DocsBlock {
  id: string;
  type: DocsBlockType;
  content: string;
  level?: 1 | 2 | 3;
  checked?: boolean;
  language?: string;
  rows?: string[][];
  columns?: DocsDatabaseColumn[];
  view?: DocsDatabaseView;
  /**
   * Bloques image/file: URL del archivo en el storage (lib/uploads.ts). Nunca
   * se usa directo en el navegador: se sirve por /api/docs/files (chequea el
   * acceso a la página). A quien solo puede ver la página no le llega.
   */
  url?: string;
  /** Nombre original, tamaño en bytes y MIME del archivo subido. */
  name?: string;
  size?: number;
  mime?: string;
  /**
   * Anidado (Tab / Shift+Tab). El modelo sigue siendo una lista plana: los
   * hijos de un bloque son los que le siguen con un indent mayor (ver
   * lib/docs-blocks.ts). Ausente = 0.
   */
  indent?: number;
  /** Toggle (o heading toggle) plegado: sus hijos no se muestran. */
  collapsed?: boolean;
  /** Heading con toggle: pliega los bloques anidados debajo. */
  toggle?: boolean;
  /** Callout: emoji del recuadro. */
  icon?: string;
}

export interface DocsPage {
  id: string;
  user_id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  cover_url: string | null;
  content: DocsBlock[];
  /** La IA del Chat (bot y agentes) puede usarla como conocimiento. */
  is_public: boolean;
  /** Publicada en el centro de ayuda público (/h/<handle>/<slug>). */
  published?: boolean;
  slug?: string | null;
  archived: boolean;
  /** Ajustes de página persistidos (menú "…" del editor). */
  small_text?: boolean;
  full_width?: boolean;
  /** Orden manual entre hermanos (null = sin orden manual). */
  position?: number | null;
  /** Hereda los shares de la página padre (y de sus ancestros). */
  inherit_shares?: boolean;
  created_at: string;
  updated_at: string;
}

/** Lo que necesitan el árbol del sidebar y las listas: sin content (que pesa). */
export type DocsPageSummary = Pick<DocsPage, 'id' | 'parent_id' | 'title' | 'icon' | 'position' | 'updated_at'>;

export interface DocsPageShare {
  id: string;
  page_id: string;
  kind: 'public' | 'team' | 'user';
  target_id: string | null;
  role: DocsShareRole;
  created_at: string;
  /** Share heredado de un ancestro (null/ausente = propio de esta página). */
  inherited_from?: { id: string; title: string } | null;
}

export type DocsShareRole = 'view' | 'edit';

/** Acceso efectivo de quien abre una página. */
export type DocsAccess = 'owner' | 'edit' | 'view';

export interface DocsVersionSummary {
  id: string;
  page_id: string;
  title: string;
  kind: 'auto' | 'manual' | 'restore';
  author_id: string | null;
  author_name: string | null;
  author_email: string | null;
  created_at: string;
}

export interface DocsComment {
  id: string;
  page_id: string;
  user_id: string;
  block_id: string | null;
  /** Respuesta: id del comentario raíz del hilo (null = abre un hilo). */
  parent_id: string | null;
  body: string;
  resolved: boolean;
  created_at: string;
  user_name: string | null;
  user_email: string;
  user_image: string | null;
}

/** Plantilla guardada por el workspace (además de las built-in de lib/docs-templates.ts). */
export interface DocsWorkspaceTemplate {
  id: string;
  title: string;
  icon: string | null;
  description: string;
  created_by: string | null;
  created_at: string;
}

/** Miembro mencionable del workspace (para el popover de @). */
export interface DocsMentionableUser {
  id: string;
  name: string | null;
  email: string;
}

/**
 * Junta los shares de una cadena de páginas (la propia primero, después cada
 * ancestro hacia arriba). Para un mismo destino (kind + target) gana el más
 * cercano; los que vienen de un ancestro llevan `inherited_from`. Puro.
 */
export function mergeInheritedShares(
  levels: Array<{ page: { id: string; title: string }; shares: DocsPageShare[] }>,
): DocsPageShare[] {
  const byKey = new Map<string, DocsPageShare>();
  levels.forEach((level, depth) => {
    for (const share of level.shares) {
      const key = `${share.kind}:${share.target_id ?? ''}`;
      if (byKey.has(key)) continue;
      byKey.set(key, { ...share, inherited_from: depth === 0 ? null : { id: level.page.id, title: level.page.title } });
    }
  });
  return [...byKey.values()];
}

export function buildPageTree<T extends Pick<DocsPage, 'id' | 'parent_id'>>(pages: T[]): T[] {
  const map = new Map<string, T & { children: T[] }>();
  const roots: T[] = [];

  for (const page of pages) {
    map.set(page.id, { ...page, children: [] });
  }

  for (const page of pages) {
    const node = map.get(page.id)!;
    if (page.parent_id && map.has(page.parent_id)) {
      map.get(page.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function flattenPageTree(
  tree: DocsPage[],
  depth = 0,
): Array<DocsPage & { depth: number }> {
  const out: Array<DocsPage & { depth: number }> = [];
  for (const node of tree) {
    const { children, ...page } = node as DocsPage & { children: DocsPage[] };
    out.push({ ...page, depth });
    if (children?.length) out.push(...flattenPageTree(children, depth + 1));
  }
  return out;
}

export function stringifyBlocks(blocks: DocsBlock[]): string {
  return JSON.stringify(blocks);
}

export function defaultBlocks(): DocsBlock[] {
  return [{ id: crypto.randomUUID(), type: 'paragraph', content: '' }];
}

export function defaultDatabaseColumns(): DocsDatabaseColumn[] {
  return [
    { id: crypto.randomUUID(), name: 'Name', type: 'text' },
    {
      id: crypto.randomUUID(),
      name: 'Status',
      type: 'select',
      options: ['Todo', 'Doing', 'Done'],
    },
    { id: crypto.randomUUID(), name: 'Due', type: 'date' },
  ];
}

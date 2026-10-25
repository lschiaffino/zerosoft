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
  | 'callout'
  | 'board'
  // Archivos que se muestran en línea (subidos como image/file).
  | 'video'
  | 'audio'
  | 'pdf'
  // Columnas: `columns` contiene bloques `column` (indent + 1) y cada columna
  // a sus bloques (indent + 2). Ver lib/docs-columns.ts.
  | 'columns'
  | 'column'
  // Links con vista previa y contenido de terceros (lib/docs-embeds.ts).
  | 'bookmark'
  | 'embed'
  // Bloques avanzados.
  | 'synced'
  | 'equation'
  | 'toc'
  | 'button'
  | 'breadcrumb';

/** Niveles de anidado (Tab): el bloque cuelga del anterior con un nivel menos. */
export const DOCS_MAX_INDENT = 6;

/** Formato viejo de una base (columnas posicionales); lib/docs-database.ts lo migra al leer. */
export type DocsDatabaseColumnType = 'text' | 'number' | 'select' | 'date';

/** Vista del formato viejo. */
export type DocsDatabaseView = 'table' | 'gallery';

export interface DocsDatabaseColumn {
  id: string;
  name: string;
  type: DocsDatabaseColumnType;
  options?: string[];
}

/**
 * Base de datos estilo Notion (bloque `database`, campo `db`). Las filas son
 * páginas: valores por propiedad arriba y un cuerpo de bloques. Todo vive en
 * el content de la página (o nota) que la contiene: versiones, duplicar,
 * plantillas y exportar la llevan sin tablas aparte. Lógica pura en
 * lib/docs-database.ts.
 */
export type DbPropertyType =
  | 'title'
  | 'text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'status'
  | 'date'
  | 'person'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone'
  | 'created_time'
  | 'last_edited_time'
  // Tanda D2 (bases como Notion).
  | 'formula'
  | 'relation'
  | 'rollup'
  | 'files'
  | 'created_by'
  | 'last_edited_by'
  | 'unique_id'
  | 'button'
  | 'place';

/** Grupos fijos de una propiedad status (como en Notion). */
export type DbStatusGroup = 'todo' | 'in_progress' | 'done';

export interface DbOption {
  id: string;
  name: string;
  /** Solo status: a qué grupo pertenece la opción. */
  group?: DbStatusGroup;
}

export interface DbProperty {
  id: string;
  name: string;
  type: DbPropertyType;
  /** select, multi_select y status. */
  options?: DbOption[];
  /** formula: la expresión (lib/docs-formula.ts). */
  formula?: string;
  /** relation: a qué base apunta (y si es la vuelta de otra relación). */
  relation?: DbRelationConfig;
  /** rollup: relación, propiedad de la otra base y cálculo. */
  rollup?: DbRollupConfig;
  /** unique_id: prefijo ("TASK" → TASK-12) y próximo número a dar. */
  prefix?: string;
  next_id?: number;
  /** button: texto y acciones al hacer clic. */
  button?: DbButtonConfig;
  /** Autocompletar con IA (text, select, multi_select). */
  ai?: DbAiConfig;
  /**
   * Solo en memoria (no se guarda): tipo del resultado de una fórmula o un
   * rollup, para mostrar, filtrar y ordenar. Lo pone computeDatabase.
   */
  kind?: 'number' | 'text' | 'checkbox' | 'date';
  /** Solo en memoria: error de la fórmula (sintaxis o propiedad que no existe). */
  error?: string;
}

/** Base destino de una relación: bloque database de una página de Docs. */
export interface DbRelationConfig {
  page_id: string;
  block_id: string;
  /** 1: una sola fila; ausente: sin límite. */
  limit?: 1;
  /**
   * Relación de dos vías: id de la propiedad espejo en la otra base. Los
   * valores se guardan solo del lado que la creó; el espejo (`mirror_of`)
   * se calcula y, al editarlo, escribe en el lado original.
   */
  synced_prop?: string;
  /** Esta propiedad es el espejo de `mirror_of` (propiedad de la base destino). */
  mirror_of?: string;
}

export type DbRollupFn =
  | 'show_original'
  | 'show_unique'
  | 'count_all'
  | 'count_values'
  | 'count_unique'
  | 'count_empty'
  | 'count_not_empty'
  | 'percent_empty'
  | 'percent_not_empty'
  | 'sum'
  | 'average'
  | 'median'
  | 'min'
  | 'max'
  | 'range'
  | 'checked'
  | 'unchecked'
  | 'percent_checked'
  | 'earliest'
  | 'latest'
  | 'date_range';

export interface DbRollupConfig {
  /** Propiedad relation de esta base. */
  relation: string;
  /** Propiedad de la base relacionada. */
  property: string;
  fn: DbRollupFn;
}

/** Archivo de una propiedad files (se sirve por /api/docs/files/<página>/<id>). */
export interface DbFile {
  id: string;
  url: string;
  name: string;
  size?: number;
  mime?: string;
}

export type DbAiMode = 'summary' | 'extract' | 'translate' | 'classify' | 'custom';

export interface DbAiConfig {
  mode: DbAiMode;
  /** extract: qué sacar; custom: la instrucción. */
  prompt?: string;
  /** translate: idioma destino (en, es, pt, fr, de, it...). */
  language?: string;
  /** Rellenar solo al tocar el botón (false) o también al editar la fila (true). */
  auto?: boolean;
}

/** Acción de un botón o de una automatización de la base. */
export type DbAction =
  | { id: string; type: 'set_prop'; prop: string; value: DbValue; mode?: 'set' | 'add' | 'remove' }
  | { id: string; type: 'add_row'; target: { page_id: string; block_id: string }; title?: string; values?: Record<string, DbValue> }
  | { id: string; type: 'notify'; people?: string[]; person_prop?: string; message?: string }
  | { id: string; type: 'webhook'; url: string }
  | { id: string; type: 'open_url'; url: string };

export interface DbButtonConfig {
  label: string;
  actions: DbAction[];
}

export type DbTrigger =
  | { type: 'row_added' }
  | { type: 'prop_changed'; prop: string; to?: DbValue };

export interface DbAutomation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: DbTrigger;
  /** Solo filas que cumplen los filtros de esta vista. */
  view?: string | null;
  actions: DbAction[];
}

/**
 * Valor de una celda según el tipo: texto (title/text/url/email/phone), número,
 * id de opción (select/status), ids de opción o de persona (multi_select/person),
 * 'YYYY-MM-DD' (date) o boolean (checkbox). created/last edited no se guardan:
 * salen de la fila.
 */
export type DbValue = string | number | boolean | string[] | null;

export interface DbRow {
  id: string;
  values: Record<string, DbValue>;
  /** Cuerpo de la fila abierta como página (sin bases adentro). */
  body?: DocsBlock[];
  /** Propiedades files: archivos por id de propiedad. */
  files?: Record<string, DbFile[]>;
  created_at: string;
  updated_at: string;
  /** Quién la creó y quién la editó por última vez (los pone el servidor). */
  created_by?: string;
  updated_by?: string;
}

export type DbViewType = 'table' | 'board' | 'gallery' | 'list' | 'calendar' | 'timeline';

export type DbFilterOp =
  | 'contains'
  | 'not_contains'
  | 'is'
  | 'is_not'
  | 'starts_with'
  | 'ends_with'
  | 'empty'
  | 'not_empty'
  | 'eq'
  | 'neq'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'before'
  | 'after'
  | 'on_or_before'
  | 'on_or_after'
  | 'checked'
  | 'unchecked';

export interface DbFilter {
  id: string;
  property: string;
  op: DbFilterOp;
  value?: DbValue;
}

export interface DbSort {
  property: string;
  direction: 'asc' | 'desc';
}

export interface DbViewConfig {
  id: string;
  /** Vacío: se muestra el nombre del tipo de vista traducido. */
  name: string;
  type: DbViewType;
  /** Condiciones en AND. */
  filters?: DbFilter[];
  /** Orden por varias claves (la primera manda). */
  sorts?: DbSort[];
  /** Agrupar (tabla) o columnas (board): select, status, person o checkbox. */
  group_by?: string | null;
  /** Propiedades ocultas en esta vista. */
  hidden?: string[];
  /** Ancho de columna (px) por propiedad, en la tabla. */
  widths?: Record<string, number>;
  /** Board: subgrupos (filas de columnas) por otra propiedad. */
  sub_group_by?: string | null;
  /** Calendario y timeline: propiedad fecha (inicio en timeline). */
  date_by?: string | null;
  /** Timeline: propiedad fecha de fin (sin ella, la barra dura un día). */
  end_by?: string | null;
  /** Timeline: escala. */
  zoom?: 'week' | 'month' | 'quarter';
}

export interface DocsDatabase {
  properties: DbProperty[];
  rows: DbRow[];
  views: DbViewConfig[];
  /** Vista abierta (la que muestran las vistas de solo lectura). */
  active_view?: string;
  /** Nombre de la base (encabezado y breadcrumb de una fila abierta). */
  title?: string;
  /** Plantillas de fila: "Nuevo" puede crear la fila desde una de estas. */
  templates?: DbRowTemplate[];
  /** Automatizaciones (disparador → acciones). */
  automations?: DbAutomation[];
}

/** Plantilla de fila de una base: valores iniciales y cuerpo. */
export interface DbRowTemplate {
  id: string;
  name: string;
  values: Record<string, DbValue>;
  body?: DocsBlock[];
}

/**
 * Vista vinculada (linked database): un bloque database que muestra otra
 * base (de esta u otra página) con sus propias vistas. Filas y propiedades
 * son las de la base de origen; solo las vistas viven en este bloque.
 */
export interface DbLinkedSource {
  page_id: string;
  block_id: string;
  views: DbViewConfig[];
  active_view?: string;
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
  /** Bloque database (formato actual; `columns`/`rows`/`view` son el viejo). */
  db?: DocsDatabase;
  /** Bloque database que es una vista vinculada de otra base (sin `db` propio). */
  linked?: DbLinkedSource;
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
  /**
   * Bloque board: id de la pizarra embebida. La vista previa (nombre y
   * miniatura) se pide a /api/boards/<id>/embed, que chequea que quien mira
   * la página pueda ver la pizarra.
   */
  board_id?: string;
  /** Imagen, video, PDF o embed: ancho en % del ancho de la página (10-100). */
  width?: number;
  /** Imagen: alineación. */
  align?: 'left' | 'center' | 'right';
  /** Leyenda (HTML-lite) de imagen, video, audio, PDF, archivo, bookmark o embed. */
  caption?: string;
  /** Columna: peso relativo del ancho (las columnas de una fila suman lo que sumen). */
  ratio?: number;
  /**
   * Bookmark y embed: link externo (http/https) y los metadatos que trajo el
   * servidor (lib/docs-unfurl.ts). La imagen y el favicon son URLs externas
   * que se muestran con <img>; el iframe del embed se arma siempre desde
   * `link.url` (lib/docs-embeds.ts), nunca desde algo guardado.
   */
  link?: DocsLinkPreview;
  /** Embed: alto del iframe en px. */
  height?: number;
  /** Bloque sincronizado: id del contenido compartido (tabla docs_synced_blocks). */
  synced_id?: string;
  /**
   * Bloque sincronizado que quien mira no puede ver (no puede abrir su página
   * de origen): llega sin hijos. Lo pone el servidor al leer; nunca se guarda.
   */
  no_access?: boolean;
  /** Botón: qué hace al hacer clic. */
  button?: DocsButtonConfig;
  /** Bloque sugerido (Enter en modo sugerir): se acepta o se rechaza entero. */
  suggestion?: { id: string; by: string } | null;
}

export interface DocsLinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  site?: string;
  favicon?: string;
}

export interface DocsButtonConfig {
  label: string;
  action: 'insert' | 'link';
  /** action 'link': adónde va (http/https o una ruta relativa). */
  url?: string;
  /** action 'insert': los bloques que agrega debajo del botón, en Markdown. */
  markdown?: string;
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
  /** Posición vertical de la portada (0 arriba, 100 abajo; default 50). */
  cover_position?: number;
  /** Bloqueada: nadie edita el contenido hasta desbloquearla. */
  locked?: boolean;
  locked_by?: string | null;
  /** Rol de los miembros del workspace en esta página (null = el que hereda). */
  member_role?: DocsShareRole | null;
  teamspace_id?: string | null;
  /** Wiki: dueño de la página y verificación (hasta una fecha o sin vencimiento). */
  page_owner_id?: string | null;
  verified_by?: string | null;
  verified_at?: string | null;
  verified_until?: string | null;
  created_at: string;
  updated_at: string;
}

/** Lo que necesitan el árbol del sidebar y las listas: sin content (que pesa). */
export type DocsPageSummary = Pick<DocsPage, 'id' | 'parent_id' | 'title' | 'icon' | 'position' | 'updated_at'> & {
  teamspace_id?: string | null;
  /** Wiki: verificada o vencida (null/ausente = sin verificar). */
  verified?: 'verified' | 'expired' | null;
};

export interface DocsPageShare {
  id: string;
  page_id: string;
  kind: 'public' | 'team' | 'user';
  target_id: string | null;
  role: DocsShareRole;
  created_at: string;
  /** Share heredado de un ancestro (null/ausente = propio de esta página). */
  inherited_from?: { id: string; title: string } | null;
  /** Persona del share (para el diálogo de compartir); guest = no es del workspace. */
  target_name?: string | null;
  target_email?: string | null;
  guest?: boolean;
}

export type DocsShareRole = 'view' | 'comment' | 'edit' | 'full';

/**
 * Acceso efectivo de quien abre una página: 'owner' = miembro del workspace
 * con acceso total (compartir, publicar, mover, papelera); 'full' = invitado
 * que además de editar comparte esa página.
 */
export type DocsAccess = 'owner' | 'full' | 'edit' | 'comment' | 'view';

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
  /** Comentario sobre texto: id del resaltado en el bloque y el texto citado. */
  anchor_id?: string | null;
  quote?: string;
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

/**
 * Los bloques de una página más los del cuerpo de cada fila de sus bases
 * (archivos, links y búsqueda los recorren igual que a los de la página).
 */
export function withDatabaseBodies(blocks: DocsBlock[]): DocsBlock[] {
  if (!blocks.some((b) => b.type === 'database' && b.db?.rows?.some((r) => r.body?.length))) return blocks;
  const out: DocsBlock[] = [];
  for (const b of blocks) {
    out.push(b);
    if (b.type !== 'database' || !b.db?.rows) continue;
    for (const r of b.db.rows) if (r.body?.length) out.push(...r.body);
  }
  return out;
}

/**
 * Encabezados de una base (nombres de las columnas, en orden) para las vistas
 * de solo lectura; null si el bloque no es una base o no tiene columnas.
 */
export function databaseHeader(block: Pick<DocsBlock, 'type' | 'columns'>): string[] | null {
  if (block.type !== 'database' || !block.columns?.length) return null;
  return block.columns.map((c) => c.name);
}

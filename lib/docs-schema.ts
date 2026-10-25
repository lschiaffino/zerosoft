/**
 * Docs — schemas zod para payloads de rutas API.
 */
import { z } from 'zod';
import { DOCS_MAX_INDENT } from './docs-types';

/** Topes de un PATCH de página: el editor los chequea antes de mandar. */
export const DOCS_BLOCK_MAX = 20000;
export const DOCS_TITLE_MAX = 500;

const id = z.string().min(1).max(64);
const shortText = z.string().trim().max(DOCS_TITLE_MAX);
// Sin trim: en un bloque de código la indentación inicial y los saltos finales
// son parte del contenido.
const blockText = z.string().max(DOCS_BLOCK_MAX);

const docsBlockType = z.enum([
  'paragraph',
  'heading',
  'bulleted_list_item',
  'numbered_list_item',
  'todo',
  'quote',
  'code',
  'divider',
  'table',
  'database',
  'image',
  'file',
  'toggle',
  'callout',
  'board',
  'video',
  'audio',
  'pdf',
  'columns',
  'column',
  'bookmark',
  'embed',
  'synced',
  'equation',
  'toc',
  'button',
  'breadcrumb',
  'meeting',
]);

const docsLinkSchema = z.object({
  url: z.string().max(2048),
  title: z.string().max(1000).optional(),
  description: z.string().max(2000).optional(),
  image: z.string().max(2048).optional(),
  site: z.string().max(500).optional(),
  favicon: z.string().max(2048).optional(),
});

const docsButtonSchema = z.object({
  label: z.string().max(500),
  action: z.enum(['insert', 'link']),
  url: z.string().max(2048).optional(),
  markdown: z.string().max(10000).optional(),
});

const docsDatabaseColumnSchema = z.object({
  id: z.string().min(1).max(64),
  name: shortText,
  type: z.enum(['text', 'number', 'select', 'date']),
  options: z.array(shortText).max(30).optional(),
});

const dbId = z.string().min(1).max(64);
const dbValue = z.union([
  z.string().max(DOCS_BLOCK_MAX),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(64)).max(100),
  z.null(),
]);
const dbOption = z.object({
  id: dbId,
  name: shortText,
  group: z.enum(['todo', 'in_progress', 'done']).optional(),
});
// Vacío: acción recién agregada, sin base elegida (borrador: se guarda y el motor la saltea).
const dbTarget = z.object({ page_id: z.string().max(64), block_id: z.string().max(64) });
/** Acción de un botón o automatización (lib/docs-db-ops.ts). */
const dbAction = z.discriminatedUnion('type', [
  z.object({ id: dbId, type: z.literal('set_prop'), prop: dbId, value: dbValue, mode: z.enum(['set', 'add', 'remove']).optional() }),
  z.object({ id: dbId, type: z.literal('add_row'), target: dbTarget, title: z.string().max(500).optional(), values: z.record(dbValue).optional() }),
  z.object({
    id: dbId,
    type: z.literal('notify'),
    people: z.array(dbId).max(20).optional(),
    person_prop: dbId.optional(),
    message: z.string().max(1000).optional(),
  }),
  z.object({ id: dbId, type: z.literal('webhook'), url: z.string().max(2048) }),
  z.object({ id: dbId, type: z.literal('open_url'), url: z.string().max(2048) }),
]);
const dbProperty = z.object({
  id: dbId,
  name: shortText,
  type: z.enum([
    'title',
    'text',
    'number',
    'select',
    'multi_select',
    'status',
    'date',
    'person',
    'checkbox',
    'url',
    'email',
    'phone',
    'created_time',
    'last_edited_time',
    'formula',
    'relation',
    'rollup',
    'files',
    'created_by',
    'last_edited_by',
    'unique_id',
    'button',
    'place',
  ]),
  options: z.array(dbOption).max(100).optional(),
  formula: z.string().max(4000).optional(),
  relation: z
    .object({
      page_id: dbId,
      block_id: dbId,
      limit: z.literal(1).optional(),
      synced_prop: dbId.optional(),
      mirror_of: dbId.optional(),
    })
    .optional(),
  rollup: z
    .object({
      relation: dbId,
      property: dbId,
      fn: z.enum([
        'show_original',
        'show_unique',
        'count_all',
        'count_values',
        'count_unique',
        'count_empty',
        'count_not_empty',
        'percent_empty',
        'percent_not_empty',
        'sum',
        'average',
        'median',
        'min',
        'max',
        'range',
        'checked',
        'unchecked',
        'percent_checked',
        'earliest',
        'latest',
        'date_range',
      ]),
    })
    .optional(),
  prefix: z.string().max(20).optional(),
  next_id: z.number().int().min(1).max(1_000_000_000).optional(),
  button: z.object({ label: shortText, actions: z.array(dbAction).max(10) }).optional(),
  ai: z
    .object({
      mode: z.enum(['summary', 'extract', 'translate', 'classify', 'custom']),
      prompt: z.string().max(2000).optional(),
      language: z.string().max(40).optional(),
      auto: z.boolean().optional(),
    })
    .optional(),
});
const dbFilter = z.object({
  id: dbId,
  property: dbId,
  op: z.enum([
    'contains',
    'not_contains',
    'is',
    'is_not',
    'starts_with',
    'ends_with',
    'empty',
    'not_empty',
    'eq',
    'neq',
    'gt',
    'lt',
    'gte',
    'lte',
    'before',
    'after',
    'on_or_before',
    'on_or_after',
    'checked',
    'unchecked',
  ]),
  value: dbValue.optional(),
});
const dbView = z.object({
  id: dbId,
  name: shortText,
  type: z.enum(['table', 'board', 'gallery', 'list', 'calendar', 'timeline']),
  filters: z.array(dbFilter).max(20).optional(),
  sorts: z.array(z.object({ property: dbId, direction: z.enum(['asc', 'desc']) })).max(10).optional(),
  group_by: dbId.nullish(),
  hidden: z.array(dbId).max(40).optional(),
  widths: z.record(z.number().min(40).max(2000)).optional(),
  sub_group_by: dbId.nullish(),
  date_by: dbId.nullish(),
  end_by: dbId.nullish(),
  zoom: z.enum(['week', 'month', 'quarter']).optional(),
});

/** Bloque sin base adentro: el cuerpo de una fila no anida bases. */
const docsBaseBlockSchema = z.object({
  id: z.string().min(1).max(64),
  type: docsBlockType,
  content: blockText,
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  checked: z.boolean().optional(),
  language: z.string().max(40).optional(),
  rows: z.array(z.array(blockText)).optional(),
  columns: z.array(docsDatabaseColumnSchema).max(30).optional(),
  view: z.enum(['table', 'gallery']).optional(),
  // Bloques image/file (sanitizeBlocks descarta la URL si no es del storage).
  url: z.string().max(2048).optional(),
  name: z.string().max(255).optional(),
  size: z.number().int().min(0).max(5 * 1024 * 1024 * 1024).optional(),
  mime: z.string().max(255).optional(),
  indent: z.number().int().min(0).max(DOCS_MAX_INDENT).optional(),
  collapsed: z.boolean().optional(),
  toggle: z.boolean().optional(),
  icon: z.string().max(16).optional(),
  // Bloque board (sanitizeBlocks lo descarta si no es un id válido o el bloque no es board).
  board_id: z.string().max(64).optional(),
  // Bloques nuevos (sanitizeBlocks valida cada campo según el tipo).
  width: z.number().min(0).max(100).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  caption: z.string().max(4000).optional(),
  ratio: z.number().min(0).max(100).optional(),
  link: docsLinkSchema.optional(),
  height: z.number().min(0).max(4000).optional(),
  synced_id: z.string().max(64).optional(),
  synced_at: z.string().max(40).optional(),
  button: docsButtonSchema.optional(),
  // Bloque sugerido en modo sugerir (sanitizeBlocks valida los ids).
  suggestion: z.object({ id: z.string().max(64), by: z.string().max(64) }).nullish(),
  // Notas de reunión (sanitizeBlocks lo descarta si el bloque no es meeting).
  meeting_id: z.string().max(64).optional(),
});

const dbFile = z.object({
  id: dbId,
  url: z.string().max(2048),
  name: z.string().max(255),
  size: z.number().int().min(0).max(1024 * 1024 * 1024).optional(),
  mime: z.string().max(255).optional(),
});

const dbRow = z.object({
  id: dbId,
  values: z.record(dbValue),
  body: z.array(docsBaseBlockSchema).max(500).optional(),
  files: z.record(z.array(dbFile).max(20)).optional(),
  created_at: z.string().max(40),
  updated_at: z.string().max(40),
  created_by: dbId.optional(),
  updated_by: dbId.optional(),
});

const dbAutomation = z.object({
  id: dbId,
  name: shortText,
  enabled: z.boolean(),
  trigger: z.discriminatedUnion('type', [
    z.object({ type: z.literal('row_added') }),
    z.object({ type: z.literal('prop_changed'), prop: dbId, to: dbValue.optional() }),
  ]),
  view: dbId.nullish(),
  actions: z.array(dbAction).max(10),
});

/** Base de datos de un bloque `database` (ver lib/docs-database.ts; el servidor la sanea igual). */
export const docsDatabaseSchema = z.object({
  properties: z.array(dbProperty).min(1).max(40),
  rows: z.array(dbRow).max(2000),
  views: z.array(dbView).min(1).max(20),
  active_view: dbId.optional(),
  title: shortText.optional(),
  templates: z
    .array(
      z.object({
        id: dbId,
        name: shortText,
        values: z.record(dbValue),
        body: z.array(docsBaseBlockSchema).max(500).optional(),
      }),
    )
    .max(30)
    .optional(),
  automations: z.array(dbAutomation).max(20).optional(),
  sync: z
    .object({
      source_id: dbId,
      provider: z.enum(['github', 'jira', 'salesforce', 'crm']),
      label: shortText,
      synced_at: z.string().max(40).optional(),
    })
    .optional(),
});

/** Vista vinculada: el bloque guarda solo sus vistas; filas y propiedades son de la base de origen. */
export const docsLinkedSourceSchema = z.object({
  page_id: dbId,
  block_id: dbId,
  views: z.array(dbView).min(1).max(20),
  active_view: dbId.optional(),
});

export const docsBlockSchema = docsBaseBlockSchema.extend({
  db: docsDatabaseSchema.optional(),
  linked: docsLinkedSourceSchema.optional(),
});

/** Operaciones sobre una base de otra página (lib/docs-db-ops.ts). */
const dbPropertyFull = dbProperty;
export const docsDbOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_cell'), row: dbId, prop: dbId, value: dbValue }),
  z.object({ op: z.literal('relation'), row: dbId, prop: dbId, add: z.array(dbId).max(100).optional(), remove: z.array(dbId).max(100).optional() }),
  z.object({
    op: z.literal('add_row'),
    id: dbId.optional(),
    values: z.record(dbValue).optional(),
    title: z.string().max(500).optional(),
    body: z.array(docsBaseBlockSchema).max(500).optional(),
    files: z.record(z.array(dbFile).max(20)).optional(),
    before: dbId.nullish(),
  }),
  z.object({ op: z.literal('delete_rows'), rows: z.array(dbId).max(2000) }),
  z.object({ op: z.literal('set_body'), row: dbId, body: z.array(docsBaseBlockSchema).max(500) }),
  z.object({ op: z.literal('set_files'), row: dbId, prop: dbId, files: z.array(dbFile).max(20) }),
  z.object({ op: z.literal('move_row'), row: dbId, before: dbId.nullable() }),
  z.object({ op: z.literal('add_property'), property: dbPropertyFull }),
  z.object({ op: z.literal('update_property'), property: dbPropertyFull }),
  z.object({ op: z.literal('remove_property'), prop: dbId }),
  z.object({ op: z.literal('set_title'), title: shortText }),
  z.object({ op: z.literal('set_automations'), automations: z.array(dbAutomation).max(20) }),
]);

export const docsDbOpsSchema = z.object({
  ops: z.array(docsDbOpSchema).min(1).max(500),
  /**
   * Segunda escritura en la misma request (relación de dos vías: la propiedad
   * espejo en la otra base y el `synced_prop` en esta). La hace el servidor
   * aunque la pestaña se cierre; si falla, aplica `undo` a la primera.
   */
  also: z.object({ page_id: dbId, block_id: dbId, ops: z.array(docsDbOpSchema).min(1).max(20) }).optional(),
  undo: z.array(docsDbOpSchema).max(20).optional(),
});

/** Correr las acciones de afuera de un botón (notificar, webhook, agregar fila en otra base). */
export const docsDbRunSchema = z.object({
  row_id: dbId,
  prop_id: dbId,
  /** La fila como la ve el editor (puede no estar guardada todavía): para el mensaje y el webhook. */
  row: z.object({ title: z.string().max(2000), values: z.record(z.string().max(2000)) }).optional(),
  actions: z.array(dbAction).max(10),
});

/** Autocompletar con IA una propiedad en varias filas. */
export const docsDbAutofillSchema = z.object({
  block_id: dbId,
  prop_id: dbId,
  ai: z.object({
    mode: z.enum(['summary', 'extract', 'translate', 'classify', 'custom']),
    prompt: z.string().max(2000).optional(),
    language: z.string().max(40).optional(),
  }),
  /** Para classify: las opciones que se pueden elegir. */
  options: z.array(z.object({ id: dbId, name: shortText })).max(100).optional(),
  multi: z.boolean().optional(),
  rows: z
    .array(z.object({ id: dbId, title: z.string().max(2000), properties: z.string().max(8000), body: z.string().max(20000) }))
    .min(1)
    .max(25),
});

export const docPageCreateSchema = z.object({
  title: shortText.optional(),
  parent_id: id.nullish(),
  teamspace_id: id.nullish(),
  icon: shortText.nullish(),
  cover_url: shortText.nullish(),
});

export const docPageUpdateSchema = z.object({
  title: shortText.optional(),
  icon: shortText.nullish(),
  cover_url: shortText.nullish(),
  content: z.array(docsBlockSchema).optional(),
  parent_id: id.nullish(),
  is_public: z.boolean().optional(),
  published: z.boolean().optional(),
  archived: z.boolean().optional(),
  small_text: z.boolean().optional(),
  full_width: z.boolean().optional(),
  inherit_shares: z.boolean().optional(),
  cover_position: z.number().min(0).max(100).optional(),
  /** Bloquear la página (nadie edita el contenido; los comentarios siguen). */
  locked: z.boolean().optional(),
  /** "Desbloquear solo para mí": quien puede editar guarda sin quitar el bloqueo a los demás. */
  bypass_lock: z.boolean().optional(),
  /** Rol de los miembros del workspace en esta página y subpáginas (null = hereda). */
  member_role: z.enum(['view', 'comment', 'edit', 'full']).nullable().optional(),
  /** Wiki: dueño de la página. */
  page_owner_id: id.nullable().optional(),
  /** Idioma y zona horaria del navegador: los recordatorios de fecha avisan en ese idioma. */
  locale: z.enum(['en', 'es', 'pt']).optional(),
  timezone: z.string().max(64).optional(),
  /** updated_at sobre el que se editó (concurrencia optimista: 409 si cambió). */
  base_updated_at: z.string().min(1).max(64).optional(),
  /** "Sobrescribir" tras un conflicto: fusiona y en lo que choca gana lo que llega. */
  merge: z.literal('ours').optional(),
});

export const docShareRoleSchema = z.enum(['view', 'comment', 'edit', 'full']);

/** Compartir con un team/persona por id, o con una persona por email. */
export const docShareCreateSchema = z.object({
  kind: z.enum(['public', 'team', 'user']),
  target_id: id.nullish(),
  email: z.string().trim().toLowerCase().email({ message: 'invalid_email' }).max(254).optional(),
  role: docShareRoleSchema.optional(),
});

export const docShareUpdateSchema = z.object({
  role: docShareRoleSchema,
});

/** Campos que puede tocar alguien con un share de edición (no el dueño). */
export const SHARED_EDITABLE_FIELDS = ['title', 'icon', 'cover_url', 'cover_position', 'content', 'base_updated_at', 'merge', 'locale', 'timezone'] as const;

export const docCommentCreateSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  block_id: id.nullish(),
  /** Respuesta a un hilo (id de cualquier comentario del hilo). */
  parent_id: id.nullish(),
  /** Personas elegidas en el popover de @ (el server valida que sean del workspace). */
  mention_ids: z.array(id).max(20).optional(),
  /** Comentario sobre texto: id del resaltado `<span data-comment>` y el texto citado. */
  anchor_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).nullish(),
  quote: z.string().max(500).optional(),
});

export const docCommentUpdateSchema = z.object({
  resolved: z.boolean(),
});

/** Guardar una página como plantilla del workspace. */
export const docTemplateCreateSchema = z.object({
  page_id: id,
  title: shortText.optional(),
  description: z.string().trim().max(300).optional(),
});

export const docMentionCreateSchema = z.object({
  user_id: id,
});

/** true si el título o algún bloque/celda supera el tope del servidor (el PATCH entero se rechazaría). */
type PatchBlock = {
  content?: string | null;
  rows?: string[][] | null;
  db?: { rows?: Array<{ values?: Record<string, unknown>; body?: PatchBlock[] }> } | null;
};

function blockTooLong(b: PatchBlock): boolean {
  if ((b.content ?? '').length > DOCS_BLOCK_MAX) return true;
  if ((b.rows ?? []).some((r) => r.some((c) => c.length > DOCS_BLOCK_MAX))) return true;
  return (b.db?.rows ?? []).some(
    (r) =>
      Object.values(r.values ?? {}).some((v) => typeof v === 'string' && v.length > DOCS_BLOCK_MAX) ||
      (r.body ?? []).some(blockTooLong),
  );
}

export function docsPatchTooLong(patch: { title?: string | null; content?: PatchBlock[] | null }): boolean {
  if ((patch.title ?? '').trim().length > DOCS_TITLE_MAX) return true;
  return (patch.content ?? []).some(blockTooLong);
}

/**
 * Idioma y zona horaria que viajan con un guardado de contenido: los
 * recordatorios de fecha (@recordar) avisan en la campana y por email con
 * ellos. Solo si el PATCH trae contenido; lo inválido no se manda.
 */
export function reminderContext(
  patch: { content?: unknown },
  locale: string | null | undefined,
  timezone: string | null | undefined,
): { locale?: 'en' | 'es' | 'pt'; timezone?: string } {
  if (!('content' in patch) || patch.content == null) return {};
  const out: { locale?: 'en' | 'es' | 'pt'; timezone?: string } = {};
  if (locale === 'en' || locale === 'es' || locale === 'pt') out.locale = locale;
  if (timezone && timezone.length <= 64) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
      out.timezone = timezone;
    } catch {
      /* zona inválida: el servidor usa la cookie o UTC */
    }
  }
  return out;
}

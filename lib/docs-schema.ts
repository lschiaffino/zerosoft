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
]);

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
  ]),
  options: z.array(dbOption).max(100).optional(),
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
  type: z.enum(['table', 'board', 'gallery']),
  filters: z.array(dbFilter).max(20).optional(),
  sorts: z.array(z.object({ property: dbId, direction: z.enum(['asc', 'desc']) })).max(10).optional(),
  group_by: dbId.nullish(),
  hidden: z.array(dbId).max(40).optional(),
  widths: z.record(z.number().min(40).max(2000)).optional(),
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
  size: z.number().int().min(0).max(1024 * 1024 * 1024).optional(),
  mime: z.string().max(255).optional(),
  indent: z.number().int().min(0).max(DOCS_MAX_INDENT).optional(),
  collapsed: z.boolean().optional(),
  toggle: z.boolean().optional(),
  icon: z.string().max(16).optional(),
  // Bloque board (sanitizeBlocks lo descarta si no es un id válido o el bloque no es board).
  board_id: z.string().max(64).optional(),
});

const dbRow = z.object({
  id: dbId,
  values: z.record(dbValue),
  body: z.array(docsBaseBlockSchema).max(500).optional(),
  created_at: z.string().max(40),
  updated_at: z.string().max(40),
});

/** Base de datos de un bloque `database` (ver lib/docs-database.ts; el servidor la sanea igual). */
export const docsDatabaseSchema = z.object({
  properties: z.array(dbProperty).min(1).max(40),
  rows: z.array(dbRow).max(2000),
  views: z.array(dbView).min(1).max(20),
  active_view: dbId.optional(),
  title: shortText.optional(),
});

export const docsBlockSchema = docsBaseBlockSchema.extend({
  db: docsDatabaseSchema.optional(),
});

export const docPageCreateSchema = z.object({
  title: shortText.optional(),
  parent_id: id.nullish(),
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
  /** updated_at sobre el que se editó (concurrencia optimista: 409 si cambió). */
  base_updated_at: z.string().min(1).max(64).optional(),
});

export const docShareRoleSchema = z.enum(['view', 'edit']);

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
export const SHARED_EDITABLE_FIELDS = ['title', 'icon', 'cover_url', 'content', 'base_updated_at'] as const;

export const docCommentCreateSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  block_id: id.nullish(),
  /** Respuesta a un hilo (id de cualquier comentario del hilo). */
  parent_id: id.nullish(),
  /** Personas elegidas en el popover de @ (el server valida que sean del workspace). */
  mention_ids: z.array(id).max(20).optional(),
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

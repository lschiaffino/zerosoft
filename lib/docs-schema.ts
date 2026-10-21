/**
 * Docs — schemas zod para payloads de rutas API.
 */
import { z } from 'zod';

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
  'board',
]);

const docsDatabaseColumnSchema = z.object({
  id: z.string().min(1).max(64),
  name: shortText,
  type: z.enum(['text', 'number', 'select', 'date']),
  options: z.array(shortText).max(30).optional(),
});

export const docsBlockSchema = z.object({
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
  // Bloque board (sanitizeBlocks lo descarta si no es un id válido o el bloque no es board).
  board_id: z.string().max(64).optional(),
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
});

export const docCommentUpdateSchema = z.object({
  resolved: z.boolean(),
});

export const docMentionCreateSchema = z.object({
  user_id: id,
});

/** true si el título o algún bloque/celda supera el tope del servidor (el PATCH entero se rechazaría). */
export function docsPatchTooLong(patch: {
  title?: string | null;
  content?: Array<{ content?: string | null; rows?: string[][] | null }> | null;
}): boolean {
  if ((patch.title ?? '').trim().length > DOCS_TITLE_MAX) return true;
  return (patch.content ?? []).some(
    (b) =>
      (b.content ?? '').length > DOCS_BLOCK_MAX ||
      (b.rows ?? []).some((r) => r.some((c) => c.length > DOCS_BLOCK_MAX)),
  );
}

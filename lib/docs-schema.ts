/**
 * Docs — schemas zod para payloads de rutas API.
 */
import { z } from 'zod';

const id = z.string().min(1).max(64);
const shortText = z.string().trim().max(500);
const longText = z.string().trim().max(20000);

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
]);

const docsBlockSchema = z.object({
  id: z.string().min(1).max(64),
  type: docsBlockType,
  content: longText,
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  checked: z.boolean().optional(),
  language: z.string().max(40).optional(),
  rows: z.array(z.array(longText)).optional(),
});

export const docPageCreateSchema = z.object({
  title: shortText.optional(),
  parent_id: id.nullish(),
  icon: shortText.nullish(),
});

export const docPageUpdateSchema = z.object({
  title: shortText.optional(),
  icon: shortText.nullish(),
  content: z.array(docsBlockSchema).optional(),
  parent_id: id.nullish(),
  is_public: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export const docShareCreateSchema = z.object({
  kind: z.enum(['public', 'team', 'user']),
  target_id: id.nullish(),
});

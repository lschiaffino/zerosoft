/**
 * Notes — schemas zod de las rutas API.
 */
import { z } from 'zod';
import { docsBlockSchema } from './docs-schema';

const id = z.string().min(1).max(64);
const tag = z.string().trim().min(1).max(60);
const url = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => /^https?:\/\//i.test(v), 'invalid_url');

export const noteCreateSchema = z.object({
  /** Id generado por el cliente (creación optimista). */
  id: z.string().uuid().optional(),
  title: z.string().max(300).optional(),
  content: z.array(docsBlockSchema).max(2000).optional(),
  notebook_id: id.nullish(),
  tags: z.array(tag).max(20).optional(),
  pinned: z.boolean().optional(),
  source_url: url.nullish(),
});

export const noteUpdateSchema = z.object({
  title: z.string().max(300).optional(),
  content: z.array(docsBlockSchema).max(2000).optional(),
  notebook_id: id.nullable().optional(),
  tags: z.array(tag).max(20).optional(),
  pinned: z.boolean().optional(),
  trashed: z.boolean().optional(),
  /** `updated_at` que conoce el cliente: si la nota cambió desde entonces, 409. */
  base_updated_at: z.string().max(40).optional(),
});

export const notebookSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const noteShareSchema = z.object({
  shared: z.boolean(),
});

export const noteAskSchema = z.object({
  question: z.string().trim().min(2).max(500),
});

export const noteClipSchema = z.object({
  url,
  title: z.string().max(300).optional(),
  selection: z.string().max(8000).optional(),
});

export const noteReminderSchema = z.object({
  /** Fecha y hora ISO (con zona) del aviso. */
  at: z.string().min(10).max(40),
  /** Zona IANA del navegador (para mostrar la hora en el email). */
  timezone: z.string().max(64).optional(),
  locale: z.enum(['en', 'es', 'pt']).optional(),
});

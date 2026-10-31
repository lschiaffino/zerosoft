/**
 * Notes — schemas zod de las rutas API.
 */
import { z } from 'zod';
import { docsBlockSchema } from './docs-schema';

const id = z.string().min(1).max(64);
const tag = z.string().trim().min(1).max(60);
const b64 = (min: number, max: number) => z.string().min(min).max(max).regex(/^[A-Za-z0-9+/]+=*$/);
/** Base64 de exactamente n bytes. */
const b64Bytes = (n: number) => z.string().length(Math.ceil(n / 3) * 4).regex(/^[A-Za-z0-9+/]+=*$/);

/**
 * Sobre de una nota bloqueada (lo arma el navegador, ver lib/notes-crypto.ts):
 * sal de 16 bytes, IV de 12, texto cifrado con su tag de 16 y el SHA-256 de la
 * prueba de la contraseña. Cualquier otra forma se rechaza.
 */
export const noteLockEnvelopeSchema = z.object({
  v: z.union([z.literal(1), z.literal(2)]),
  iter: z.number().int().min(100_000).max(5_000_000),
  salt: b64Bytes(16),
  iv: b64Bytes(12),
  ct: b64(24, 8_000_000),
  vh: b64Bytes(32),
  hint: z.string().trim().max(120).optional(),
});

/** Prueba de la contraseña (32 bytes en base64): el servidor compara su SHA-256 con el vh del sobre. */
export const noteLockProofSchema = b64Bytes(32);
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
  /** Nota bloqueada: el sobre cifrado de nuevo con los cambios, y la prueba de la contraseña. */
  lock: noteLockEnvelopeSchema.optional(),
  lock_proof: noteLockProofSchema.optional(),
});

/** Bloquear (lock) o sacar el bloqueo (unlock, con el contenido ya descifrado). */
export const noteLockSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('lock'),
    lock: noteLockEnvelopeSchema,
    /** Bloques de la nota: el servidor se queda solo con los de archivos. */
    content: z.array(docsBlockSchema).max(2000),
    base_updated_at: z.string().max(40).optional(),
  }),
  z.object({
    action: z.literal('unlock'),
    proof: noteLockProofSchema,
    title: z.string().max(300).optional(),
    content: z.array(docsBlockSchema).max(2000),
    base_updated_at: z.string().max(40).optional(),
  }),
]);

const stackName = z.string().trim().max(80);

export const notebookSchema = z.object({
  name: z.string().trim().min(1).max(80),
  stack: stackName.nullish(),
});

/** PATCH de una libreta: nombre y/o pila (null o '' la saca de la pila). */
export const notebookPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    stack: stackName.nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.stack !== undefined, 'empty');

/** Renombrar una pila (to) o deshacerla (to null). */
export const stackPatchSchema = z.object({
  from: stackName.min(1),
  to: stackName.nullable(),
});

/** Renombrar una etiqueta (con sus hijas) en todas las notas. */
export const tagRenameSchema = z.object({
  from: tag,
  to: tag,
});

export const noteTemplateCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  title: z.string().max(300).optional(),
  content: z.array(docsBlockSchema).max(2000),
});

export const noteTemplatePatchSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const savedSearchCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  query: z.string().trim().min(1).max(200),
});

export const savedSearchPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    query: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => v.name !== undefined || v.query !== undefined, 'empty');

export const NOTES_BULK_MAX = 500;
export const NOTES_BULK_ACTIONS = ['move', 'tag', 'untag', 'pin', 'unpin', 'trash', 'restore', 'delete'] as const;

/** Acciones sobre varias notas a la vez (selección en la lista). */
export const noteBulkSchema = z.object({
  ids: z.array(id).min(1).max(NOTES_BULK_MAX),
  action: z.enum(NOTES_BULK_ACTIONS),
  notebook_id: id.nullable().optional(),
  tag: tag.optional(),
});

export const noteShareSchema = z.object({
  shared: z.boolean(),
});

/** Compartir con una persona del workspace (role null = dejar de compartir). */
export const notePeopleShareSchema = z.object({
  personId: z.string().min(1).max(128),
  role: z.enum(['view', 'edit']).nullable(),
});

/** Nota → issues de Track: la nota entera o tareas elegidas, con link de vuelta. */
export const noteTrackSchema = z.object({
  projectId: id,
  /** Ids de bloques todo; sin ellos, un issue con toda la nota. */
  blockIds: z.array(id).min(1).max(50).optional(),
  base_updated_at: z.string().max(40).optional(),
  locale: z.enum(['en', 'es', 'pt']).optional(),
});

export const noteAskSchema = z.object({
  question: z.string().trim().min(2).max(500),
});

export const noteClipSchema = z.object({
  url,
  title: z.string().max(300).optional(),
  selection: z.string().max(8000).optional(),
  /** bookmark: solo el link. selection: lo marcado. article y page: el contenido de la página. */
  mode: z.enum(['bookmark', 'selection', 'article', 'page']).default('selection'),
  /** La página tal como la ve la persona (bookmarklet). */
  html: z.string().max(2_000_000).optional(),
});

export const noteReminderSchema = z.object({
  /** Fecha y hora ISO (con zona) del aviso. */
  at: z.string().min(10).max(40),
  /** Zona IANA del navegador (para mostrar la hora en el email). */
  timezone: z.string().max(64).optional(),
  locale: z.enum(['en', 'es', 'pt']).optional(),
});

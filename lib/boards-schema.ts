import { z } from 'zod';
import { BOARD_TEMPLATES } from './board-templates';

export const boardCreateSchema = z.object({
  name: z.string().trim().max(120).optional(),
  template: z.enum(BOARD_TEMPLATES).optional(),
  locale: z.string().max(8).optional(),
});

export const boardRenameSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const boardThumbnailSchema = z.object({
  thumbnail: z.string().min(1).max(400_000),
});

export const boardSceneSchema = z.object({
  version: z.number().int().min(1),
  scene: z.object({
    elements: z.array(z.record(z.unknown())).max(50_000),
    appState: z.record(z.unknown()).default({}),
    files: z.record(z.unknown()).default({}),
  }),
  thumbnail: z.string().max(400_000).nullish(),
});

export const boardShareSchema = z.object({
  shared: z.boolean(),
});

export const boardRestoreSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const boardCommentCreateSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  elementId: z.string().max(128).nullish(),
  body: z.string().trim().min(1).max(5000),
});

export const boardCommentReplySchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

export const boardThreadPatchSchema = z
  .object({
    resolved: z.boolean().optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
  })
  .refine((v) => v.resolved !== undefined || (v.x !== undefined && v.y !== undefined), { message: 'empty' });

/** Acceso por pizarra: modo, una persona (rol null = sacarla) o el link de invitado. */
export const boardAccessPatchSchema = z
  .object({
    mode: z.enum(['workspace', 'restricted']).optional(),
    member: z
      .object({
        userId: z.string().min(1).max(128),
        role: z.enum(['view', 'edit']).nullable(),
      })
      .optional(),
    guest: z.boolean().optional(),
  })
  .refine((v) => v.mode !== undefined || v.member !== undefined || v.guest !== undefined, { message: 'empty' });

/** Timer compartido: arrancar (segundos), pausar, seguir, sumar/restar tiempo o cortar. */
export const boardTimerSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), seconds: z.number().int().min(10).max(4 * 60 * 60) }),
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('stop') }),
  z.object({ action: z.literal('add'), seconds: z.number().int().min(-3600).max(3600) }),
]);

/** Votación: abrir (votos por persona), cerrar, descartar resultados o votar (+1 / -1 a un elemento). */
export const boardVoteSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), votesPerPerson: z.number().int().min(1).max(20) }),
  z.object({ action: z.literal('close') }),
  z.object({ action: z.literal('clear') }),
  z.object({
    action: z.literal('vote'),
    elementId: z.string().min(1).max(128),
    delta: z.union([z.literal(1), z.literal(-1)]),
  }),
]);

/** Stickies → issues de Track: proyecto y un texto por elemento (el título sale de ahí). */
export const boardTrackCreateSchema = z.object({
  projectId: z.string().min(1).max(64),
  items: z
    .array(z.object({ elementId: z.string().min(1).max(128), text: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(50),
});

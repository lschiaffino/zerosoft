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

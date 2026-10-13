import { z } from 'zod';

export const boardCreateSchema = z.object({
  name: z.string().trim().max(120).optional(),
});

export const boardRenameSchema = z.object({
  name: z.string().trim().min(1).max(120),
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

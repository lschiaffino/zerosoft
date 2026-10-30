/** Social: esquemas de entrada de la API (sesión y v1). */
import { z } from 'zod';

export const mediaSchema = z.object({
  url: z.string().min(1).max(1000),
  type: z.enum(['image', 'video']),
  mime: z.string().max(80),
  size: z.number().int().min(0).max(1_000_000_000),
  name: z.string().max(200).optional(),
  width: z.number().int().min(0).max(100_000).nullable().optional(),
  height: z.number().int().min(0).max(100_000).nullable().optional(),
  duration: z.number().min(0).max(100_000).nullable().optional(),
});

export const postSchema = z.object({
  text: z.string().max(70_000).default(''),
  accountIds: z.array(z.string().max(64)).max(50).default([]),
  overrides: z.record(z.string().max(64), z.string().max(70_000).nullable()).optional(),
  media: z.array(mediaSchema).max(20).optional(),
  firstComment: z.string().max(8000).nullable().optional(),
  linkUrl: z.string().max(2000).nullable().optional(),
  shortUrl: z.string().max(500).nullable().optional(),
  action: z.enum(['draft', 'schedule', 'now', 'queue']).default('draft'),
  scheduledAt: z.string().max(40).nullable().optional(),
});

export type PostBody = z.infer<typeof postSchema>;

/**
 * Board API v1: auth de la key, actor y errores comunes de las rutas
 * /api/v1/boards. Server-only.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireApiUser } from './api-auth';
import type { ApiScope } from './api-scopes';
import { BoardApiError, type BoardActor } from './board-platform';
import { STICKY_COLORS } from './board-stickies';

export async function boardsApi(req: Request, scope: ApiScope): Promise<{ actor: BoardActor } | { res: NextResponse }> {
  const auth = await requireApiUser(req, scope);
  if ('res' in auth) return auth;
  return { actor: { ws: auth.user.id, personId: auth.personId, role: auth.role, via: 'api' } };
}

export function boardsV1Error(err: unknown): NextResponse {
  if (err instanceof BoardApiError) {
    const msg: Record<BoardApiError['code'], string> = {
      not_found: 'Board not found.',
      forbidden: 'This key’s person cannot do that on this board.',
      invalid_input: 'Invalid request body.',
      conflict: 'The board changed while saving. Try again.',
      too_large: 'The board would exceed the size limit.',
    };
    return apiError(err.status, err.code, msg[err.code]);
  }
  console.error('[boards-v1] failed', err instanceof Error ? err.message : err);
  return apiError(500, 'server_error', 'Something went wrong.');
}

export async function v1Json(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

const colorKeys = STICKY_COLORS.map((c) => c.key) as [string, ...string[]];

export const boardCreateV1 = z.object({
  name: z.string().trim().max(120).optional(),
  template: z.string().max(40).optional(),
  folderId: z.string().max(64).nullish(),
  locale: z.enum(['en', 'es', 'pt']).optional(),
});

export const boardUpdateV1 = z
  .object({ name: z.string().trim().min(1).max(120).optional(), folderId: z.string().max(64).nullable().optional() })
  .refine((v) => v.name !== undefined || v.folderId !== undefined, { message: 'Nothing to update.' });

export const boardElementsV1 = z
  .object({
    stickies: z
      .array(z.object({ text: z.string().trim().min(1).max(500), color: z.enum(colorKeys).optional(), tags: z.array(z.string().max(30)).max(8).optional() }))
      .max(200)
      .optional(),
    elements: z
      .array(
        z.object({
          kind: z.enum(['sticky', 'text', 'rectangle', 'ellipse', 'diamond']),
          text: z.string().max(2000).optional(),
          x: z.number().finite().min(-1e6).max(1e6).optional(),
          y: z.number().finite().min(-1e6).max(1e6).optional(),
          width: z.number().finite().min(10).max(5000).optional(),
          height: z.number().finite().min(10).max(5000).optional(),
          fill: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .optional(),
          fontSize: z.number().int().min(8).max(120).optional(),
        }),
      )
      .max(200)
      .optional(),
    connect: z.array(z.object({ from: z.number().int().min(0), to: z.number().int().min(0) })).max(200).optional(),
  })
  .refine((v) => (v.stickies?.length ?? 0) + (v.elements?.length ?? 0) > 0, { message: 'Add at least one sticky or element.' });

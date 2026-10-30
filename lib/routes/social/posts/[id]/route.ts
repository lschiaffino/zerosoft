import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readBody, withSocial } from '@/lib/social-http';
import { approvePost, deletePost, getPost, listPostEvents, rejectPost, reschedulePost, retryTarget, updatePost } from '@/lib/social';
import { postSchema } from '@/lib/social-schemas';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withSocial(async ({ actor }) => NextResponse.json({ post: await getPost(actor, id), events: await listPostEvents(actor, id) }));
}

const moveSchema = z.object({ scheduledAt: z.string().max(40) }).strict();

/** Editar la publicación, o solo la fecha ({ scheduledAt }) al arrastrarla en el calendario. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withSocial(
    async ({ actor }) => {
      const raw = await req.json().catch(() => null);
      const move = moveSchema.safeParse(raw);
      if (move.success) return NextResponse.json(await reschedulePost(actor, id, move.data.scheduledAt));
      const full = postSchema.safeParse(raw);
      if (!full.success) return jsonError(400, 'invalid_input');
      return NextResponse.json(await updatePost(actor, id, full.data));
    },
    { write: 'posts', limit: 240 },
  );
}

const actionSchema = z.object({
  action: z.enum(['approve', 'reject', 'retry']),
  comment: z.string().max(2000).optional(),
  targetId: z.string().max(64).optional(),
});

/** Aprobar o rechazar (con comentario), o reintentar un destino que falló. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withSocial(
    async ({ actor }) => {
      const body = await readBody(req, actionSchema);
      if (!body) return jsonError(400, 'invalid_input');
      if (body.action === 'approve') return NextResponse.json(await approvePost(actor, id, body.comment));
      if (body.action === 'reject') return NextResponse.json(await rejectPost(actor, id, body.comment ?? ''));
      if (!body.targetId) return jsonError(400, 'invalid_input');
      return NextResponse.json(await retryTarget(actor, id, body.targetId));
    },
    { write: 'posts', limit: 120 },
  );
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withSocial(
    async ({ actor }) => {
      await deletePost(actor, id);
      return NextResponse.json({ ok: true });
    },
    { write: 'posts', limit: 120 },
  );
}

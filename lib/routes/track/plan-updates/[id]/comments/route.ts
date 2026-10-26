import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { inScope } from '@/lib/track-plans';
import { createUpdateComment, deleteUpdateComment, getPlanUpdate, listUpdateComments } from '@/lib/track-plan-updates';
import { planUpdateCommentSchema } from '@/lib/track-planning-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

async function load(id: string) {
  const ctx = await planningContext();
  if (!ctx) return { error: unauthorized() } as const;
  const update = await getPlanUpdate(id);
  if (!update || !inScope(update.plan, ctx.scope)) return { error: notFound() } as const;
  return { ctx, update } as const;
}

export async function GET(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const r = await load(id);
  if ('error' in r) return r.error;
  return NextResponse.json({ rows: await listUpdateComments(id), me: r.ctx.actorId });
}

export async function POST(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const r = await load(id);
  if ('error' in r) return r.error;
  const parsed = planUpdateCommentSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json(await createUpdateComment(r.update, r.ctx.actorId, parsed.data.body), { status: 201 });
}

/** Borrar un comentario propio: ?commentId=. */
export async function DELETE(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const r = await load(id);
  if ('error' in r) return r.error;
  const commentId = req.nextUrl.searchParams.get('commentId') ?? '';
  const ok = await deleteUpdateComment(commentId, r.ctx.actorId);
  return ok ? NextResponse.json({ ok: true }) : notFound();
}

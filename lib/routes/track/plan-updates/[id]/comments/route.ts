import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { inScope } from '@/lib/track-plans';
import { createUpdateComment, deleteUpdateComment, getPlanUpdate, listUpdateComments, listUpdateReactions, togglePlanUpdateReaction } from '@/lib/track-plan-updates';
import { isAllowedReaction } from '@/lib/track-ux';
import { planUpdateCommentSchema, planUpdateReactionSchema } from '@/lib/track-planning-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

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
  const [rows, reactions] = await Promise.all([listUpdateComments(id), listUpdateReactions(id)]);
  return NextResponse.json({ rows, reactions, me: r.ctx.actorId });
}

/** Reacción (poner o sacar) en el update o en un comentario suyo: { emoji, commentId? }. */
export async function PUT(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const r = await load(id);
  if ('error' in r) return r.error;
  const parsed = planUpdateReactionSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  if (!isAllowedReaction(parsed.data.emoji)) return trackError(400, 'invalid_reaction');
  const on = await togglePlanUpdateReaction(id, parsed.data.commentId ?? id, r.ctx.actorId, parsed.data.emoji);
  if (on === null) return notFound();
  return NextResponse.json({ on, reactions: await listUpdateReactions(id) });
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

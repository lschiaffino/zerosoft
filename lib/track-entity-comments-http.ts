/**
 * Rutas de los hilos de comentarios de projects e iniciativas (las mismas que
 * las de los issues: comments, comments/[commentId], …/resolve, …/reactions).
 * Cada ruta de lib/routes/track/{plans,initiatives}/[id]/comments/… usa esto.
 *
 * Acceso: quien ve el project o la iniciativa hoy (workspace de la sesión, y
 * no invitada de Track). Otro workspace, anónimo o invitado: 404/401.
 */
import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from './track-planning-http';
import { getAccessiblePlan } from './track-plans';
import { getAccessibleInitiative } from './track-initiatives';
import {
  audience,
  createEntityComment,
  deleteEntityComment,
  listEntityThread,
  resolveEntityComment,
  toggleEntityReaction,
  updateEntityComment,
  type CommentEntity,
  type CommentEntityType,
} from './track-entity-comments';
import { commentCreateSchema, commentReactionSchema, commentResolveSchema, commentUpdateSchema } from './track-schema';
import { invalidBody, notFound, trackError, unauthorized } from './track-http';
import { isAllowedReaction } from './track-ux';

type Params = { params: Promise<{ id: string; commentId?: string }> };

async function load(type: CommentEntityType, id: string) {
  const ctx = await planningContext();
  if (!ctx) return { error: unauthorized() } as const;
  const row = type === 'plan' ? await getAccessiblePlan(id, ctx.scope) : await getAccessibleInitiative(id, ctx.scope);
  if (!row) return { error: notFound() } as const;
  const entity: CommentEntity = { type, id: row.id, name: row.name, team_id: row.team_id, owner_id: row.owner_id, lead_id: row.lead_id };
  return { ctx, entity } as const;
}

function mutationError(reason: 'not_found' | 'forbidden') {
  return reason === 'forbidden' ? trackError(403, 'forbidden') : notFound();
}

export function entityCommentRoutes(type: CommentEntityType) {
  return {
    /** GET comments: el hilo con la forma de la actividad del issue y sus reacciones. */
    async list(_req: NextRequest, props: Params) {
      const { id } = await props.params;
      const r = await load(type, id);
      if ('error' in r) return r.error;
      const [thread, members] = await Promise.all([listEntityThread(type, r.entity.id), audience(r.entity)]);
      // `members`: para las @menciones (solo quienes pueden leer el hilo).
      return NextResponse.json({ ...thread, me: r.ctx.actorId, members });
    },
    /** POST comments: { body, parentId? }. */
    async create(req: NextRequest, props: Params) {
      const { id } = await props.params;
      const r = await load(type, id);
      if ('error' in r) return r.error;
      const parsed = commentCreateSchema.safeParse(await readJson(req));
      if (!parsed.success) return invalidBody(parsed.error);
      const row = await createEntityComment(r.entity, r.ctx.actorId, { body: parsed.data.body, parentId: parsed.data.parentId });
      return NextResponse.json(row, { status: 201 });
    },
    /** PATCH comments/[commentId]: { body }, solo el autor. */
    async update(req: NextRequest, props: Params) {
      const { id, commentId = '' } = await props.params;
      const r = await load(type, id);
      if ('error' in r) return r.error;
      const parsed = commentUpdateSchema.safeParse(await readJson(req));
      if (!parsed.success) return invalidBody(parsed.error);
      const res = await updateEntityComment(r.entity, commentId, r.ctx.actorId, parsed.data.body);
      return res.ok ? NextResponse.json(res.value) : mutationError(res.reason);
    },
    /** DELETE comments/[commentId]: solo el autor (la raíz se lleva sus respuestas). */
    async remove(_req: NextRequest, props: Params) {
      const { id, commentId = '' } = await props.params;
      const r = await load(type, id);
      if ('error' in r) return r.error;
      const res = await deleteEntityComment(r.entity, commentId, r.ctx.actorId);
      return res.ok ? NextResponse.json({ ok: true }) : mutationError(res.reason);
    },
    /** POST comments/[commentId]/resolve: { resolved }. */
    async resolve(req: NextRequest, props: Params) {
      const { id, commentId = '' } = await props.params;
      const r = await load(type, id);
      if ('error' in r) return r.error;
      const parsed = commentResolveSchema.safeParse(await readJson(req));
      if (!parsed.success) return invalidBody(parsed.error);
      const ok = await resolveEntityComment(r.entity, commentId, r.ctx.actorId, parsed.data.resolved);
      return ok ? NextResponse.json({ ok: true }) : notFound();
    },
    /** POST comments/[commentId]/reactions: { emoji }; devuelve las reacciones del hilo. */
    async react(req: NextRequest, props: Params) {
      const { id, commentId = '' } = await props.params;
      const r = await load(type, id);
      if ('error' in r) return r.error;
      const parsed = commentReactionSchema.safeParse(await readJson(req));
      if (!parsed.success) return invalidBody(parsed.error);
      if (!isAllowedReaction(parsed.data.emoji)) return trackError(400, 'invalid_reaction');
      const active = await toggleEntityReaction(r.entity, commentId, r.ctx.actorId, parsed.data.emoji);
      if (active === null) return notFound();
      const { reactions } = await listEntityThread(type, r.entity.id);
      return NextResponse.json({ active, reactions });
    },
  };
}

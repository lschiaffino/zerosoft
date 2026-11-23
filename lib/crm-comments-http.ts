/**
 * CRM — lo común de las rutas de comentarios de una actividad (C1): quién
 * mira, si puede usar el hilo, los avisos de @menciones y los errores.
 * Server-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, type SessionUser } from './session';
import { sessionScope } from './crm-visibility';
import { sessionChatReader } from './crm-chat-privacy';
import { requestLocale } from './request-locale';
import { getDb, type CrmActivityRow } from './db';
import { canUseThread, CommentError } from './crm-activity-comments';
import { COMMENT_MAX } from './crm-note-format';
import { crmError, notFound, unauthorized } from './crm-http';
import { mentionablePeople, mentionsNotNotified, notifyMentionsDetailed } from './crm-mention-notify';

/** Cuerpo de un comentario: markdown (se sanea al guardar). Un poco de holgura sobre el tope por las marcas que se van. */
export const commentBodySchema = z.object({ body: z.string().min(1).max(COMMENT_MAX * 2) });

export function localeOf(req: NextRequest): string {
  return requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'));
}

/** La sesión y el permiso sobre el hilo de la actividad; si no, la respuesta de error (401 o 404). */
export async function threadAccess(req: NextRequest, activityId: string): Promise<{ user: SessionUser } | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const scope = await sessionScope(user);
  const reader = await sessionChatReader(user, localeOf(req));
  if (!(await canUseThread(user.id, activityId, scope, reader))) return notFound();
  return { user };
}

export function commentErrorResponse(err: unknown): NextResponse {
  if (!(err instanceof CommentError)) throw err;
  if (err.code === 'not_found') return notFound();
  if (err.code === 'forbidden') return crmError(403, 'forbidden');
  if (err.code === 'too_many') return crmError(400, 'too_many_comments');
  return crmError(400, 'invalid_input');
}

/**
 * Avisa a los mencionados en el comentario que pueden ver la actividad
 * (`before`: el texto anterior, al editar). Devuelve lo que se suma a la
 * respuesta: quiénes no la ven y no recibieron nada.
 */
export async function notifyCommentMentions(
  user: SessionUser,
  activityId: string,
  body: string,
  locale: string,
  before?: string,
): Promise<{ mentions_not_notified?: Array<{ id: string; name: string }> }> {
  const activity = (await getDb()
    .prepare('SELECT * FROM crm_activities WHERE id = ? AND user_id = ?')
    .get(activityId, user.id)) as CrmActivityRow | undefined;
  if (!activity) return {};
  const people = await mentionablePeople(user);
  const res = await notifyMentionsDetailed({
    activity,
    actor: user.actingUser ?? user,
    people,
    workspaceId: user.id,
    comment: body,
    before,
    locale,
  }).catch(() => ({ notified: [], withoutAccess: [] as string[] }));
  return mentionsNotNotified(res.withoutAccess, people);
}

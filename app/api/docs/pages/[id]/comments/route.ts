import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import {
  canReadPage,
  createDocComment,
  DOC_INTERNAL_READ,
  DOC_INTERNAL_WRITE,
  DocsCommentParentError,
  getDocAccess,
  getDocPageRow,
  listDocComments,
  listDocThreadParticipants,
  listPageMentionables,
} from '@/lib/docs';
import { createDocsCommentNotifications } from '@/lib/notifications';
import { docCommentCreateSchema } from '@/lib/docs-schema';
import { mentionedInBody } from '@/lib/docs-comments';
import { docsError, invalidBody, notFound, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const page = await getDocPageRow(params.id);
  if (!page) return notFound();
  if (!(await canReadPage(page, { id: user.id, actingUser: user.actingUser, team: user.team }, DOC_INTERNAL_READ))) {
    return notFound();
  }

  const rows = await listDocComments(params.id);
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const page = await getDocPageRow(params.id);
  if (!page) return notFound();
  if (!(await canReadPage(page, { id: user.id, actingUser: user.actingUser, team: user.team }, DOC_INTERNAL_WRITE))) {
    return notFound();
  }

  const body: unknown = await req.json().catch(() => null);
  const parsed = docCommentCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  // El autor es el usuario real que actúa (no el owner del workspace).
  const actorUser = user.actingUser ?? user;
  let comment;
  try {
    comment = await createDocComment(params.id, actorUser.id, parsed.data);
  } catch (err) {
    if (err instanceof DocsCommentParentError) return docsError(400, 'invalid_parent');
    throw err;
  }

  // Avisos: @mencionados (del workspace dueño de la página y nombrados en el
  // texto) y, en una respuesta, quienes participan del hilo y la siguen
  // pudiendo abrir (un share revocado no recibe más avisos).
  const mentionables = await listPageMentionables(page);
  const mentioned = mentionedInBody(comment.body, mentionables, parsed.data.mention_ids ?? []);
  const participants: string[] = [];
  if (comment.parent_id) {
    const memberIds = new Set(mentionables.map((m) => m.id));
    for (const uid of await listDocThreadParticipants(comment.parent_id)) {
      if (memberIds.has(uid) || (await getDocAccess(page, { id: uid }, DOC_INTERNAL_READ))) participants.push(uid);
    }
  }
  await createDocsCommentNotifications({
    pageId: page.id,
    pageTitle: page.title,
    commentId: comment.id,
    actor: { id: actorUser.id, email: actorUser.email, name: actorUser.name },
    body: comment.body,
    mentioned,
    threadParticipants: participants,
  });

  return NextResponse.json(comment, { status: 201 });
}

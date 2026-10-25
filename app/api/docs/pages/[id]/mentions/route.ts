import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canReadPage, DOC_INTERNAL_WRITE, getDocPageRow, listPageMentionables } from '@/lib/docs';
import { createDocsMentionNotification } from '@/lib/notifications';
import { docMentionCreateSchema } from '@/lib/docs-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Notifica una mención @usuario en una página. Solo miembros del workspace. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const page = await getDocPageRow(params.id);
  if (!page) return notFound();
  if (!(await canReadPage(page, user, DOC_INTERNAL_WRITE))) {
    return notFound();
  }

  const body: unknown = await req.json().catch(() => null);
  const parsed = docMentionCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  // El mencionado tiene que ser del workspace de la página (no del team
  // activo de quien escribe): así siempre la puede abrir.
  const mentionables = await listPageMentionables(page);
  if (!mentionables.some((m) => m.id === parsed.data.user_id)) return notFound();

  const actorUser = user.actingUser ?? user;
  await createDocsMentionNotification({
    pageId: page.id,
    pageTitle: page.title,
    actor: { id: actorUser.id, email: actorUser.email, name: actorUser.name },
    mentionedUserId: parsed.data.user_id,
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getUserByEmail } from '@/lib/db';
import { createDocShare } from '@/lib/docs';
import { docShareCreateSchema } from '@/lib/docs-schema';
import { createDocsShareNotification } from '@/lib/notifications';
import { docsError, invalidBody, notFound, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = docShareCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const { kind, role = 'view' } = parsed.data;
  let targetId = parsed.data.target_id ?? null;
  // Invitar por email: tiene que ser alguien con cuenta en zerosoft.
  if (kind === 'user' && !targetId && parsed.data.email) {
    const target = await getUserByEmail(parsed.data.email);
    if (!target) return docsError(404, 'user_not_found');
    targetId = target.id;
  }
  if (kind !== 'public' && !targetId) return docsError(400, 'invalid_input');

  const share = await createDocShare(user.id, params.id, kind, targetId, role);
  if (!share) return notFound();

  const actor = user.actingUser ?? user;
  if (kind === 'user' && targetId && targetId !== actor.id) {
    await createDocsShareNotification({
      pageId: params.id,
      actor: { id: actor.id, email: actor.email, name: actor.name },
      targetUserId: targetId,
    }).catch(() => {});
  }
  return NextResponse.json(share, { status: 201 });
}

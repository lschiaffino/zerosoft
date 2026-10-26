import { canWriteAccess } from '@/lib/docs-access';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getDocAccess, getDocPageRow } from '@/lib/docs';
import { createMeeting } from '@/lib/docs-meetings';
import { docsError, forbidden, invalidBody, notFound, unauthorized } from '@/lib/docs-http';
import { limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ pageId: z.string().min(1).max(100), title: z.string().max(200).default('') });

/** Notas de reunión nuevas para un bloque /meeting de la página (hace falta poder editarla). */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const page = await getDocPageRow(parsed.data.pageId);
  const access = page ? await getDocAccess(page, user, { includePublished: false, includePublicLink: false }) : null;
  if (!page || !access) return notFound();
  if (!canWriteAccess(access)) return forbidden();
  if (page.locked === 1) return docsError(423, 'locked');
  const limited = await limitWrites('docs:meetings', realUserId(user), 30);
  if (limited) return limited;
  return NextResponse.json({ meeting: await createMeeting(page, realUserId(user), parsed.data.title) }, { status: 201 });
}

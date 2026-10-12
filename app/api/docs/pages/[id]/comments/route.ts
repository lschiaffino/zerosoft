import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canReadPage, createDocComment, getDocPageRow, listDocComments } from '@/lib/docs';
import { docCommentCreateSchema } from '@/lib/docs-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const page = await getDocPageRow(params.id);
  if (!page) return notFound();
  if (!(await canReadPage(page, { id: user.id, actingUser: user.actingUser, team: user.team }))) {
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
  if (!(await canReadPage(page, { id: user.id, actingUser: user.actingUser, team: user.team }))) {
    return notFound();
  }

  const body: unknown = await req.json().catch(() => null);
  const parsed = docCommentCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  // El autor es el usuario real que actúa (no el owner del workspace).
  const authorId = user.actingUser?.id ?? user.id;
  const comment = await createDocComment(params.id, authorId, parsed.data);
  return NextResponse.json(comment, { status: 201 });
}

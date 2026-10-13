import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { deleteDocPage, getDocAccess, getDocPageRow, listDocShares, toDocPage, updateDocPage } from '@/lib/docs';
import { SHARED_EDITABLE_FIELDS, docPageUpdateSchema } from '@/lib/docs-schema';
import { maybeAutoSnapshot } from '@/lib/docs-versions';
import { notFound, unauthorized, invalidBody, forbidden } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const row = await getDocPageRow(params.id);
  const access = row ? await getDocAccess(row, user) : null;
  if (!row || !access) return notFound();
  // Los shares (quién tiene acceso) solo los ve el dueño.
  const shares = access === 'owner' ? await listDocShares(params.id) : [];
  return NextResponse.json({ ...toDocPage(row), access, shares });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = docPageUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const row = await getDocPageRow(params.id);
  const access = row ? await getDocAccess(row, user) : null;
  if (!row || !access) return notFound();
  if (access === 'view') return forbidden();

  const patch = parsed.data;
  if (access === 'edit') {
    // Un invitado con edición cambia el contenido, nunca la publicación, la
    // IA, el árbol ni la papelera del workspace ajeno.
    const allowed = new Set<string>(SHARED_EDITABLE_FIELDS);
    if (Object.keys(patch).some((k) => !allowed.has(k))) return forbidden();
  }

  const page = await updateDocPage(row.user_id, params.id, patch);
  if (!page) return notFound();
  if (patch.content !== undefined || patch.title !== undefined) {
    await maybeAutoSnapshot(row.user_id, params.id, realUserId(user), row).catch(() => {});
  }
  return NextResponse.json(page);
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await deleteDocPage(user.id, params.id))) return notFound();
  return new NextResponse(null, { status: 204 });
}

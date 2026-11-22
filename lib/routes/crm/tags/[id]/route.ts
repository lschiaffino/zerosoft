import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { deleteTag, updateTag } from '@/lib/crm-tags';
import { tagUpdateSchema } from '@/lib/crm-schema';
import { crmError, forbidden, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Renombrar o borrar un tag cambia los registros de todo el workspace: solo el
 * dueño y los admins. Ponerle o sacarle un tag a un registro que se ve sigue
 * siendo de cualquiera (tags/record, tags/apply).
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const body: unknown = await req.json().catch(() => null);
  const parsed = tagUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const res = await updateTag(user.id, id, parsed.data);
  if (!res.ok) return res.error === 'not_found' ? notFound() : crmError(409, res.error);
  return NextResponse.json(res.tag);
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  if (!(await deleteTag(user.id, id))) return notFound();
  return new NextResponse(null, { status: 204 });
}

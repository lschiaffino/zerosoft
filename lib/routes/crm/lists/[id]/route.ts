import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { redactRowsFor, sessionFieldViewer } from '@/lib/crm-field-perms';
import { deleteList, updateList } from '@/lib/crm';
import { canSeeList, hiddenContactFields, listForViewer, withoutHiddenRules } from '@/lib/crm-list-access';
import { listUpdateSchema } from '@/lib/crm-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Una lista dinámica que filtra por un campo que la persona tiene oculto no
 * existe para ella (404 en todo): ver quién entra delataría el valor
 * (lib/crm-list-access.ts).
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const viewer = sessionFieldViewer(user);
  const detail = await listForViewer(viewer, params.id, await sessionScope(user));
  if (!detail) return notFound();
  return NextResponse.json({ ...detail, members: await redactRowsFor(viewer, 'contacts', detail.members) });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = listUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const viewer = sessionFieldViewer(user);
  if (!(await canSeeList(viewer, params.id))) return notFound();
  // Sin reglas sobre campos que la persona tiene ocultos (no se adivinan valores con una lista).
  const filter = withoutHiddenRules(parsed.data.filter, await hiddenContactFields(viewer));
  const list = await updateList(user.id, params.id, { ...parsed.data, filter });
  if (!list) return notFound();
  return NextResponse.json(list);
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await canSeeList(sessionFieldViewer(user), params.id))) return notFound();
  if (!(await deleteList(user.id, params.id))) return notFound();
  return new NextResponse(null, { status: 204 });
}

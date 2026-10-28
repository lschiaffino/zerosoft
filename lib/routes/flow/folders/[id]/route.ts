import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { deleteFolder, renameFolder } from '@/lib/flow-folders';
import { canEditFlows, flowError, forbidden, notFound, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  const parsed = z.object({ name: z.string().max(200) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return flowError(400, 'invalid_input');
  const res = await renameFolder(user.id, id, parsed.data.name);
  if (!res.ok) return res.error === 'not_found' ? notFound() : flowError(400, res.error);
  return NextResponse.json({ folder: res.folder });
}

/** Borra la carpeta; sus flows quedan sin carpeta. */
export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  if (!(await deleteFolder(user.id, id))) return notFound();
  return NextResponse.json({ ok: true });
}

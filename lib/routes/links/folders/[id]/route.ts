import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { deleteFolder, folderPatchSchema, getFolder, listFolderMembers, updateFolder } from '@/lib/link-folders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Carpeta con sus excepciones por persona (solo admins). */
export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const folder = await getFolder(user.id, id);
  if (!folder) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ...folder, members: await listFolderMembers(id) });
}

/** Renombrar, cambiar el acceso por defecto o las excepciones por persona. */
export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = folderPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const res = await updateFolder(user.id, id, parsed.data);
  if (!res.ok) {
    const status = res.code === 'not_found' ? 404 : res.code === 'name_taken' ? 409 : 400;
    return NextResponse.json({ error: res.code }, { status });
  }
  return NextResponse.json({ ...(await getFolder(user.id, id)), members: await listFolderMembers(id) });
}

/** Borra la carpeta; sus links quedan sin carpeta. */
export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await deleteFolder(user.id, id))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}

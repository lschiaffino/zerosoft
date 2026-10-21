import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { createFolder, folderSchema, listFolders, viewerOf } from '@/lib/link-folders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Carpetas que ve quien pide, con su acceso ('view' | 'edit') y cuántos links tienen. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ folders: await listFolders(user.id, viewerOf(user)) });
}

/** Crear una carpeta: solo admins (deciden quién ve y edita qué). */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = folderSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const res = await createFolder(user.id, parsed.data);
  if (!res.ok) return NextResponse.json({ error: res.code }, { status: 409 });
  return NextResponse.json(res.folder, { status: 201 });
}

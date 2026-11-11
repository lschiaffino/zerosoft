import { NextResponse } from 'next/server';
import { createFolder, deleteFolder, listFolders, updateFolder } from '@/lib/groups-lines';
import { groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, str } from '@/lib/groups-http';
import { conditionalJson } from '@/lib/etag';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Carpetas compartidas del workspace, con los no leídos de quien mira (solo chats que ve). Con If-None-Match y sin cambios responde 304. */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  return conditionalJson(req, await listFolders(s.ws, await sessionViewer(s)));
}

/** { name, parentId? } crea una carpeta (hasta 3 niveles de subcarpetas). */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    return NextResponse.json(await createFolder(s.ws, s.me, { name: b.name, parentId: str(b.parentId, 100) || null }), { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}

/** { id, name?, parentId?, beforeId? }: renombrar o mover (y ordenar entre hermanas). */
export async function PATCH(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const id = str(b.id, 100);
  if (!id) return groupsError(400, 'invalid_folder');
  try {
    await updateFolder(s.ws, id, {
      ...('name' in b ? { name: b.name } : {}),
      ...('parentId' in b ? { parentId: str(b.parentId, 100) || null } : {}),
      ...('beforeId' in b ? { beforeId: str(b.beforeId, 100) || null } : {}),
    });
    return NextResponse.json(await listFolders(s.ws, await sessionViewer(s)));
  } catch (err) {
    return handleGroupsError(err);
  }
}

/** ?id=<carpeta>: la borra con sus subcarpetas; los chats quedan sin carpeta. */
export async function DELETE(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  return id && (await deleteFolder(s.ws, id)) ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
}

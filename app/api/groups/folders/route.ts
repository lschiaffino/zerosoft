import { NextResponse } from 'next/server';
import { createFolder, deleteFolder, listFolders, updateFolder } from '@/lib/groups-lines';
import { groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, str, type GroupsSession } from '@/lib/groups-http';
import { conditionalJson } from '@/lib/etag';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lo que ve quien pide: sus carpetas, las del equipo y si puede administrar las del equipo (admins). */
async function foldersFor(s: GroupsSession) {
  return { ...(await listFolders(s.ws, s.me, await sessionViewer(s))), canManageTeam: s.isAdmin };
}

/**
 * Las carpetas de quien pide (`folders`, nunca las de otra persona) y las del equipo (`team`), con sus no leídos
 * (solo chats que ve). Con If-None-Match y sin cambios responde 304.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  return conditionalJson(req, await foldersFor(s));
}

/** { name, parentId?, team? } crea una carpeta de quien pide o, con team: true, del equipo (solo admins; si no, 403). Hasta 3 niveles de subcarpetas. */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    return NextResponse.json(await createFolder(s.ws, s.me, { name: b.name, parentId: str(b.parentId, 100) || null, team: b.team === true }, { admin: s.isAdmin }), { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}

/**
 * { id, name?, parentId?, beforeId? }: renombrar o mover (y ordenar entre hermanas). Las propias; las del equipo
 * solo un admin (si no, 403). La de otra persona es 404.
 */
export async function PATCH(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const id = str(b.id, 100);
  if (!id) return groupsError(400, 'invalid_folder');
  try {
    await updateFolder(
      s.ws,
      s.me,
      id,
      {
        ...('name' in b ? { name: b.name } : {}),
        ...('parentId' in b ? { parentId: str(b.parentId, 100) || null } : {}),
        ...('beforeId' in b ? { beforeId: str(b.beforeId, 100) || null } : {}),
      },
      { admin: s.isAdmin },
    );
    return NextResponse.json(await foldersFor(s));
  } catch (err) {
    return handleGroupsError(err);
  }
}

/**
 * ?id=<carpeta>: borra una carpeta con sus subcarpetas; los chats quedan sin esa carpeta. Una del equipo, solo un
 * admin (si no, 403): sus chats salen de ella para todos y las carpetas personales no cambian. La de otra persona es 404.
 */
export async function DELETE(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  try {
    return id && (await deleteFolder(s.ws, s.me, id, { admin: s.isAdmin })) ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
  } catch (err) {
    return handleGroupsError(err);
  }
}

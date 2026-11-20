import { NextResponse } from 'next/server';
import { createStage, deleteStage, listStages, reorderStages, updateStage, type StageScope } from '@/lib/groups-kanban';
import { groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, str, strArr } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const scopeOf = (raw: unknown): StageScope | null => (raw === 'team' || raw === 'me' ? raw : null);

/** ?scope=team (las del equipo) o me (las propias): las etapas del tablero kanban de Lines, en orden. */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const scope = scopeOf(new URL(req.url).searchParams.get('scope'));
  if (!scope) return groupsError(400, 'invalid_input');
  return NextResponse.json({ stages: await listStages(await sessionViewer(s), scope) });
}

/** { scope, name, color? }: una etapa nueva al final. Las del equipo, solo un admin. */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const scope = scopeOf(b.scope);
  if (!scope) return groupsError(400, 'invalid_input');
  try {
    return NextResponse.json(await createStage(await sessionViewer(s), scope, { name: b.name, color: b.color }), { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}

/**
 * { scope, id, name?, color? } renombra o cambia el color; { scope, order: [ids] }
 * las ordena. La etapa de otra persona es 404.
 */
export async function PATCH(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const scope = scopeOf(b.scope);
  if (!scope) return groupsError(400, 'invalid_input');
  const viewer = await sessionViewer(s);
  try {
    if (Array.isArray(b.order)) return NextResponse.json({ stages: await reorderStages(viewer, scope, strArr(b.order, 100)) });
    const id = str(b.id, 100);
    if (!id) return groupsError(400, 'invalid_input');
    return NextResponse.json(await updateStage(viewer, scope, id, { ...('name' in b ? { name: b.name } : {}), ...('color' in b ? { color: b.color } : {}) }));
  } catch (err) {
    return handleGroupsError(err);
  }
}

/** ?scope=&id=: borra la etapa; sus chats quedan sin etapa. La de otra persona es 404. */
export async function DELETE(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const sp = new URL(req.url).searchParams;
  const scope = scopeOf(sp.get('scope'));
  const id = sp.get('id')?.slice(0, 100);
  if (!scope || !id) return groupsError(400, 'invalid_input');
  try {
    return (await deleteStage(await sessionViewer(s), scope, id)) ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
  } catch (err) {
    return handleGroupsError(err);
  }
}

import { NextResponse } from 'next/server';
import { deleteNumber, getNumberRow, listNumbers, toNumberDto, updateNumber, webhookUrlFor } from '@/lib/groups';
import { groupsError, groupsSession, handleGroupsError, numberGuard, readJson, sessionViewer, str, strArr } from '@/lib/groups-http';
import { canSeeNumber } from '@/lib/groups-access';
import { setLineAccess } from '@/lib/groups-lines';
import { canManageNumber } from '@/lib/groups-number-perms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Una línea con la URL de su webhook (solo la ve quien la administra: lleva el secreto). */
export async function GET(req: Request, ctx: Ctx) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const row = await getNumberRow(s.ws, id);
  if (!row || !(await canSeeNumber(await sessionViewer(s), id))) return groupsError(404, 'not_found');
  const manage = canManageNumber(s.manager, row);
  return NextResponse.json({ ...toNumberDto(row), canManage: manage, webhookUrl: manage ? webhookUrlFor(row, new URL(req.url).origin) : null });
}

/**
 * Nombre, credenciales y con quién se comparte. Admins, en cualquier línea;
 * un member con permiso para conectar números, en las suyas. Cambiar el dueño
 * es solo de admins.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const row = await numberGuard(s, id);
  if (row instanceof NextResponse) return row;
  const body = await readJson(req);
  if ('ownerId' in body && !s.isAdmin) {
    const next = typeof body.ownerId === 'string' && body.ownerId ? body.ownerId : null;
    if (next !== (row.owner_id ?? null)) return groupsError(403, 'forbidden');
  }
  try {
    const config = body.config && typeof body.config === 'object' ? (body.config as Record<string, unknown>) : undefined;
    const res = await updateNumber(s.ws, id, { name: str(body.name, 80), config });
    // Dueño y visibilidad: se guardan aparte, con las mismas validaciones del workspace.
    const hasAccess = 'ownerId' in body || 'visibility' in body || 'personIds' in body || 'teamIds' in body;
    if (hasAccess) {
      await setLineAccess(s.ws, id, {
        ...('ownerId' in body && s.isAdmin ? { ownerId: typeof body.ownerId === 'string' && body.ownerId ? body.ownerId : null } : {}),
        ...('visibility' in body ? { visibility: body.visibility === 'restricted' ? 'restricted' : body.visibility === 'all' ? 'all' : ('invalid' as 'all') } : {}),
        ...('personIds' in body ? { personIds: strArr(body.personIds, 200) } : {}),
        ...('teamIds' in body ? { teamIds: strArr(body.teamIds, 100) } : {}),
      });
      const after = (await listNumbers(s.ws, await sessionViewer(s))).find((n) => n.id === id);
      return NextResponse.json(after ? { ...after, canManage: canManageNumber(s.manager, after) } : res);
    }
    return NextResponse.json({ ...res, canManage: true });
  } catch (err) {
    return handleGroupsError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const row = await numberGuard(s, id);
  if (row instanceof NextResponse) return row;
  try {
    const ok = await deleteNumber(s.ws, id);
    return ok ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
  } catch (err) {
    return handleGroupsError(err);
  }
}

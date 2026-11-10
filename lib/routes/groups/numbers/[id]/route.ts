import { NextResponse } from 'next/server';
import { deleteNumber, getNumberRow, toNumberDto, updateNumber, webhookUrlFor } from '@/lib/groups';
import { groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, str, strArr } from '@/lib/groups-http';
import { canSeeNumber } from '@/lib/groups-access';
import { setLineAccess } from '@/lib/groups-lines';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Un número con la URL de su webhook (solo admins la ven: lleva el secreto). */
export async function GET(req: Request, ctx: Ctx) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const row = await getNumberRow(s.ws, id);
  if (!row || !(await canSeeNumber(await sessionViewer(s), id))) return groupsError(404, 'not_found');
  return NextResponse.json({ ...toNumberDto(row), webhookUrl: s.isAdmin ? webhookUrlFor(row, new URL(req.url).origin) : null });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const body = await readJson(req);
  try {
    const config = body.config && typeof body.config === 'object' ? (body.config as Record<string, unknown>) : undefined;
    const id = (await ctx.params).id;
    const res = await updateNumber(s.ws, id, { name: str(body.name, 80), config });
    // Dueño y visibilidad: se guardan aparte, con las mismas validaciones del workspace.
    const hasAccess = 'ownerId' in body || 'visibility' in body || 'personIds' in body || 'teamIds' in body;
    if (hasAccess) {
      await setLineAccess(s.ws, id, {
        ...('ownerId' in body ? { ownerId: typeof body.ownerId === 'string' && body.ownerId ? body.ownerId : null } : {}),
        ...('visibility' in body ? { visibility: body.visibility === 'restricted' ? 'restricted' : body.visibility === 'all' ? 'all' : ('invalid' as 'all') } : {}),
        ...('personIds' in body ? { personIds: strArr(body.personIds, 200) } : {}),
        ...('teamIds' in body ? { teamIds: strArr(body.teamIds, 100) } : {}),
      });
      const { listNumbers } = await import('@/lib/groups');
      return NextResponse.json((await listNumbers(s.ws)).find((n) => n.id === id) ?? res);
    }
    return NextResponse.json(res);
  } catch (err) {
    return handleGroupsError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  try {
    const ok = await deleteNumber(s.ws, (await ctx.params).id);
    return ok ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
  } catch (err) {
    return handleGroupsError(err);
  }
}

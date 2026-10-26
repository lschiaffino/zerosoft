import { NextResponse } from 'next/server';
import { deleteNumber, getNumberRow, toNumberDto, updateNumber, webhookUrlFor } from '@/lib/groups';
import { groupsError, groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Un número con la URL de su webhook (solo admins la ven: lleva el secreto). */
export async function GET(req: Request, ctx: Ctx) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const row = await getNumberRow(s.ws, (await ctx.params).id);
  if (!row) return groupsError(404, 'not_found');
  return NextResponse.json({ ...toNumberDto(row), webhookUrl: s.isAdmin ? webhookUrlFor(row, new URL(req.url).origin) : null });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const body = await readJson(req);
  try {
    const config = body.config && typeof body.config === 'object' ? (body.config as Record<string, unknown>) : undefined;
    return NextResponse.json(await updateNumber(s.ws, (await ctx.params).id, { name: str(body.name, 80), config }));
  } catch (err) {
    return handleGroupsError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const ok = await deleteNumber(s.ws, (await ctx.params).id);
  return ok ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
}

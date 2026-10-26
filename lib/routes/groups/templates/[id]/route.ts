import { NextResponse } from 'next/server';
import { deleteTemplate, getTemplate, templateInput, updateTemplate } from '@/lib/groups-org';
import { groupsError, groupsSession, handleGroupsError, readJson } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const t = await getTemplate(s.ws, (await ctx.params).id);
  return t ? NextResponse.json(t) : groupsError(404, 'not_found');
}

export async function PATCH(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  try {
    return NextResponse.json(await updateTemplate(s.ws, (await ctx.params).id, templateInput(await readJson(req))));
  } catch (err) {
    return handleGroupsError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  return (await deleteTemplate(s.ws, (await ctx.params).id)) ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
}

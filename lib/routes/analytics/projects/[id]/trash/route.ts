import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listReplayTrash, restoreReplayTrash } from '@/lib/analytics/trash';
import { actorProject, aError, analyticsActor, canManageAnalytics, isResponse, readJson } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET: las grabaciones que la retención mandó a la papelera del proyecto (cuándo empezaron y cuándo se purgan; admins). */
export async function GET(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  if (!canManageAnalytics(actor)) return aError(403, 'forbidden');
  const p = await actorProject(actor, (await ctx.params).id);
  if (isResponse(p)) return p;
  return NextResponse.json({ items: await listReplayTrash(actor.workspaceId, p.id) }, { headers: { 'cache-control': 'no-store' } });
}

const Restore = z.object({ entryId: z.string().min(1).max(80) });

/** POST { entryId }: restaura una grabación de la papelera (admins). 409 si la misma sesión volvió a grabarse. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  if (!canManageAnalytics(actor)) return aError(403, 'forbidden');
  const p = await actorProject(actor, (await ctx.params).id);
  if (isResponse(p)) return p;
  const parsed = Restore.safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input');
  const res = await restoreReplayTrash(actor.workspaceId, p.id, parsed.data.entryId);
  if (!res.ok) return aError(res.reason === 'conflict' ? 409 : 404, res.reason);
  return NextResponse.json({ item: res.item });
}

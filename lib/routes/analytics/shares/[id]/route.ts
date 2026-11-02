import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { addSharePassword, removeSharePassword, revokeShare, rotateShareToken, updateShareOptions } from '@/lib/analytics/records-more';
import { aError, analyticsActor, canManageAnalytics, isResponse, readJson, recordProject } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  options: z.object({ theme: z.enum(['system', 'light', 'dark']).optional(), branding: z.boolean().optional(), legend: z.boolean().optional() }).optional(),
  rotateToken: z.boolean().optional(),
  addPassword: z.object({ password: z.string().max(200).optional(), note: z.string().max(200).optional() }).optional(),
  removePassword: z.string().max(64).optional(),
});

/** Opciones del link, token nuevo y contraseñas. La contraseña se devuelve solo acá, una vez. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  if (!canManageAnalytics(actor)) return aError(403, 'forbidden');
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_shares', id);
  if (isResponse(project)) return project;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input');
  const d = parsed.data;
  if (d.addPassword) {
    const created = await addSharePassword(project.id, id, actor.personId, d.addPassword);
    return created ? NextResponse.json({ password: created }) : aError(404, 'not_found');
  }
  if (d.removePassword) return (await removeSharePassword(project.id, id, d.removePassword, actor.personId)) ? NextResponse.json({ ok: true }) : aError(404, 'not_found');
  if (d.rotateToken) {
    const share = await rotateShareToken(project.id, id, actor.personId);
    return share ? NextResponse.json({ share }) : aError(404, 'not_found');
  }
  const share = await updateShareOptions(project.id, id, d.options ?? {}, actor.personId);
  return share ? NextResponse.json({ share }) : aError(404, 'not_found');
}

/** Revoca un link público: deja de responder al instante. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  if (!canManageAnalytics(actor)) return aError(403, 'forbidden');
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_shares', id);
  if (isResponse(project)) return project;
  await revokeShare(project.id, id, actor.personId);
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { deleteDashboard, getVisibleDashboard, listDashboards, listWidgets, updateDashboard } from '@/lib/track-dashboards';
import { mergeFilters, runInsight } from '@/lib/track-insights';
import { dashboardUpdateSchema } from '@/lib/track-planning-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

/** Dashboard con sus widgets y el resultado de cada uno (filtros del dashboard + del widget). */
export async function GET(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const row = await getVisibleDashboard(id, ctx.scope, ctx.actorId);
  if (!row) return notFound();
  const dashboard = (await listDashboards(ctx.scope, ctx.actorId)).find((d) => d.id === id)!;
  const widgets = await listWidgets(id);
  const results = await Promise.all(
    widgets.map((w) => runInsight(ctx.scope, { ...w.query, filters: mergeFilters(dashboard.filters, w.query.filters) }).catch(() => null)),
  );
  return NextResponse.json({
    dashboard,
    widgets: widgets.map((w, i) => ({ ...w, result: results[i] })),
    canDelete: row.user_id === ctx.actorId || ctx.admin,
  });
}

export async function PATCH(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const row = await getVisibleDashboard(id, ctx.scope, ctx.actorId);
  if (!row) return notFound();
  const parsed = dashboardUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  // Solo quien lo creó lo pasa a personal (si no, desaparecería para su dueño).
  if (parsed.data.visibility === 'personal' && row.user_id !== ctx.actorId) return trackError(403, 'forbidden');
  await updateDashboard(id, parsed.data);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const row = await getVisibleDashboard(id, ctx.scope, ctx.actorId);
  if (!row) return notFound();
  if (row.user_id !== ctx.actorId && !ctx.admin) return trackError(403, 'forbidden');
  await deleteDashboard(id);
  return NextResponse.json({ ok: true });
}

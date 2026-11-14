import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { deletePlanTemplate, getAccessiblePlanTemplate, listPlanTemplates, parseTemplateData, updatePlanTemplate } from '@/lib/track-plan-templates';
import { planTemplateUpdateSchema } from '@/lib/track-planning-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

/** El template con lo que trae (milestones e issues), para la vista previa. */
export async function GET(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const row = await getAccessiblePlanTemplate(id, ctx.scope);
  if (!row) return notFound();
  const data = parseTemplateData(row.data);
  return NextResponse.json({
    id: row.id,
    name: row.name,
    description: row.description,
    milestones: data.milestones.map((m) => ({ name: m.name, offsetDays: m.offsetDays })),
    issues: data.issues.map((i) => ({ title: i.title, priority: i.priority, milestone: i.milestone, parent: i.parent })),
  });
}

/** Renombrar o cambiar la descripción: quien lo creó o un admin. */
export async function PATCH(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const row = await getAccessiblePlanTemplate(id, ctx.scope);
  if (!row) return notFound();
  if (row.created_by !== ctx.actorId && !ctx.admin) return trackError(403, 'forbidden');
  const parsed = planTemplateUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  await updatePlanTemplate(id, parsed.data);
  return NextResponse.json((await listPlanTemplates(ctx.scope)).find((t) => t.id === id));
}

export async function DELETE(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const row = await getAccessiblePlanTemplate(id, ctx.scope);
  if (!row) return notFound();
  if (row.created_by !== ctx.actorId && !ctx.admin) return trackError(403, 'forbidden');
  await deletePlanTemplate(id);
  return NextResponse.json({ ok: true });
}

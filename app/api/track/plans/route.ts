import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { createPlan, listPlans, listScopeTeams, listWorkspaceMembers } from '@/lib/track-plans';
import { listInitiatives } from '@/lib/track-initiatives';
import { PLAN_PRIORITIES, PLAN_STATUSES, planCreateSchema, type PlanStatus } from '@/lib/track-planning-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';
import { applyTemplateToPlan, getAccessiblePlanTemplate, parseTemplateData, templateDefaults } from '@/lib/track-plan-templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Plans del workspace (filtros: status, lead, team, initiative, q). Con ?meta=1 suma (con ?meta=only, solo eso) personas, equipos e iniciativas para los formularios. */
export async function GET(req: NextRequest) {
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const metaOnly = sp.get('meta') === 'only';
  const status = sp.getAll('status').flatMap((s) => s.split(',')).filter((s): s is PlanStatus => (PLAN_STATUSES as readonly string[]).includes(s));
  const rows = metaOnly ? [] : await listPlans(ctx.scope, {
    status: status.length ? status : undefined,
    leadId: sp.get('lead') || undefined,
    teamId: sp.get('team') || undefined,
    initiativeId: sp.get('initiative') || undefined,
    q: sp.get('q') || undefined,
    includeArchived: sp.get('archived') === '1',
  });
  if (sp.get('meta') !== '1' && !metaOnly) return NextResponse.json({ rows });
  const [members, teams, initiatives] = await Promise.all([
    listWorkspaceMembers(ctx.scope),
    listScopeTeams(ctx.scope),
    listInitiatives(ctx.scope),
  ]);
  return NextResponse.json({
    rows,
    members,
    teams,
    initiatives: initiatives.map((i) => ({ id: i.id, name: i.name })),
    me: ctx.actorId,
  });
}

export async function POST(req: NextRequest) {
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const parsed = planCreateSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  const { templateId, ...input } = parsed.data;
  // Desde un template (como Linear): lo que el formulario no eligió sale del template.
  const template = templateId ? await getAccessiblePlanTemplate(templateId, ctx.scope) : undefined;
  if (templateId && !template) return notFound();
  const data = template ? parseTemplateData(template.data) : null;
  const defaults = data ? templateDefaults(data) : null;
  const payload = defaults
    ? {
        ...input,
        summary: input.summary ?? defaults.summary,
        description: input.description ?? defaults.description,
        priority:
          input.priority ??
          ((PLAN_PRIORITIES as readonly string[]).includes(defaults.priority) ? (defaults.priority as (typeof PLAN_PRIORITIES)[number]) : undefined),
        icon: input.icon ?? defaults.icon,
        teamIds: input.teamIds?.length ? input.teamIds : defaults.teamIds,
        labelIds: input.labelIds?.length ? input.labelIds : defaults.labelIds,
      }
    : input;
  const res = await createPlan(ctx.scope, ctx.actorId, payload);
  if (!res.ok) return trackError(400, res.error);
  const applied = data ? await applyTemplateToPlan(res.plan.id, data, ctx.actorId) : undefined;
  return NextResponse.json({ ...res.plan, template: applied }, { status: 201 });
}

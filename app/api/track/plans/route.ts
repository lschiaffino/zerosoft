import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { createPlan, listPlans, listScopeTeams, listWorkspaceMembers } from '@/lib/track-plans';
import { listInitiatives } from '@/lib/track-initiatives';
import { PLAN_STATUSES, planCreateSchema, type PlanStatus } from '@/lib/track-planning-schema';
import { invalidBody, trackError, unauthorized } from '@/lib/track-http';

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
  const res = await createPlan(ctx.scope, ctx.actorId, parsed.data);
  if (!res.ok) return trackError(400, res.error);
  return NextResponse.json(res.plan, { status: 201 });
}

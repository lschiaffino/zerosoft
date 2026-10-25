import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { canAccessTrackProject, getProject, listStatuses } from '@/lib/track-data';
import { getAutomation, listArchivedIssues, setAutomation, staleIssueIds } from '@/lib/track-housekeeping';
import { automationSchema } from '@/lib/track-planning-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

async function load(id: string) {
  const ctx = await planningContext();
  if (!ctx) return { error: unauthorized() } as const;
  const project = await getProject(id);
  if (!project || !(await canAccessTrackProject(project, ctx.scope.teamId, ctx.scope.ownerId))) return { error: notFound() } as const;
  return { ctx, project } as const;
}

async function view(id: string) {
  const a = await getAutomation(id);
  const statuses = (await listStatuses(id)).filter((s) => s.category === 'cancelled' || s.category === 'done');
  const archived = await listArchivedIssues(id, 100);
  const preview = a && a.auto_close_months ? (await staleIssueIds(a, new Date(), 500)).length : 0;
  return {
    autoCloseMonths: a?.auto_close_months ?? 0,
    autoCloseStatusId: a?.auto_close_status_id ?? null,
    autoArchiveMonths: a?.auto_archive_months ?? 0,
    closeStatuses: statuses.map((s) => ({ id: s.id, name: s.name, category: s.category })),
    archived,
    staleCount: preview,
  };
}

/** Auto-cierre, auto-archivo y archivo del proyecto. */
export async function GET(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const r = await load(id);
  if ('error' in r) return r.error;
  return NextResponse.json(await view(id));
}

/** Solo admins cambian las automatizaciones (como los ajustes de team en Linear). */
export async function PUT(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const r = await load(id);
  if ('error' in r) return r.error;
  if (!r.ctx.admin) return trackError(403, 'forbidden');
  const parsed = automationSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  const res = await setAutomation(id, parsed.data);
  if (!res.ok) return trackError(400, res.error ?? 'invalid_input');
  return NextResponse.json(await view(id));
}

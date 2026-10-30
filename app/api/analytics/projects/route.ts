import { NextRequest, NextResponse } from 'next/server';
import { createProject, listProjects, toProjectDto } from '@/lib/analytics/projects';
import { aError, analyticsActor, canManageAnalytics, isResponse, readJson } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Proyectos del workspace. */
export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const q = req.nextUrl.searchParams.get('q')?.trim().toLowerCase() ?? '';
  const projects = (await listProjects(actor.workspaceId)).map(toProjectDto).filter((p) => !q || p.name.toLowerCase().includes(q));
  return NextResponse.json({ projects, canManage: canManageAnalytics(actor) });
}

/** Crea un proyecto (admins). */
export async function POST(req: NextRequest) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  if (!canManageAnalytics(actor)) return aError(403, 'forbidden');
  const body = await readJson(req);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return aError(400, 'name_required');
  const existing = await listProjects(actor.workspaceId);
  if (existing.length >= 50) return aError(400, 'too_many_projects');
  const p = await createProject(actor.workspaceId, actor.personId, name);
  return NextResponse.json({ project: toProjectDto(p) }, { status: 201 });
}

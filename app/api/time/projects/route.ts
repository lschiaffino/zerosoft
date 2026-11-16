import { NextRequest } from 'next/server';
import { createProject, listProjects } from '@/lib/time/core';
import { parseBody, tFail, timeActor, timeLimit, tJson } from '@/lib/time/http';
import { projectSchema } from '@/lib/time/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?q=: proyectos del workspace (todos los miembros los ven para cargar horas). */
export async function GET(req: NextRequest) {
  const a = await timeActor();
  if ('res' in a) return a.res;
  return tJson({ projects: await listProjects(a.actor, { q: req.nextUrl.searchParams.get('q') ?? '' }) });
}

/** POST: proyecto nuevo (solo quien administra). */
export async function POST(req: NextRequest) {
  const a = await timeActor();
  if ('res' in a) return a.res;
  const limited = await timeLimit(req, 'project', 200, 3600, a.actor.person);
  if (limited) return limited;
  try {
    return tJson({ project: await createProject(a.actor, await parseBody(req, projectSchema)) }, 201);
  } catch (err) {
    return tFail(err);
  }
}

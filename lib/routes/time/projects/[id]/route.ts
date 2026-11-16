import { NextRequest } from 'next/server';
import { deleteProject, getProject, updateProject } from '@/lib/time/core';
import { parseBody, tFail, timeActor, tJson, type Ctx } from '@/lib/time/http';
import { projectSchema } from '@/lib/time/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: Ctx) {
  const a = await timeActor();
  if ('res' in a) return a.res;
  const project = await getProject(a.actor, (await params).id);
  return project ? tJson({ project }) : tJson({ error: 'not_found' }, 404);
}

/** PATCH: editar, archivar (`archived: true`) o restaurar (solo quien administra). */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const a = await timeActor();
  if ('res' in a) return a.res;
  try {
    return tJson({ project: await updateProject(a.actor, (await params).id, await parseBody(req, projectSchema)) });
  } catch (err) {
    return tFail(err);
  }
}

/** DELETE: borra el proyecto con sus horas (solo quien administra). */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const a = await timeActor();
  if ('res' in a) return a.res;
  try {
    await deleteProject(a.actor, (await params).id);
    return tJson({ ok: true });
  } catch (err) {
    return tFail(err);
  }
}

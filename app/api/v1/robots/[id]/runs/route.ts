import { NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { getRobotRow, getRobotWorkspaceConfig, listRobotRuns, startRobotRun } from '@/lib/robots';
import { canRunRobot } from '@/lib/robots-http';
import { apiRobotViewer, robotApiError, toApiRobotRun } from '@/lib/robots-api';
import { robotApiRunSchema } from '@/lib/robots-schema';
import { roleAtLeast } from '@/lib/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Con wait: arranque del sandbox + hasta 180 s de navegador.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/** Últimas corridas del robot (hasta 100, con ?limit=). */
export async function GET(req: Request, props: Ctx) {
  const auth = await requireApiUser(req, 'robots:run');
  if ('res' in auth) return auth.res;
  const { id } = await props.params;
  if (!(await getRobotRow(auth.user.id, id))) return apiError(404, 'not_found', 'Robot not found.');
  const limit = Number(new URL(req.url).searchParams.get('limit') ?? 30);
  const runs = await listRobotRuns(auth.user.id, id, Number.isFinite(limit) ? limit : 30, apiRobotViewer(auth));
  return NextResponse.json({ runs: runs.map(toApiRobotRun) });
}

/**
 * Corre el robot. Por defecto queda en cola y responde 202 al instante
 * (se consulta en GET /api/v1/robots/runs/:id); con "wait": true espera el
 * resultado en la misma respuesta (200) si no hay otra corrida delante.
 */
export async function POST(req: Request, props: Ctx) {
  const auth = await requireApiUser(req, 'robots:run');
  if ('res' in auth) return auth.res;
  const { id } = await props.params;
  // La key actúa con el rol de quien la creó, con las mismas reglas que la app.
  const row = await getRobotRow(auth.user.id, id);
  if (!row && !roleAtLeast(auth.role, 'admin')) return apiError(403, 'forbidden', 'Running robots requires a workspace admin.');
  if (row && !canRunRobot({ role: auth.role }, row, await getRobotWorkspaceConfig(auth.user.id))) {
    return apiError(403, 'forbidden', 'Running this robot requires a workspace admin.');
  }
  const parsed = robotApiRunSchema.safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return apiError(400, 'invalid_input', 'Body must be { "inputs"?: object, "wait"?: boolean }.');
  const res = await startRobotRun(auth.user.id, id, parsed.data.inputs, {
    trigger: 'api',
    actorId: auth.personId,
    defer: parsed.data.wait !== true,
  });
  if (!res.ok) return robotApiError(res.error, { name: res.name });
  const done = res.run.status === 'success' || res.run.status === 'failed';
  return NextResponse.json({ run: toApiRobotRun(res.run) }, { status: done ? 200 : 202 });
}

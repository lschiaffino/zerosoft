import { NextRequest, NextResponse } from 'next/server';
import { insightQuerySchema, webQuerySchema } from '@/lib/analytics/types';
import { QueryError, runInsight, runWeb } from '@/lib/analytics/query';
import { actorProject, aError, analyticsActor, isResponse, readJson } from '@/lib/analytics/http';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Corre una consulta (tendencia, embudo, retención, caminos, SQL o web) sobre
 * un proyecto del workspace: body { projectId, query }.
 */
export async function POST(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const body = await readJson(req);
  const project = await actorProject(actor, typeof body?.projectId === 'string' ? body.projectId : null);
  if (isResponse(project)) return project;
  const raw = body?.query as { kind?: string } | undefined;
  // Tope por workspace: las consultas leen mucho (más estricto para SQL).
  const sql = raw?.kind === 'sql';
  const limit = await rateLimit(`aquery:${sql ? 'sql:' : ''}${actor.workspaceId}`, sql ? 30 : 240, 60);
  if (!limit.ok && process.env.RATE_LIMIT_DISABLED !== 'true') return aError(429, 'rate_limited');
  try {
    if (raw?.kind === 'web') {
      const q = webQuerySchema.safeParse(raw);
      if (!q.success) return aError(400, 'invalid_query');
      return NextResponse.json({ result: await runWeb(project, q.data) });
    }
    const q = insightQuerySchema.safeParse(raw);
    if (!q.success) return aError(400, 'invalid_query', { issues: q.error.issues.slice(0, 5).map((i) => i.path.join('.')) });
    return NextResponse.json({ result: await runInsight(project, q.data) });
  } catch (err) {
    if (err instanceof QueryError) return aError(err.code === 'sql_busy' ? 429 : 400, err.code, { detail: err.detail ?? null });
    throw err;
  }
}

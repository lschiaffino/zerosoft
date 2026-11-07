import { NextRequest, NextResponse } from 'next/server';
import { llmGenerations } from '@/lib/analytics/llm';
import { dateRangeSchema } from '@/lib/analytics/types';
import { actorProject, aError, analyticsActor, isResponse } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Generaciones, lo más nuevo primero: ?project=&from=&model=&trace=&errors=1&before=<id>. */
export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const sp = req.nextUrl.searchParams;
  const project = await actorProject(actor, sp.get('project'));
  if (isResponse(project)) return project;
  const range = dateRangeSchema.safeParse({ from: sp.get('from') ?? '-30d' });
  if (!range.success) return aError(400, 'invalid_range');
  const before = Number(sp.get('before'));
  return NextResponse.json(
    await llmGenerations(project, {
      from: range.data.from,
      model: sp.get('model'),
      trace: sp.get('trace'),
      errorsOnly: sp.get('errors') === '1',
      before: Number.isSafeInteger(before) && before > 0 ? before : null,
    }),
  );
}

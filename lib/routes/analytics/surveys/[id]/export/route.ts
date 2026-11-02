import { NextRequest, NextResponse } from 'next/server';
import { resolveRange } from '@/lib/analytics/compute';
import { dateRangeSchema } from '@/lib/analytics/types';
import { getSurvey, surveySentRows } from '@/lib/analytics/surveys';
import { surveyCsvRow } from '@/lib/analytics/surveys-core';
import { aError, analyticsActor, isResponse, recordProject , canManageAnalytics } from '@/lib/analytics/http';
import { csvLine } from '@/lib/form-engine';
import { rateLimit } from '@/lib/rate-limit';
import { projectTz } from '@/lib/analytics/tz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** CSV de las respuestas: valores ya validados contra cada pregunta, y celdas a prueba de fórmulas. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  // Bajar un archivo con todas las respuestas es de admins; ver los resultados, de cualquier miembro.
  if (!canManageAnalytics(actor)) return aError(403, 'forbidden');
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_surveys', id);
  if (isResponse(project)) return project;
  const range = dateRangeSchema.safeParse({ from: req.nextUrl.searchParams.get('from') ?? '-30d' });
  if (!range.success) return aError(400, 'invalid_range');
  const limit = await rateLimit(`aexport:${actor.workspaceId}`, 30, 60);
  if (!limit.ok && process.env.RATE_LIMIT_DISABLED !== 'true') return aError(429, 'rate_limited');
  const survey = await getSurvey(project.id, id);
  if (!survey) return aError(404, 'not_found');
  const window = resolveRange({ from: range.data.from }, Date.now(), projectTz(project));
  const { rows } = await surveySentRows(project, id, window);
  const lines = [csvLine(['timestamp', 'distinct_id', ...survey.questions.map((q) => q.text)]), ...rows.map((r) => csvLine(surveyCsvRow(survey.questions, r)))];
  const slug = survey.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'survey';
  return new NextResponse(`﻿${lines.join('\r\n')}\r\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${slug}-responses.csv"`,
      'cache-control': 'no-store',
    },
  });
}

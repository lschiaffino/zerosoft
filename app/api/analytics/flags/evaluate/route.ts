import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { evaluateFlag } from '@/lib/analytics/flags-core';
import { personPropsFor } from '@/lib/analytics/flags';
import { getFlag } from '@/lib/analytics/records';
import { aError, analyticsActor, isResponse, readJson, recordProject } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  flagId: z.string().max(64),
  distinctId: z.string().trim().min(1).max(200),
  properties: z.record(z.unknown()).optional(),
});

/** Prueba un flag para un distinct_id (con sus propiedades guardadas más las que se pasen). */
export async function POST(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input');
  const project = await recordProject(actor, 'analytics_flags', parsed.data.flagId);
  if (isResponse(project)) return project;
  const flag = await getFlag(project.id, parsed.data.flagId);
  if (!flag) return aError(404, 'not_found');
  const props = { ...(await personPropsFor(project.id, parsed.data.distinctId)), ...(parsed.data.properties ?? {}) };
  return NextResponse.json({ value: evaluateFlag(flag, parsed.data.distinctId, props), properties: props });
}

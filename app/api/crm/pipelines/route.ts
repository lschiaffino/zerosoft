import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createPipeline, listPipelinesWithStages } from '@/lib/crm';
import { pipelineCreateSchema } from '@/lib/crm-schema';
import { invalidBody, unauthorized } from '@/lib/crm-http';
import { hiddenFieldsFor, sessionFieldViewer } from '@/lib/crm-field-perms';
import { redactStagesFor } from '@/lib/crm-stage-move';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  // Lo que pide cada etapa, sin nombrar campos que la persona tiene ocultos.
  const hidden = await hiddenFieldsFor(sessionFieldViewer(user), 'deals');
  const rows = (await listPipelinesWithStages(user.id)).map((p) => ({ ...p, stages: redactStagesFor(p.stages, hidden) }));
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = pipelineCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const pipeline = await createPipeline(user.id, parsed.data.name);
  return NextResponse.json(pipeline, { status: 201 });
}

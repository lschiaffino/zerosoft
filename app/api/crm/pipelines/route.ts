import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createPipeline, listPipelinesWithStages } from '@/lib/crm';
import { pipelineCreateSchema } from '@/lib/crm-schema';
import { invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ rows: await listPipelinesWithStages(user.id) });
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

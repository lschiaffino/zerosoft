import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createWorkflow, listWorkflows } from '@/lib/crm-workflows';
import { workflowCreateSchema } from '@/lib/crm-workflows-schema';
import { invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ workflows: await listWorkflows(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = workflowCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const workflow = await createWorkflow(user.id, parsed.data);
  return NextResponse.json(workflow, { status: 201 });
}

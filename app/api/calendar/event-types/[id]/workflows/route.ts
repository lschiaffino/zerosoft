import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { listWorkflowSteps, setWorkflowSteps } from '@/lib/calendar-workflows';
import { workflowStepsSchema } from '@/lib/calendar-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Pasos del workflow de recordatorios del tipo de evento. */
export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const steps = await listWorkflowSteps(user.id, id);
  return steps ? NextResponse.json({ steps }) : notFound();
}

/** PUT { steps: [...] } reemplaza todos los pasos y reprograma las reservas próximas. */
export async function PUT(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = workflowStepsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const steps = await setWorkflowSteps(user.id, id, parsed.data.steps);
  return steps ? NextResponse.json({ steps }) : notFound();
}

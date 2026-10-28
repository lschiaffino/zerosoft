import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { listWorkflowSteps, setWorkflowSteps } from '@/lib/calendar-workflows';
import { workflowStepsSchema } from '@/lib/calendar-schema';
import { crmError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';
import { actorIdOf, logCalActivity } from '@/lib/calendar-activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Pasos del workflow del tipo de evento (los webhooks traen su secreto: solo admins). */
export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const steps = await listWorkflowSteps(user.id, id);
  if (!steps) return notFound();
  const admin = isWorkspaceAdmin(user);
  return NextResponse.json({ steps: admin ? steps : steps.map((s) => ({ ...s, secret: '' })) });
}

/**
 * PUT { steps: [...] } reemplaza todos los pasos y reprograma las reservas
 * próximas. Los workflows mandan SMS y webhooks a cuenta del workspace: los
 * cambia un admin.
 */
export async function PUT(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return crmError(403, 'forbidden');
  const parsed = workflowStepsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const steps = await setWorkflowSteps(user.id, id, parsed.data.steps);
  if (!steps) return notFound();
  await logCalActivity(user.id, actorIdOf(user), 'workflow.updated', { type: 'event_type', id, summary: `${steps.length}` });
  return NextResponse.json({ steps });
}

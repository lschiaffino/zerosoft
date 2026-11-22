import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { createWorkflow, listWorkflows, workflowsForViewer } from '@/lib/crm-workflows';
import { sessionFieldViewer } from '@/lib/crm-field-perms';
import { workflowCreateSchema } from '@/lib/crm-workflows-schema';
import { redactActionsForMember } from '@/lib/crm-workflow-rules';
import { invalidBody, unauthorized, forbidden } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  // Sin los que nombran un campo que la persona tiene oculto.
  const workflows = await workflowsForViewer(sessionFieldViewer(user), await listWorkflows(user.id));
  // Quien no administra workflows no ve cabeceras ni URLs completas de webhooks (pueden llevar tokens).
  return NextResponse.json({
    workflows: isWorkspaceAdmin(user) ? workflows : workflows.map((w) => ({ ...w, actions: redactActionsForMember(w.actions) })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();

  const body: unknown = await req.json().catch(() => null);
  const parsed = workflowCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  // Un workflow nuevo arranca sin reinscripción, como en HubSpot (los de antes de W1 la conservan).
  const data = { ...parsed.data, settings: { reenroll: false, ...(parsed.data.settings ?? {}) } };
  const workflow = await createWorkflow(user.id, data, realUserId(user));
  return NextResponse.json(workflow, { status: 201 });
}

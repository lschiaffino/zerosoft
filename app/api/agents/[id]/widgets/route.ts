import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { getAgentRow, listWorkspaceWidgets, setWidgetAgent } from '@/lib/agents';
import { agentError, canEditAgents, forbidden, notFound, unauthorized } from '@/lib/agents-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await getAgentRow(user.id, id))) return notFound();
  return NextResponse.json({ widgets: await listWorkspaceWidgets(user.id) });
}

const schema = z.object({ widgetId: z.string().min(1).max(100), assigned: z.boolean() });

/** Asigna o quita el agente como bot de un widget de Chat. */
export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditAgents(user)) return forbidden();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  if (!(await setWidgetAgent(user.id, id, parsed.data.widgetId, parsed.data.assigned))) return notFound();
  return NextResponse.json({ widgets: await listWorkspaceWidgets(user.id) });
}

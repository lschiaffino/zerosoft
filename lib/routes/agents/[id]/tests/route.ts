import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createTestCase, listTestCases } from '@/lib/agents-tests';
import { testCaseInputSchema } from '@/lib/agents-config';
import { agentError, canEditAgent, forbidden, notFound, realUserId, unauthorized, visibleAgentRow } from '@/lib/agents-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Casos de prueba del agente (cualquier miembro los ve y los corre). */
export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await visibleAgentRow(user, id))) return notFound();
  return NextResponse.json({ tests: await listTestCases(user.id, id) });
}

/** Guardar un caso: admins y owners (como editar el agente). */
export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const accessRow = await visibleAgentRow(user, id);
  if (!accessRow) return notFound();
  if (!canEditAgent(user, accessRow)) return forbidden();
  const agent = await visibleAgentRow(user, id);
  if (!agent) return notFound();
  const parsed = testCaseInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  const res = await createTestCase(agent, parsed.data, realUserId(user));
  if (!res.ok) return agentError(400, res.error);
  return NextResponse.json({ test: res.test }, { status: 201 });
}

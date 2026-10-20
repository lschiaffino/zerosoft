import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getAgentRow, listSecretHeaders, setSecretHeader } from '@/lib/agents';
import { secretHeaderInputSchema } from '@/lib/agents-config';
import { agentError, canEditAgents, forbidden, notFound, unauthorized } from '@/lib/agents-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Headers secretos de http_request: solo nombre y dominio, nunca el valor. */
export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditAgents(user)) return forbidden();
  const agent = await getAgentRow(user.id, id);
  if (!agent) return notFound();
  return NextResponse.json({ headers: listSecretHeaders(agent) });
}

/** Guarda (o reemplaza) un header. El valor se cifra y no se vuelve a mostrar. */
export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditAgents(user)) return forbidden();
  const parsed = secretHeaderInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const reserved = parsed.error.issues.some((i) => i.message === 'reserved_header');
    return agentError(400, reserved ? 'reserved_header' : 'invalid_input', { field: String(parsed.error.issues[0]?.path?.[0] ?? '') });
  }
  const res = await setSecretHeader(user.id, id, parsed.data);
  if (!res.ok) return res.error === 'not_found' ? notFound() : agentError(400, res.error);
  return NextResponse.json({ headers: res.headers });
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { agentError, agentRouteContext } from '@/lib/agents-http';
import { recordAgentChange } from '@/lib/agents';
import {
  AGENT_INTEGRATION_KINDS,
  connectIntegration,
  disconnectIntegration,
  integrationsDto,
  IntegrationError,
} from '@/lib/agents-integrations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Conexiones del agente (sin secretos). Solo admins y owners. */
export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id, { admin: true });
  if ('res' in ctx) return ctx.res;
  return NextResponse.json({ integrations: integrationsDto(ctx.row) });
}

const secret = z.string().trim().min(8).max(500).regex(/^[^\s]+$/);
const schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stripe'), key: secret }),
  z.object({ kind: z.literal('shopify'), shop: z.string().trim().min(2).max(200), token: secret }),
  z.object({ kind: z.literal('slack'), botToken: secret, signingSecret: secret }),
  z.object({ kind: z.literal('meta'), pageToken: z.string().trim().min(20).max(1000), appSecret: secret }),
]);

/** Conecta (o reemplaza) una conexión: se prueba contra el servicio y se guarda cifrada. */
export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id, { admin: true });
  if ('res' in ctx) return ctx.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  try {
    const integrations = await connectIntegration(ctx.user.id, ctx.row, parsed.data);
    await recordAgentChange(ctx.user.id, id, ctx.personId, 'integration_changed', { action: 'connect', integration: parsed.data.kind });
    return NextResponse.json({ integrations });
  } catch (err) {
    if (err instanceof IntegrationError) return agentError(err.status, err.code);
    throw err;
  }
}

export async function DELETE(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id, { admin: true });
  if ('res' in ctx) return ctx.res;
  const kind = req.nextUrl.searchParams.get('kind') ?? '';
  if (!(AGENT_INTEGRATION_KINDS as readonly string[]).includes(kind)) return agentError(400, 'invalid_input');
  const integrations = await disconnectIntegration(ctx.user.id, ctx.row, kind as (typeof AGENT_INTEGRATION_KINDS)[number]);
  await recordAgentChange(ctx.user.id, id, ctx.personId, 'integration_changed', { action: 'disconnect', integration: kind });
  return NextResponse.json({ integrations });
}

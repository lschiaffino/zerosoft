import { NextResponse } from 'next/server';
import { INTEGRATION_KINDS, IntegrationError, deleteIntegration, testIntegration, type IntegrationKind } from '@/lib/groups-integrations';
import { groupsError, groupsSession } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ kind: string }> };

async function kindOf(ctx: Ctx): Promise<IntegrationKind | null> {
  const k = (await ctx.params).kind;
  return (INTEGRATION_KINDS as readonly string[]).includes(k) ? (k as IntegrationKind) : null;
}

/** Prueba: Slack manda un mensaje al canal; Freshdesk y Zoho validan las credenciales. */
export async function POST(_req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const kind = await kindOf(ctx);
  if (!kind) return groupsError(404, 'not_found');
  try {
    await testIntegration(s.ws, kind);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof IntegrationError) return groupsError(err.code === 'not_found' ? 404 : 502, err.code);
    throw err;
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const kind = await kindOf(ctx);
  if (!kind) return groupsError(404, 'not_found');
  return (await deleteIntegration(s.ws, kind)) ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
}

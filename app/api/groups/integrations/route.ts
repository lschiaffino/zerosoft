import { NextResponse } from 'next/server';
import { INTEGRATION_KINDS, IntegrationError, listIntegrations, saveIntegration, type IntegrationKind } from '@/lib/groups-integrations';
import { groupsError, groupsSession, readJson, strArr } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Slack, Freshdesk y Zoho Desk del workspace (sin secretos). Solo admins. */
export async function GET() {
  const s = await groupsSession({ admin: true });
  if (s instanceof NextResponse) return s;
  return NextResponse.json({ integrations: await listIntegrations(s.ws) });
}

/** { kind, config, events?, active? }: conecta o edita (un secreto vacío conserva el anterior). */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const kind = INTEGRATION_KINDS.find((k) => k === b.kind) as IntegrationKind | undefined;
  if (!kind) return groupsError(400, 'invalid_kind');
  try {
    const dto = await saveIntegration(s.ws, s.me, kind, {
      config: b.config && typeof b.config === 'object' ? (b.config as Record<string, unknown>) : {},
      events: Array.isArray(b.events) ? strArr(b.events, 10) : undefined,
      active: b.active !== false,
    });
    return NextResponse.json(dto);
  } catch (err) {
    if (err instanceof IntegrationError) return groupsError(400, err.code);
    throw err;
  }
}

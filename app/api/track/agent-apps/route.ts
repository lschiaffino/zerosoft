import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { createAgentApp, listAgentApps } from '@/lib/track-agents';
import { domainError } from '@/lib/track-triage-http';
import { invalidBody, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ name: z.string().trim().min(1).max(80), webhookUrl: z.string().trim().max(1000).optional() });

/** Agentes externos que pueden trabajar issues (Linear for Agents). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ rows: await listAgentApps(user.id) });
}

/** Alta: devuelve el token del agente y el secreto de firma una sola vez. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    return NextResponse.json(await createAgentApp(user.id, parsed.data, realUserId(user)), { status: 201 });
  } catch (err) {
    return domainError(err);
  }
}

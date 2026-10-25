import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { deleteAgentApp, updateAgentApp } from '@/lib/track-agents';
import { domainError } from '@/lib/track-triage-http';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ name: z.string().trim().min(1).max(80).optional(), webhookUrl: z.string().trim().max(1000).optional() });

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    const app = await updateAgentApp(user.id, (await props.params).id, parsed.data);
    return app ? NextResponse.json(app) : notFound();
  } catch (err) {
    return domainError(err);
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');
  return (await deleteAgentApp(user.id, (await props.params).id)) ? NextResponse.json({ ok: true }) : notFound();
}

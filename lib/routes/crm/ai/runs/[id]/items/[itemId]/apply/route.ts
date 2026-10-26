import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { unauthorized } from '@/lib/crm-http';
import { applyItem } from '@/lib/crm-ai-agents';
import { aiErrorResponse } from '@/lib/crm-ai-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Aplica los cambios propuestos de un ítem (solo los campos vacíos que el agente encontró). */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  try {
    return NextResponse.json(
      await applyItem({ workspaceId: user.id, runId: id, itemId, scope: await sessionScope(user), actorEmail: user.actingUser?.email ?? user.email }),
    );
  } catch (err) {
    return aiErrorResponse(err);
  }
}

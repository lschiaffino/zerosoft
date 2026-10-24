import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { limitAction, unauthorized } from '@/lib/crm-http';
import { sendItem } from '@/lib/crm-ai-agents';
import { aiErrorResponse } from '@/lib/crm-ai-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Envía el borrador del agente de prospección (Gmail del usuario o envío del sistema). */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  // Mismo límite que los emails del timeline.
  const limited = await limitAction(realUserId(user), 'email', 60, 3600);
  if (limited) return limited;
  try {
    return NextResponse.json(
      await sendItem({
        workspaceId: user.id,
        runId: id,
        itemId,
        scope: await sessionScope(user),
        senderId: realUserId(user),
        fromEmail: user.actingUser?.email ?? user.email,
      }),
    );
  } catch (err) {
    return aiErrorResponse(err);
  }
}

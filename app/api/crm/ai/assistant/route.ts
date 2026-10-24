import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { invalidBody, limitAction, unauthorized } from '@/lib/crm-http';
import { assistantRequestSchema, runAssistant } from '@/lib/crm-ai-assistant';
import { aiErrorResponse, aiLocale } from '@/lib/crm-ai-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

/**
 * Asistente del CRM: responde con texto, los registros que encontró y las
 * propuestas de cambio. Las propuestas no se aplican acá: la UI manda el
 * pedido de cada una a la API del CRM cuando la persona confirma.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = assistantRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const limited = await limitAction(realUserId(user), 'ai-assistant', 120, 3600);
  if (limited) return limited;
  try {
    const reply = await runAssistant({
      workspaceId: user.id,
      personId: realUserId(user),
      scope: await sessionScope(user),
      request: { ...parsed.data, locale: aiLocale(req, parsed.data.locale) },
    });
    return NextResponse.json(reply);
  } catch (err) {
    return aiErrorResponse(err);
  }
}

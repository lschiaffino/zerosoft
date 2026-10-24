import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canSeeActivity, sessionScope } from '@/lib/crm-visibility';
import { invalidBody, limitAction, notFound, unauthorized } from '@/lib/crm-http';
import { generateCallSummary, getCallSummary } from '@/lib/crm-ai';
import { aiErrorResponse, aiLocale } from '@/lib/crm-ai-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({ activityId: z.string().min(1).max(64), locale: z.string().max(5).optional() });

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = bodySchema.safeParse({ activityId: req.nextUrl.searchParams.get('activityId') });
  if (!parsed.success) return invalidBody(parsed.error);
  if (!(await canSeeActivity(user.id, parsed.data.activityId, await sessionScope(user)))) return notFound();
  return NextResponse.json({ summary: await getCallSummary(user.id, parsed.data.activityId) });
}

/** Resume una llamada o reunión del timeline (notas del cuerpo y transcripciones adjuntas). */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const limited = await limitAction(realUserId(user), 'ai-call-summary', 120, 3600);
  if (limited) return limited;
  try {
    const summary = await generateCallSummary({
      workspaceId: user.id,
      activityId: parsed.data.activityId,
      scope: await sessionScope(user),
      locale: aiLocale(req, parsed.data.locale),
      actorId: realUserId(user),
    });
    return NextResponse.json({ summary });
  } catch (err) {
    return aiErrorResponse(err);
  }
}

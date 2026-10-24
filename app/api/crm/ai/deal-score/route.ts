import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { guardRecord, invalidBody, limitAction, unauthorized } from '@/lib/crm-http';
import { crmAiAvailable, generateDealScore, getDealScore } from '@/lib/crm-ai';
import { aiErrorResponse, aiLocale } from '@/lib/crm-ai-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({ id: z.string().min(1).max(64), locale: z.string().max(5).optional() });

/** Score y plan guardados del deal (o null). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = bodySchema.safeParse({ id: req.nextUrl.searchParams.get('id') });
  if (!parsed.success) return invalidBody(parsed.error);
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, 'deal', parsed.data.id, scope);
  if (hidden) return hidden;
  return NextResponse.json({ score: await getDealScore(user.id, parsed.data.id, scope), available: await crmAiAvailable() });
}

/** Calcula (o recalcula) el score y el plan del deal. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, 'deal', parsed.data.id, scope);
  if (hidden) return hidden;
  const limited = await limitAction(realUserId(user), 'ai-deal-score', 120, 3600);
  if (limited) return limited;
  try {
    const score = await generateDealScore({
      workspaceId: user.id,
      id: parsed.data.id,
      scope,
      locale: aiLocale(req, parsed.data.locale),
      actorId: realUserId(user),
    });
    return NextResponse.json({ score });
  } catch (err) {
    return aiErrorResponse(err);
  }
}

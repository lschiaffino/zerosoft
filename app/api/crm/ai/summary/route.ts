import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { crmError, guardRecord, invalidBody, limitAction, unauthorized } from '@/lib/crm-http';
import { crmAiAvailable, generateRecordSummary, getRecordSummary } from '@/lib/crm-ai';
import { aiErrorResponse, aiLocale } from '@/lib/crm-ai-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const entity = z.enum(['contact', 'company', 'deal']);
const bodySchema = z.object({ entity, id: z.string().min(1).max(64), locale: z.string().max(5).optional() });

/** Resumen guardado del registro (o null) y si hay IA para generarlo. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = bodySchema.safeParse({
    entity: req.nextUrl.searchParams.get('entity'),
    id: req.nextUrl.searchParams.get('id'),
  });
  if (!parsed.success) return invalidBody(parsed.error);
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, parsed.data.entity, parsed.data.id, scope);
  if (hidden) return hidden;
  const summary = await getRecordSummary(user.id, parsed.data.entity, parsed.data.id, scope);
  return NextResponse.json({ summary, available: await crmAiAvailable() });
}

/** Genera (o regenera) el resumen con IA. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, parsed.data.entity, parsed.data.id, scope);
  if (hidden) return hidden;
  const limited = await limitAction(realUserId(user), 'ai-summary', 120, 3600);
  if (limited) return limited;
  try {
    const summary = await generateRecordSummary({
      workspaceId: user.id,
      entity: parsed.data.entity,
      id: parsed.data.id,
      scope,
      locale: aiLocale(req, parsed.data.locale),
      actorId: realUserId(user),
    });
    return NextResponse.json({ summary });
  } catch (err) {
    if (err instanceof SyntaxError) return crmError(400, 'invalid_input');
    return aiErrorResponse(err);
  }
}

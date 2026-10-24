import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { catchRef, crmError, CrmRefError, guardRecord, invalidBody, limitAction, notFound, unauthorized } from '@/lib/crm-http';
import { createActivity } from '@/lib/crm';
import { addDealPlanTask, crmAiAvailable, generateDealScore, getDealScore } from '@/lib/crm-ai';
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

const planTaskSchema = z.object({
  id: z.string().min(1).max(64),
  index: z.number().int().min(0).max(9),
  /** Vencimiento en la hora local de quien lo pide (YYYY-MM-DD HH:MM). */
  dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/),
});

/** Pasa un paso del plan a tarea del deal (una sola vez; queda marcado en el plan guardado). */
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = planTaskSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, 'deal', parsed.data.id, scope);
  if (hidden) return hidden;
  const res = await catchRef(
    addDealPlanTask(user.id, parsed.data.id, parsed.data.index, async (step) => {
      const task = await createActivity(user.id, {
        type: 'task',
        subject: step.title,
        dueAt: parsed.data.dueAt,
        dealId: parsed.data.id,
      });
      return task.id;
    }),
  );
  if (res instanceof CrmRefError) return crmError(400, res.code);
  if (!res.ok) return res.reason === 'not_found' ? notFound() : crmError(409, res.reason);
  return NextResponse.json({ taskId: res.taskId });
}

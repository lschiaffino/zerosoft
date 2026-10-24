import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getDb } from '@/lib/db';
import { scopeAnd, sessionScope } from '@/lib/crm-visibility';
import { invalidBody, limitAction, unauthorized } from '@/lib/crm-http';
import { generateDealScore } from '@/lib/crm-ai';
import { aiErrorResponse, aiLocale } from '@/lib/crm-ai-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const bodySchema = z.object({ pipelineId: z.string().min(1).max(64), locale: z.string().max(5).optional() });

/** Deals abiertos del pipeline sin score o con actividad posterior al score. */
async function dealsToScore(workspaceId: string, pipelineId: string, scope: string[] | null) {
  const s = scopeAnd('d', scope);
  return (await getDb()
    .prepare(
      `SELECT d.id FROM crm_deals d
       JOIN crm_stages st ON st.id = d.stage_id
       LEFT JOIN crm_ai_insights i ON i.user_id = d.user_id AND i.entity = 'deal' AND i.entity_id = d.id AND i.kind = 'deal_score'
       WHERE d.user_id = ? AND d.pipeline_id = ? AND st.is_won = 0 AND st.is_lost = 0${s.sql}
         AND (i.id IS NULL OR replace(substr(i.updated_at, 1, 19), 'T', ' ') < replace(substr(COALESCE(d.last_activity_at, d.updated_at), 1, 19), 'T', ' '))
       ORDER BY d.amount DESC`,
    )
    .all(workspaceId, pipelineId, ...s.args)) as Array<{ id: string }>;
}

/** Score con IA de los deals abiertos del board, de a tandas (la UI repite hasta remaining = 0). */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const limited = await limitAction(realUserId(user), 'ai-deal-score-batch', 60, 3600);
  if (limited) return limited;
  const scope = await sessionScope(user);
  const todo = await dealsToScore(user.id, parsed.data.pipelineId, scope ?? null);
  const batch = todo.slice(0, 6);
  let scored = 0;
  try {
    for (const d of batch) {
      await generateDealScore({ workspaceId: user.id, id: d.id, scope, locale: aiLocale(req, parsed.data.locale), actorId: realUserId(user) });
      scored++;
    }
  } catch (err) {
    if (scored === 0) return aiErrorResponse(err);
  }
  return NextResponse.json({ scored, remaining: Math.max(0, todo.length - scored) });
}

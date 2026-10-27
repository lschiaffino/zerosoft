import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { agentError, agentRouteContext } from '@/lib/agents-http';
import { checkAgentRules, scoreAgentNow } from '@/lib/agents-quality';
import { toAgentDto } from '@/lib/agents';
import { withDraft } from '@/lib/agents-draft';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({ action: z.enum(['score', 'rules']) });

/**
 * score: puntúa ahora las últimas conversaciones sin puntaje (CSAT,
 * sentimiento, tema, scorecard). rules: busca reglas que chocan en el
 * borrador del agente.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  if (process.env.RATE_LIMIT_DISABLED !== 'true') {
    const limited = await rateLimit(`agent-quality:${id}:${parsed.data.action}`, 10, 600);
    if (!limited.ok) return agentError(429, 'rate_limited');
  }
  if (parsed.data.action === 'rules') {
    const res = await checkAgentRules(ctx.user.id, toAgentDto(withDraft(ctx.row)));
    return NextResponse.json(res);
  }
  const res = await scoreAgentNow(ctx.row);
  if (res.error === 'ai_disabled' && res.scored === 0) return agentError(503, 'ai_disabled');
  if (res.error === 'scoring_off') return agentError(400, 'scoring_off');
  return NextResponse.json(res);
}

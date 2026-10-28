import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { AiError } from '@/lib/ai';
import { createFlow } from '@/lib/flow';
import { buildFlowFromPrompt, FlowBuildError } from '@/lib/flow-ai';
import { canEditFlows, flowError, forbidden, realUserId, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Arma un flow desde una descripción con IA y lo crea apagado (para revisar
 * en el editor). Sin credenciales: se eligen después. Queda de quien lo pide.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  const parsed = z
    .object({ prompt: z.string().trim().min(10).max(2000), locale: z.enum(['en', 'es', 'pt']).default('en'), folderId: z.string().max(100).nullable().optional() })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return flowError(400, 'prompt_too_short');
  try {
    const built = await buildFlowFromPrompt(user.id, parsed.data.prompt, parsed.data.locale);
    const res = await createFlow(user.id, realUserId(user), { ...built, folderId: parsed.data.folderId ?? null });
    if (!res.ok) return flowError(422, 'ai_invalid_flow');
    return NextResponse.json({ id: res.flow.id, flow: res.flow }, { status: 201 });
  } catch (err) {
    if (err instanceof FlowBuildError) return flowError(422, 'ai_invalid_flow');
    if (err instanceof AiError) return flowError(err.code === 'ai_disabled' ? 503 : 429, err.code);
    // eslint-disable-next-line no-console
    console.error('[flow] ai build failed', err);
    return flowError(502, 'ai_error');
  }
}

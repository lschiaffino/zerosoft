import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { AiError } from '@/lib/ai';
import { aiErrorStatus, askWorkspace } from '@/lib/docs-ai';
import { docsError, invalidBody, unauthorized } from '@/lib/docs-http';
import { limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({ question: z.string().trim().min(2).max(1000) });

/**
 * Preguntas sobre todo el workspace (como "Ask" de Notion AI): responde con
 * las páginas que la persona puede abrir (y que la IA puede usar según su
 * teamspace) y cita cada fuente con [n].
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const limited = await limitWrites('docs:ask', realUserId(user), 20);
  if (limited) return limited;
  try {
    const res = await askWorkspace({ id: user.id, actingUser: user.actingUser, team: user.team }, parsed.data.question);
    if ('error' in res) return NextResponse.json({ error: res.error, answer: null, citations: [] });
    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof AiError) return docsError(aiErrorStatus(err.code), err.code);
    // eslint-disable-next-line no-console
    console.error('[docs] ask failed', (err as Error)?.name ?? 'error');
    return docsError(502, 'ai_error');
  }
}

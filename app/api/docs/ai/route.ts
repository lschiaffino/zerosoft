import { canWriteAccess } from '@/lib/docs-access';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { AiError } from '@/lib/ai';
import { getDocAccess, getDocPageRow } from '@/lib/docs';
import { aiErrorStatus, EDITOR_AI_ACTIONS, EDITOR_AI_TONES, runEditorAi } from '@/lib/docs-ai';
import { docsError, forbidden, invalidBody, notFound, unauthorized } from '@/lib/docs-http';
import { limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  pageId: z.string().min(1).max(100),
  action: z.enum(EDITOR_AI_ACTIONS),
  tone: z.enum(EDITOR_AI_TONES).optional(),
  language: z.string().max(10).optional(),
  prompt: z.string().max(2000).optional(),
  selection: z.string().max(20_000).optional(),
  before: z.string().max(20_000).optional(),
  /** Texto de la página como lo ve el editor (puede tener cambios sin guardar). */
  pageText: z.string().max(60_000).default(''),
  pageTitle: z.string().max(300).default(''),
});

/**
 * IA del editor ("Ask AI"): continuar, resumir, mejorar, traducir, cambiar el
 * tono, acortar, alargar, explicar o una instrucción propia, sobre la
 * selección o la página. Devuelve el Markdown para la vista previa; el editor
 * lo inserta recién cuando la persona lo acepta.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const page = await getDocPageRow(parsed.data.pageId);
  const access = page ? await getDocAccess(page, user, { includePublished: false, includePublicLink: false }) : null;
  if (!page || !access) return notFound();
  // El resultado se inserta en la página: hace falta poder editarla (y consume la IA del workspace dueño).
  if (!canWriteAccess(access)) return forbidden();
  if (page.locked === 1) return docsError(423, 'locked');
  const limited = await limitWrites('docs:ai', realUserId(user), 30);
  if (limited) return limited;
  try {
    const markdown = await runEditorAi(page.user_id, { ...parsed.data, pageTitle: parsed.data.pageTitle || page.title }, req.signal);
    return NextResponse.json({ markdown });
  } catch (err) {
    if (err instanceof AiError) return docsError(aiErrorStatus(err.code), err.code);
    if (err instanceof Error && err.name === 'AbortError') return docsError(499, 'aborted');
    // eslint-disable-next-line no-console
    console.error('[docs] ai failed', (err as Error)?.name ?? 'error');
    return docsError(502, 'ai_error');
  }
}

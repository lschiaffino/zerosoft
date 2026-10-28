import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { AiError } from '@/lib/ai';
import { aiErrorStatus, EDITOR_AI_ACTIONS, EDITOR_AI_TONES, runEditorAi } from '@/lib/docs-ai';
import { noteOwner } from '@/lib/notes';
import { resolveNoteAccess } from '@/lib/notes-shares';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  /** El editor manda el id de la nota como pageId (mismo menú que Docs). */
  pageId: z.string().min(1).max(100),
  action: z.enum(EDITOR_AI_ACTIONS),
  tone: z.enum(EDITOR_AI_TONES).optional(),
  language: z.string().max(10).optional(),
  prompt: z.string().max(2000).optional(),
  selection: z.string().max(20_000).optional(),
  before: z.string().max(20_000).optional(),
  pageText: z.string().max(60_000).default(''),
  pageTitle: z.string().max(300).default(''),
});

/**
 * IA del editor en Notes (el menú "Ask AI" de Docs): limpiar, resumir,
 * corregir, traducir, cambiar el tono, acortar o una instrucción propia,
 * sobre la selección o la nota. Pasa por lib/ai.ts (cuota y uso del
 * workspace). Solo quien puede editar la nota; una bloqueada no se manda.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const owner = noteOwner(user);
  const access = await resolveNoteAccess(owner, parsed.data.pageId);
  if (!access || access.access === 'view') return jsonError(404, 'not_found');
  if (access.row.locked != null) return jsonError(409, 'note_locked');
  const limited = await limitWrites('notes:ai', owner.personId, 30);
  if (limited) return limited;
  try {
    const markdown = await runEditorAi(access.owner.workspaceId, { ...parsed.data, pageTitle: parsed.data.pageTitle || access.row.title }, req.signal);
    return NextResponse.json({ markdown });
  } catch (err) {
    if (err instanceof AiError) return jsonError(aiErrorStatus(err.code), err.code);
    if (err instanceof Error && err.name === 'AbortError') return jsonError(499, 'aborted');
    // eslint-disable-next-line no-console
    console.error('[notes] ai failed', (err as Error)?.name ?? 'error');
    return jsonError(502, 'ai_error');
  }
}

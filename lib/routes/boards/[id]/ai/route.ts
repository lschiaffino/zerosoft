import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { isDenied, requireBoardAccess } from '@/lib/board-access-http';
import { AiError } from '@/lib/ai';
import { BoardAiError, aiClusterStickies, aiTextToDiagram, aiWireframeToCode } from '@/lib/board-ai';
import { invalidInput, jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('diagram'), prompt: z.string().trim().min(3).max(4000) }),
  z.object({
    kind: z.literal('cluster'),
    notes: z.array(z.object({ id: z.string().min(1).max(128), text: z.string().max(2000) })).min(1).max(200),
    otherTitle: z.string().trim().min(1).max(40),
  }),
  z.object({
    kind: z.literal('code'),
    image: z
      .string()
      .max(4_000_000)
      .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/),
    texts: z.array(z.string().max(500)).max(200).default([]),
  }),
]);

/**
 * IA de la pizarra (quien la puede editar): texto a diagrama (Mermaid),
 * agrupar stickies por tema, o wireframe a código. Errores: 503 ai_disabled,
 * 429 quota_exceeded / rate_limited, 422 ai_bad_output, 502 ai_failed.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  const access = await requireBoardAccess(user, id, 'edit');
  if (isDenied(access)) return access;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const ws = access.viewer.workspaceId;
  try {
    const b = parsed.data;
    if (b.kind === 'diagram') return NextResponse.json({ mermaid: await aiTextToDiagram(ws, b.prompt) });
    if (b.kind === 'cluster') {
      const notes = b.notes.filter((n) => n.text.trim());
      return NextResponse.json(await aiClusterStickies(ws, notes, b.otherTitle));
    }
    return NextResponse.json({ html: await aiWireframeToCode(ws, b.image, b.texts.filter((t) => t.trim()).slice(0, 200)) });
  } catch (err) {
    if (err instanceof AiError) return NextResponse.json({ error: err.code }, { status: err.code === 'ai_disabled' ? 503 : 429 });
    if (err instanceof BoardAiError) return NextResponse.json({ error: err.code }, { status: 422 });
    console.error('[board-ai] failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'ai_failed' }, { status: 502 });
  }
}

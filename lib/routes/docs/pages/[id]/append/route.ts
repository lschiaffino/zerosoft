import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { unauthorized } from '@/lib/docs-http';
import { DocsPlatformError, updatePage } from '@/lib/docs-platform';
import { docsBlockSchema } from '@/lib/docs-schema';
import { sanitizeBlocks } from '@/lib/docs-sanitize';
import { DOCS_IMPORT_MAX_BLOCKS } from '@/lib/docs-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Mover a" del menú de un bloque: agrega los bloques al final de otra página.
 * Pide poder editar la destino (updatePage chequea el acceso de la persona);
 * la página de origen los saca con su guardado normal.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body = (await req.json().catch(() => null)) as { blocks?: unknown } | null;
  const parsed = Array.isArray(body?.blocks) ? body!.blocks.slice(0, DOCS_IMPORT_MAX_BLOCKS).map((b) => docsBlockSchema.safeParse(b)) : [];
  const blocks = parsed.filter((r) => r.success).map((r) => r.data!);
  if (!blocks.length || blocks.length !== parsed.length) return NextResponse.json({ error: 'invalid_blocks' }, { status: 400 });
  try {
    // Fuera de su página, un bloque anidado queda al primer nivel relativo.
    const base = Math.min(...blocks.map((b) => b.indent ?? 0));
    const moved = sanitizeBlocks(blocks.map((b) => ({ ...b, indent: (b.indent ?? 0) - base || undefined })));
    await updatePage(user, id, { appendBlocks: moved });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof DocsPlatformError) return NextResponse.json({ error: err.code }, { status: err.status });
    throw err;
  }
}

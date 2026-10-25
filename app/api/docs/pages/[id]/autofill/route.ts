import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getDocAccess, getDocPageRow, parseBlocks } from '@/lib/docs';
import { canWriteAccess } from '@/lib/docs-access';
import { autofillRows } from '@/lib/docs-db-ai';
import { normalizeDatabase } from '@/lib/docs-database';
import { docsDbAutofillSchema } from '@/lib/docs-schema';
import { aiErrorResponse } from '@/lib/crm-ai-http';
import { forbidden, invalidBody, notFound, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Autocompletar con IA una propiedad de una base en varias filas (hasta 25
 * por pedido). El editor manda el contenido de cada fila (puede tener
 * cambios sin guardar) y guarda los valores que vuelven. Hace falta poder
 * editar la página; consume IA del workspace dueño de la página.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = docsDbAutofillSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const page = await getDocPageRow(id);
  const access = page ? await getDocAccess(page, user) : null;
  if (!page || !access) return notFound();
  if (!canWriteAccess(access)) return forbidden();
  const { ai, rows, options, multi, prop_id, block_id } = parsed.data;
  // Nombre de la propiedad (si la base ya está guardada) para el prompt.
  const saved = parseBlocks(page.content).find((b) => b.id === block_id && b.type === 'database');
  const propName = saved ? normalizeDatabase(saved).properties.find((p) => p.id === prop_id)?.name ?? '' : '';
  try {
    const values = await autofillRows(page.user_id, {
      mode: ai.mode,
      prompt: ai.prompt,
      language: ai.language,
      propName,
      options,
      multi,
      rows,
    });
    return NextResponse.json({ values });
  } catch (err) {
    return aiErrorResponse(err);
  }
}

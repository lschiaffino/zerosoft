import { createHash, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { importResearchIdeas, researchIdeaSchema } from '@/lib/roadmap';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  items: z.array(researchIdeaSchema).min(1).max(100),
});

/** Compara el bearer con ROADMAP_INGEST_TOKEN en tiempo constante. */
function authorized(req: Request): boolean {
  const expected = process.env.ROADMAP_INGEST_TOKEN?.trim();
  if (!expected || expected.length < 24) return false;
  const got = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(got).digest();
  return timingSafeEqual(a, b);
}

/**
 * Carga ideas al backlog desde la investigación de gaps (el loop y la rutina
 * diaria). Requiere `Authorization: Bearer $ROADMAP_INGEST_TOKEN`; sin token
 * configurado la ruta no existe. Ver importResearchIdeas: cada título entra
 * una sola vez como idea pública.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const { created, skipped } = await importResearchIdeas(parsed.data.items);
  return NextResponse.json({ created, skipped }, { status: created.length ? 201 : 200 });
}

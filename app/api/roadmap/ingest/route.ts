import { createHash, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createRoadmapItem, findRoadmapItemByTitle, roadmapCreateSchema } from '@/lib/roadmap';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  items: z
    .array(roadmapCreateSchema.pick({ title: true, description: true, product: true, kind: true }))
    .min(1)
    .max(100),
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
 * configurado la ruta no existe. Cada ítem entra como idea pública; si ya hay
 * uno con el mismo título (sin importar mayúsculas ni acentos) se saltea.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const created: Array<{ id: string; title: string }> = [];
  const skipped: Array<{ id: string; title: string }> = [];
  for (const item of parsed.data.items) {
    const existing = await findRoadmapItemByTitle(item.title);
    if (existing) {
      skipped.push({ id: existing.id, title: existing.title });
      continue;
    }
    const row = await createRoadmapItem({ ...item, status: 'idea', isPublic: true });
    created.push({ id: row.id, title: row.title });
  }
  return NextResponse.json({ created, skipped }, { status: created.length ? 201 : 200 });
}

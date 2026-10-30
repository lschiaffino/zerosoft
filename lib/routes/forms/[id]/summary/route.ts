import { NextRequest } from 'next/server';
import { formSummary } from '@/lib/forms/responses';
import { fJson, formsActor } from '@/lib/forms/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET: resumen por pregunta, NPS, respuestas por día y abandono por pregunta. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const a = await formsActor();
  if ('res' in a) return a.res;
  const summary = await formSummary(a.actor, (await params).id);
  return summary ? fJson({ summary }) : fJson({ error: 'not_found' }, 404);
}

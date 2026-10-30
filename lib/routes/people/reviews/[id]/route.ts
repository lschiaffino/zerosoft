import { NextRequest } from 'next/server';
import { submitReview } from '@/lib/people-perf';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { answers, submit }: guardar o enviar una evaluación (solo quien evalúa). */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    const b = await readJson(req);
    return pjson({ review: await submitReview(ctx, (await params).id, { answers: (b.answers ?? {}) as Record<string, unknown>, submit: b.submit === true }) });
  });
}

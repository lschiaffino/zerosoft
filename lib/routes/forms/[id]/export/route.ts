import { NextRequest, NextResponse } from 'next/server';
import { exportCsv, type ResponseFilters } from '@/lib/forms/responses';
import { fJson, formsActor } from '@/lib/forms/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET: CSV de las respuestas con los mismos filtros que la tabla (guarda de fórmulas en cada celda). */
export async function GET(req: NextRequest, { params }: Ctx) {
  const a = await formsActor();
  if ('res' in a) return a.res;
  const sp = req.nextUrl.searchParams;
  const filters: ResponseFilters = {
    status: sp.get('status') === 'partial' ? 'partial' : 'completed',
    q: sp.get('q') ?? undefined,
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    question: sp.get('question') ?? undefined,
    value: sp.get('value') ?? undefined,
  };
  const out = await exportCsv(a.actor, (await params).id, filters);
  if (!out) return fJson({ error: 'not_found' }, 404);
  return new NextResponse(`﻿${out.csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${out.name.replace(/[^\w.-]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

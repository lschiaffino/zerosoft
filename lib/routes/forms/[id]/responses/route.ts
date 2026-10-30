import { NextRequest } from 'next/server';
import { z } from 'zod';
import { deleteResponses, listResponses, type ResponseFilters } from '@/lib/forms/responses';
import { fFail, fJson, formsActor, parseBody } from '@/lib/forms/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

function filtersFrom(sp: URLSearchParams): ResponseFilters {
  return {
    status: sp.get('status') === 'partial' ? 'partial' : 'completed',
    q: sp.get('q') ?? undefined,
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    question: sp.get('question') ?? undefined,
    value: sp.get('value') ?? undefined,
    page: Number(sp.get('page')) || 1,
    pageSize: Number(sp.get('pageSize')) || 50,
  };
}

/** GET: respuestas con filtros (estado, búsqueda, fechas, respuesta a una pregunta). */
export async function GET(req: NextRequest, { params }: Ctx) {
  const a = await formsActor();
  if ('res' in a) return a.res;
  const res = await listResponses(a.actor, (await params).id, filtersFrom(req.nextUrl.searchParams));
  return res ? fJson(res) : fJson({ error: 'not_found' }, 404);
}

/** DELETE { ids }: borra respuestas y sus archivos. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const a = await formsActor();
  if ('res' in a) return a.res;
  try {
    const { ids } = await parseBody(req, z.object({ ids: z.array(z.string().max(64)).min(1).max(500) }));
    return fJson({ deleted: await deleteResponses(a.actor, (await params).id, ids) });
  } catch (err) {
    return fFail(err);
  }
}

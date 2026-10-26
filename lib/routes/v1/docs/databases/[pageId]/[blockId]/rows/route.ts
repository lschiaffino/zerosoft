import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api-auth';
import { createRow, queryRows } from '@/lib/docs-platform';
import { docsApi, docsV1Error, pageParams, v1Body } from '@/lib/docs-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ pageId: string; blockId: string }> };

/**
 * GET /api/v1/docs/databases/:pageId/:blockId/rows?q=&filter[Status]=Done&limit=&offset=
 * Filas con sus propiedades (texto y valor crudo). filter[Propiedad]=texto: contiene.
 */
export async function GET(req: Request, props: Params) {
  const { pageId, blockId } = await props.params;
  const ctx = await docsApi(req, 'docs:read');
  if ('res' in ctx) return ctx.res;
  const p = new URL(req.url).searchParams;
  const filter: Record<string, string> = {};
  for (const [k, v] of p.entries()) {
    const m = /^filter\[(.{1,100})\]$/.exec(k);
    if (m) filter[m[1]] = v.slice(0, 200);
  }
  const { limit, offset } = pageParams(req.url);
  try {
    const res = await queryRows(ctx.actor, pageId, blockId, { q: p.get('q') ?? '', filter, limit, offset });
    return NextResponse.json({ data: res.rows, total: res.total, hasMore: res.hasMore });
  } catch (err) {
    return docsV1Error(err);
  }
}

const createSchema = z.object({
  title: z.string().max(2000).optional(),
  /** Propiedad (nombre o id) → valor. Select y multi-select crean la opción; persona por email. */
  properties: z.record(z.union([z.string().max(20_000), z.number(), z.boolean(), z.array(z.string().max(500)).max(100), z.null()])).optional(),
  markdown: z.string().max(200_000).optional(),
  /** Plantilla de fila de la base (id o nombre). */
  template: z.string().max(200).optional(),
});

/** POST /api/v1/docs/databases/:pageId/:blockId/rows — agrega una fila. */
export async function POST(req: Request, props: Params) {
  const { pageId, blockId } = await props.params;
  const ctx = await docsApi(req, 'docs:write');
  if ('res' in ctx) return ctx.res;
  const parsed = createSchema.safeParse(await v1Body(req));
  if (!parsed.success) return apiError(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'Invalid request body.');
  try {
    const row = await createRow(ctx.actor, pageId, blockId, { title: parsed.data.title, values: parsed.data.properties, markdown: parsed.data.markdown, template: parsed.data.template });
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err) {
    return docsV1Error(err);
  }
}

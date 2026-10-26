import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api-auth';
import { deleteRow, getRow, updateRow } from '@/lib/docs-platform';
import { docsApi, docsV1Error, v1Body } from '@/lib/docs-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ pageId: string; blockId: string; rowId: string }> };

/** GET /api/v1/docs/databases/:pageId/:blockId/rows/:rowId — la fila con su cuerpo en Markdown. */
export async function GET(req: Request, props: Params) {
  const { pageId, blockId, rowId } = await props.params;
  const ctx = await docsApi(req, 'docs:read');
  if ('res' in ctx) return ctx.res;
  try {
    return NextResponse.json({ data: await getRow(ctx.actor, pageId, blockId, rowId) });
  } catch (err) {
    return docsV1Error(err);
  }
}

const patchSchema = z.object({
  title: z.string().max(2000).optional(),
  properties: z.record(z.union([z.string().max(20_000), z.number(), z.boolean(), z.array(z.string().max(500)).max(100), z.null()])).optional(),
  /** Reemplaza el cuerpo de la fila. */
  markdown: z.string().max(200_000).optional(),
  /** Agrega al final del cuerpo. */
  appendMarkdown: z.string().max(200_000).optional(),
});

/** PATCH /api/v1/docs/databases/:pageId/:blockId/rows/:rowId — cambia propiedades, título o cuerpo. */
export async function PATCH(req: Request, props: Params) {
  const { pageId, blockId, rowId } = await props.params;
  const ctx = await docsApi(req, 'docs:write');
  if ('res' in ctx) return ctx.res;
  const parsed = patchSchema.safeParse(await v1Body(req));
  if (!parsed.success) return apiError(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'Invalid request body.');
  try {
    const row = await updateRow(ctx.actor, pageId, blockId, rowId, {
      title: parsed.data.title,
      values: parsed.data.properties,
      markdown: parsed.data.markdown,
      appendMarkdown: parsed.data.appendMarkdown,
    });
    return NextResponse.json({ data: row });
  } catch (err) {
    return docsV1Error(err);
  }
}

/** DELETE /api/v1/docs/databases/:pageId/:blockId/rows/:rowId — borra la fila (queda en el historial de la página). */
export async function DELETE(req: Request, props: Params) {
  const { pageId, blockId, rowId } = await props.params;
  const ctx = await docsApi(req, 'docs:write');
  if ('res' in ctx) return ctx.res;
  try {
    await deleteRow(ctx.actor, pageId, blockId, rowId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return docsV1Error(err);
  }
}

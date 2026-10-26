import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api-auth';
import { docsBlockSchema } from '@/lib/docs-schema';
import { getPage, updatePage } from '@/lib/docs-platform';
import { docsApi, docsV1Error, v1Body } from '@/lib/docs-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/docs/pages/:id?format=blocks — la página con su contenido en Markdown (y en bloques con format=blocks). */
export async function GET(req: Request, props: Params) {
  const { id } = await props.params;
  const ctx = await docsApi(req, 'docs:read');
  if ('res' in ctx) return ctx.res;
  try {
    return NextResponse.json({ data: await getPage(ctx.actor, id, { blocks: new URL(req.url).searchParams.get('format') === 'blocks' }) });
  } catch (err) {
    return docsV1Error(err);
  }
}

const patchSchema = z.object({
  title: z.string().max(300).optional(),
  icon: z.string().max(16).nullish(),
  /** Reemplaza el contenido (las bases de la página se conservan). */
  markdown: z.string().max(400_000).optional(),
  blocks: z.array(docsBlockSchema).max(1000).optional(),
  archived: z.boolean().optional(),
});

/** PATCH /api/v1/docs/pages/:id — título, ícono, contenido o papelera. */
export async function PATCH(req: Request, props: Params) {
  const { id } = await props.params;
  const ctx = await docsApi(req, 'docs:write');
  if ('res' in ctx) return ctx.res;
  const parsed = patchSchema.safeParse(await v1Body(req));
  if (!parsed.success) return apiError(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'Invalid request body.');
  try {
    const { icon, ...rest } = parsed.data;
    return NextResponse.json({ data: await updatePage(ctx.actor, id, { ...rest, ...(icon !== undefined ? { icon } : {}), blocks: rest.blocks as never }) });
  } catch (err) {
    return docsV1Error(err);
  }
}

/** DELETE /api/v1/docs/pages/:id — manda la página (y sus subpáginas) a la papelera; se restaura con archived: false. */
export async function DELETE(req: Request, props: Params) {
  const { id } = await props.params;
  const ctx = await docsApi(req, 'docs:write');
  if ('res' in ctx) return ctx.res;
  try {
    await updatePage(ctx.actor, id, { archived: true });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return docsV1Error(err);
  }
}

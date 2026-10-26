import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api-auth';
import { docsBlockSchema } from '@/lib/docs-schema';
import { getBlocks, updatePage } from '@/lib/docs-platform';
import { docsApi, docsV1Error, v1Body } from '@/lib/docs-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/docs/pages/:id/blocks — los bloques de la página (forma de Docs). */
export async function GET(req: Request, props: Params) {
  const { id } = await props.params;
  const ctx = await docsApi(req, 'docs:read');
  if ('res' in ctx) return ctx.res;
  try {
    return NextResponse.json({ data: await getBlocks(ctx.actor, id) });
  } catch (err) {
    return docsV1Error(err);
  }
}

const appendSchema = z.object({
  markdown: z.string().max(400_000).optional(),
  blocks: z.array(docsBlockSchema).max(1000).optional(),
  /** Inserta debajo de este bloque (sin él, al final). */
  after: z.string().max(100).nullish(),
});

/** POST /api/v1/docs/pages/:id/blocks — agrega bloques (o Markdown) al final o debajo de `after`. */
export async function POST(req: Request, props: Params) {
  const { id } = await props.params;
  const ctx = await docsApi(req, 'docs:write');
  if ('res' in ctx) return ctx.res;
  const parsed = appendSchema.safeParse(await v1Body(req));
  if (!parsed.success) return apiError(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'Invalid request body.');
  if (!parsed.data.markdown?.trim() && !parsed.data.blocks?.length) return apiError(400, 'invalid_input', 'Send markdown or blocks.');
  try {
    const page = await updatePage(ctx.actor, id, {
      appendMarkdown: parsed.data.markdown,
      appendBlocks: parsed.data.blocks as never,
      afterBlockId: parsed.data.after ?? null,
    });
    return NextResponse.json({ data: page }, { status: 201 });
  } catch (err) {
    return docsV1Error(err);
  }
}

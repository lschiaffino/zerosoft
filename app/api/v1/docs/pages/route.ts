import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api-auth';
import { docsBlockSchema } from '@/lib/docs-schema';
import { createPage, listPages } from '@/lib/docs-platform';
import { docsApi, docsV1Error, pageParams, v1Body } from '@/lib/docs-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/docs/pages?q=&parent=&limit=&offset= — páginas que la key puede leer (parent=root: solo las de arriba). */
export async function GET(req: Request) {
  const ctx = await docsApi(req, 'docs:read');
  if ('res' in ctx) return ctx.res;
  const p = new URL(req.url).searchParams;
  const parent = p.get('parent');
  const { limit, offset } = pageParams(req.url);
  const res = await listPages(ctx.actor, { q: p.get('q') ?? '', parentId: parent === null ? undefined : parent === 'root' ? null : parent, limit, offset });
  return NextResponse.json({ data: res.pages, hasMore: res.hasMore });
}

const createSchema = z.object({
  title: z.string().max(300).optional(),
  parentId: z.string().max(100).nullish(),
  icon: z.string().max(16).nullish(),
  markdown: z.string().max(400_000).optional(),
  blocks: z.array(docsBlockSchema).max(1000).optional(),
  templateId: z.string().max(100).nullish(),
  vars: z.record(z.string().max(5000)).optional(),
});

/** POST /api/v1/docs/pages — crea una página (Markdown o bloques, plantilla, subpágina). */
export async function POST(req: Request) {
  const ctx = await docsApi(req, 'docs:write');
  if ('res' in ctx) return ctx.res;
  const parsed = createSchema.safeParse(await v1Body(req));
  if (!parsed.success) return apiError(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'Invalid request body.');
  try {
    const page = await createPage(ctx.actor, { ...parsed.data, blocks: parsed.data.blocks as never });
    return NextResponse.json({ data: page }, { status: 201 });
  } catch (err) {
    return docsV1Error(err);
  }
}

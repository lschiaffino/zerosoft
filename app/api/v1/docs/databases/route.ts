import { NextResponse } from 'next/server';
import { listDatabases } from '@/lib/docs-platform';
import { docsApi } from '@/lib/docs-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/docs/databases?q= — bases de las páginas que la key puede leer, con su esquema. */
export async function GET(req: Request) {
  const ctx = await docsApi(req, 'docs:read');
  if ('res' in ctx) return ctx.res;
  const q = (new URL(req.url).searchParams.get('q') ?? '').slice(0, 200);
  return NextResponse.json({ data: await listDatabases(ctx.actor, q) });
}

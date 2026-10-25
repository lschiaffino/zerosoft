import { NextResponse } from 'next/server';
import { searchPages } from '@/lib/docs-platform';
import { docsApi } from '@/lib/docs-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/docs/search?q=&limit= — páginas y filas por título y contenido, con fragmento. */
export async function GET(req: Request) {
  const ctx = await docsApi(req, 'docs:read');
  if ('res' in ctx) return ctx.res;
  const p = new URL(req.url).searchParams;
  const limit = Math.min(50, Math.max(1, Number(p.get('limit')) || 20));
  return NextResponse.json({ data: await searchPages(ctx.actor, p.get('q') ?? '', limit) });
}

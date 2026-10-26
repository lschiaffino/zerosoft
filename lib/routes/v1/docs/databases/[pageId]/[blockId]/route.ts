import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/docs-platform';
import { docsApi, docsV1Error } from '@/lib/docs-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/docs/databases/:pageId/:blockId — esquema de una base (propiedades, opciones, origen si es sincronizada). */
export async function GET(req: Request, props: { params: Promise<{ pageId: string; blockId: string }> }) {
  const { pageId, blockId } = await props.params;
  const ctx = await docsApi(req, 'docs:read');
  if ('res' in ctx) return ctx.res;
  try {
    return NextResponse.json({ data: await getDatabase(ctx.actor, pageId, blockId) });
  } catch (err) {
    return docsV1Error(err);
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { getDocAccess, getDocPageRow, parseBlocks } from '@/lib/docs';
import { normalizeDatabase } from '@/lib/docs-database';
import { claimSource, DocsSyncError, getSource, runSync, toDto, unlinkSource, updateSource } from '@/lib/docs-sync';
import { docsError, forbidden, invalidBody, notFound, unauthorized } from '@/lib/docs-http';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

/** Origen + acceso a su página (ver para leer el estado; editar para cambiarlo). */
async function load(id: string, write: boolean) {
  const user = await getCurrentUser();
  if (!user) return { res: unauthorized() } as const;
  const source = await getSource(id);
  const page = source ? await getDocPageRow(source.page_id) : null;
  const access = page ? await getDocAccess(page, user, { includePublished: false, includePublicLink: false }) : null;
  if (!source || !page || !access) return { res: notFound() } as const;
  if (write && access === 'view') return { res: forbidden() } as const;
  return { source, page } as const;
}

async function currentDb(pageId: string, blockId: string) {
  const page = await getDocPageRow(pageId);
  const block = page ? parseBlocks(page.content).find((b) => b.id === blockId && b.type === 'database') : null;
  return block ? normalizeDatabase(block) : null;
}

export async function GET(_req: NextRequest, props: Params) {
  const { id } = await props.params;
  const ctx = await load(id, false);
  if ('res' in ctx) return ctx.res;
  return NextResponse.json({ source: toDto(ctx.source) });
}

/** "Sincronizar ahora": corre al momento (reclamando el origen) y devuelve la base nueva. */
export async function POST(_req: NextRequest, props: Params) {
  const { id } = await props.params;
  const ctx = await load(id, true);
  if ('res' in ctx) return ctx.res;
  const limited = await rateLimit(`docs-sync-now:${id}`, 6, 60);
  if (!limited.ok) return docsError(429, 'rate_limited');
  if (!(await claimSource(id, new Date(), true))) return docsError(409, 'sync_running');
  const source = await runSync(id);
  if (!source) return notFound();
  return NextResponse.json({ source, db: await currentDb(source.pageId, source.blockId) });
}

const patchSchema = z.object({
  config: z.record(z.unknown()).optional(),
  secret: z.record(z.unknown()).optional(),
  intervalMin: z.number().int().optional(),
});

export async function PATCH(req: NextRequest, props: Params) {
  const { id } = await props.params;
  const ctx = await load(id, true);
  if ('res' in ctx) return ctx.res;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    return NextResponse.json({ source: await updateSource(id, parsed.data) });
  } catch (err) {
    if (err instanceof DocsSyncError) return docsError(err.status, err.code);
    throw err;
  }
}

/** Desvincula: la base queda como una base común con las filas que tenía. */
export async function DELETE(_req: NextRequest, props: Params) {
  const { id } = await props.params;
  const ctx = await load(id, true);
  if ('res' in ctx) return ctx.res;
  await unlinkSource(id);
  return NextResponse.json({ ok: true, db: await currentDb(ctx.source.page_id, ctx.source.block_id) });
}

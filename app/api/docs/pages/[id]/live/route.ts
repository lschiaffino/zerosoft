import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { DOC_INTERNAL_READ, getDocAccess, getDocPageRow, toDocPage } from '@/lib/docs';
import { stripFileUrls } from '@/lib/docs-files';
import { editorBlocks } from '@/lib/docs-guard';
import { SESSION_RE, commentsSignature, leavePresence, listPeers, touchPresence } from '@/lib/docs-live';
import { invalidBody, notFound, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  session: z.string().regex(SESSION_RE),
  block_id: z.string().max(64).nullish(),
  start: z.number().int().min(0).max(1_000_000).nullish(),
  end: z.number().int().min(0).max(1_000_000).nullish(),
  mode: z.enum(['edit', 'suggest', 'comment', 'view']).optional(),
  /** updated_at que tiene el editor: si la página cambió, viene la versión nueva. */
  since: z.string().max(64).nullish(),
  leave: z.boolean().optional(),
});

/**
 * Pulso de presencia y cambios (ver lib/docs-live.ts). Cualquiera que pueda
 * abrir la página aparece como presente; el contenido nuevo viaja igual que
 * al cargar la página (sin URLs del storage para quien solo lee).
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  // sendBeacon manda text/plain: se parsea a mano.
  const raw = await req.text().catch(() => '');
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return invalidBody(parsed.error);
  const row = await getDocPageRow(id);
  // Quien solo llega porque la página está publicada no ve quién más está ni sus cursores.
  const access = row ? await getDocAccess(row, user, DOC_INTERNAL_READ) : null;
  if (!row || !access) return notFound();
  const me = realUserId(user);
  const body = parsed.data;
  if (body.leave) {
    await leavePresence(id, body.session, me);
    return new NextResponse(null, { status: 204 });
  }
  await touchPresence({
    pageId: id,
    session: body.session,
    userId: me,
    blockId: body.block_id ?? null,
    start: body.start ?? null,
    end: body.end ?? null,
    mode: body.mode ?? (access === 'view' ? 'view' : 'edit'),
  });
  const [peers, comments] = await Promise.all([listPeers(id, body.session), commentsSignature(id)]);
  let page = null;
  if (body.since && body.since !== row.updated_at) {
    const p = toDocPage(row);
    p.content = await editorBlocks(row, user);
    if (access === 'view') p.content = stripFileUrls(p.content);
    page = p;
  }
  return NextResponse.json({
    updated_at: row.updated_at,
    locked: row.locked === 1,
    access,
    peers,
    comments,
    page,
  });
}

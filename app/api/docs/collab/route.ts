import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId, type SessionUser } from '@/lib/session';
import { DOC_INTERNAL_READ, getDocAccess, getDocPageRow, resolveDocAccess } from '@/lib/docs';
import { canWriteAccess } from '@/lib/docs-access';
import { SESSION_RE, leavePresence, touchPresence } from '@/lib/docs-live';
import {
  CoeditAccessError,
  MAX_ITEMS,
  applyTextOps,
  blockSnapshots,
  coeditCursor,
  coeditLeave,
  coeditPoll,
  coeditStream,
  type CoeditViewer,
} from '@/lib/docs-coedit';
import { isTextOp } from '@/lib/docs-ot';
import { requestCursor } from '@/lib/realtime';
import { docsError, forbidden, invalidBody, notFound, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Fluid: el stream queda abierto unos minutos y el navegador se reconecta solo.
export const maxDuration = 300;

/**
 * Edición simultánea de una página de Docs (lib/docs-coedit.ts). Ruta
 * estática (?page=): no suma al presupuesto de rutas dinámicas.
 * - GET ?page=<id>: stream SSE de la página (operaciones, cursores, guardados, acceso).
 * - GET ?page=<id>&poll=1&cursor=<n>: lo mismo por polling (fallback).
 * - GET ?page=<id>&blocks=a,b: texto y versión actuales de esos bloques.
 * - POST: operaciones de texto, cursor o salida de la sesión.
 */

const pageIdSchema = z.string().min(1).max(64);

function viewerOf(user: SessionUser): CoeditViewer {
  return { ownerId: user.id, realId: realUserId(user), actor: { id: user.id, actingUser: user.actingUser, team: user.team, role: user.role } };
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const params = new URL(req.url).searchParams;
  const pageId = pageIdSchema.safeParse(params.get('page'));
  if (!pageId.success) return notFound();
  const res = await resolveDocAccess(user, pageId.data, DOC_INTERNAL_READ);
  const blocks = params.get('blocks');
  if (blocks !== null) {
    if (!res) return notFound();
    const ids = blocks.split(',').filter((x) => x && x.length <= 64).slice(0, MAX_ITEMS);
    return NextResponse.json({ blocks: await blockSnapshots(res.row, ids) });
  }
  if (params.get('poll') === '1') {
    // Sin acceso: el editor corta igual que con el stream.
    if (!res) return NextResponse.json({ events: [{ kind: 'revoked' }], cursor: requestCursor(req) });
    return NextResponse.json(await coeditPoll(viewerOf(user), pageId.data, res.access, requestCursor(req)));
  }
  if (!res) return notFound();
  return coeditStream(viewerOf(user), pageId.data, res.access, requestCursor(req), req.signal);
}

const opItemSchema = z.object({
  block: z.string().min(1).max(64),
  rev: z.number().int().min(0).nullable(),
  hash: z.string().min(1).max(40),
  op: z.array(z.union([z.number().int(), z.string().max(200_000)])).max(5000),
  seq: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
  base: z.string().max(400_000).optional(),
});

const bodySchema = z.object({
  page: pageIdSchema,
  session: z.string().regex(SESSION_RE),
  items: z.array(opItemSchema).max(MAX_ITEMS).optional(),
  cursor: z
    .object({
      block: z.string().max(64).nullable(),
      start: z.number().int().min(0).max(1_000_000).nullable(),
      end: z.number().int().min(0).max(1_000_000).nullable(),
      mode: z.enum(['edit', 'suggest', 'comment', 'view']),
    })
    .optional(),
  leave: z.boolean().optional(),
  /** "Desbloquear solo para mí" (como en el guardado). */
  bypass_lock: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  // sendBeacon (al salir) manda text/plain: se parsea a mano.
  let json: unknown = null;
  try {
    json = JSON.parse(await req.text());
  } catch {
    json = null;
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return invalidBody(parsed.error);
  const body = parsed.data;
  const row = await getDocPageRow(body.page);
  const internal = row ? await getDocAccess(row, user, DOC_INTERNAL_READ) : null;
  if (!row || !internal) return notFound();
  const me = realUserId(user);

  if (body.leave) {
    await leavePresence(row.id, body.session, me);
    await coeditLeave(row, body.session, me).catch(() => undefined);
    return new NextResponse(null, { status: 204 });
  }

  let results = undefined;
  if (body.items?.length) {
    // Escribir: los mismos permisos que el guardado de la página.
    const access = await getDocAccess(row, user);
    if (!canWriteAccess(access)) return forbidden();
    if (row.locked === 1 && !body.bypass_lock) return docsError(423, 'locked');
    if (body.items.some((i) => !isTextOp(i.op))) return docsError(400, 'invalid_input');
    try {
      results = await applyTextOps({ pageId: row.id, actorId: me, session: body.session, items: body.items });
    } catch (err) {
      if (err instanceof CoeditAccessError) return notFound();
      if (err instanceof Error && err.message === 'coedit_busy') return docsError(503, 'busy');
      throw err;
    }
  }

  if (body.cursor) {
    const person = user.actingUser ?? user;
    await touchPresence({ pageId: row.id, session: body.session, userId: me, blockId: body.cursor.block, start: body.cursor.start, end: body.cursor.end, mode: body.cursor.mode });
    await coeditCursor({
      page: row,
      session: body.session,
      userId: me,
      name: person.name?.trim() || person.email.split('@')[0],
      image: person.image ?? null,
      block: body.cursor.block,
      start: body.cursor.start,
      end: body.cursor.end,
      mode: body.cursor.mode,
    }).catch(() => undefined);
  }
  return NextResponse.json({ results: results ?? [] });
}

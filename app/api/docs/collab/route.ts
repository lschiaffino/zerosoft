import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId, type SessionUser } from '@/lib/session';
import type { DocsPageRow } from '@/lib/db';
import { DOC_INTERNAL_READ, getDocAccess, getDocPageRow, resolveDocAccess } from '@/lib/docs';
import { canWriteAccess, coeditEnabled } from '@/lib/docs-access';
import { SESSION_RE, leavePresence, sessionLeft, touchPresence } from '@/lib/docs-live';
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
import { DOCS_BLOCK_MAX } from '@/lib/docs-schema';
import { rateLimit } from '@/lib/rate-limit';
import { requestCursor } from '@/lib/realtime';
import { getUserTimeZone } from '@/lib/user-tz';
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
/** Un pedido entero (operaciones de hasta 50 bloques, cada una de un bloque como máximo). */
const MAX_BODY_BYTES = 600_000;
const OPS_PER_MINUTE = 900;

function viewerOf(user: SessionUser, pageWorkspace: string): CoeditViewer {
  return { ownerId: user.id, realId: realUserId(user), actor: { id: user.id, actingUser: user.actingUser, team: user.team, role: user.role }, pageWorkspace };
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
    return NextResponse.json(await coeditPoll(viewerOf(user, res.row.user_id), pageId.data, res.access, requestCursor(req)));
  }
  if (!res) return notFound();
  return coeditStream(viewerOf(user, res.row.user_id), pageId.data, res.access, requestCursor(req), req.signal);
}

const opItemSchema = z.object({
  block: z.string().min(1).max(64),
  rev: z.number().int().min(0).nullable(),
  hash: z.string().min(1).max(40),
  op: z.array(z.union([z.number().int(), z.string().max(DOCS_BLOCK_MAX)])).max(5000),
  seq: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
  base: z.string().max(DOCS_BLOCK_MAX).optional(),
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

const AFTER_SAVE_EVERY_MS = 15_000;
const afterSaveState = new Map<string, { last: number; before: DocsPageRow | null; waiting: boolean }>();

/**
 * Los efectos de un guardado para las tandas de teclas: el primero sale ya y
 * los siguientes se juntan en uno cada AFTER_SAVE_EVERY_MS (con la página de
 * antes de la primera tanda del grupo). El último siempre corre: se espera
 * dentro de after().
 */
async function throttledAfterSave(pageId: string, before: DocsPageRow, run: (first: DocsPageRow) => Promise<void>): Promise<void> {
  let st = afterSaveState.get(pageId);
  if (!st) {
    if (afterSaveState.size > 2000) afterSaveState.clear();
    st = { last: 0, before: null, waiting: false };
    afterSaveState.set(pageId, st);
  }
  st.before ??= before;
  const wait = st.last + AFTER_SAVE_EVERY_MS - Date.now();
  if (wait > 0) {
    if (st.waiting) return;
    st.waiting = true;
    await new Promise((r) => setTimeout(r, wait));
    st.waiting = false;
  }
  const first = st.before;
  st.before = null;
  st.last = Date.now();
  if (first) await run(first).catch(() => undefined);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  // sendBeacon (al salir) manda text/plain: se parsea a mano.
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return docsError(413, 'too_large');
  let json: unknown = null;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return docsError(413, 'too_large');
    json = JSON.parse(raw);
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
    await coeditLeave(row, body.session, me).catch(() => undefined);
    await leavePresence(row.id, body.session, me);
    return new NextResponse(null, { status: 204 });
  }

  let results = undefined;
  if (body.items?.length) {
    // Apagada para este workspace (o en la instancia): el editor guarda y fusiona como antes.
    if (!(await coeditEnabled(row.user_id))) return docsError(409, 'coedit_off');
    // Escribir: los mismos permisos que el guardado de la página.
    const access = await getDocAccess(row, user);
    if (!canWriteAccess(access)) return forbidden();
    if (row.locked === 1 && !body.bypass_lock) return docsError(423, 'locked');
    if (body.items.some((i) => !isTextOp(i.op))) return docsError(400, 'invalid_input');
    // Tecla por tecla son unas 8 por segundo; esto corta un abuso sin frenar a quien escribe.
    if (process.env.RATE_LIMIT_DISABLED !== 'true' && !(await rateLimit(`docs-coedit:${me}:${row.id}`, OPS_PER_MINUTE, 60)).ok) return docsError(429, 'rate_limited');
    try {
      const locale = req.cookies.get('NEXT_LOCALE')?.value;
      const timezone = await getUserTimeZone().catch(() => undefined);
      results = await applyTextOps({
        pageId: row.id,
        actorId: me,
        session: body.session,
        items: body.items,
        // Lo mismo que después de un guardado (versión automática, recordatorios de fechas y
        // page.updated), pero como mucho una vez cada 15 s por página: no en cada tanda de teclas.
        onSaved: (before, blocks) =>
          after(async () => {
            // Un recordatorio de fecha que se escribe o se borra: al instante (no espera al grupo).
            if (before.content.includes('data-remind') || blocks.some((b) => typeof b.content === 'string' && b.content.includes('data-remind'))) {
              const { syncDocReminders } = await import('@/lib/docs-reminders');
              await syncDocReminders({
                pageId: row.id,
                workspaceId: row.user_id,
                actorId: me,
                blocks,
                locale: locale === 'es' || locale === 'pt' || locale === 'en' ? locale : undefined,
                timezone,
              }).catch(() => undefined);
            }
            await throttledAfterSave(row.id, before, async (first) => {
              const [{ maybeAutoSnapshot }, { afterDocsPageSaved }, { syncDocReminders }, { parseBlocks }] = await Promise.all([
                import('@/lib/docs-versions'),
                import('@/lib/docs-events'),
                import('@/lib/docs-reminders'),
                import('@/lib/docs'),
              ]);
              await maybeAutoSnapshot(row.user_id, row.id, me, first).catch(() => undefined);
              const updated = await getDocPageRow(row.id);
              if (!updated) return;
              await afterDocsPageSaved({ ws: row.user_id, before: first, after: updated, actorId: me, titleOrContent: true });
              await syncDocReminders({
                pageId: row.id,
                workspaceId: row.user_id,
                actorId: me,
                blocks: parseBlocks(updated.content),
                locale: locale === 'es' || locale === 'pt' || locale === 'en' ? locale : undefined,
                timezone,
              }).catch(() => undefined);
            });
          }),
      });
    } catch (err) {
      if (err instanceof CoeditAccessError) return notFound();
      if (err instanceof Error && err.message === 'coedit_busy') return docsError(503, 'busy');
      throw err;
    }
  }

  if (body.cursor && !(await sessionLeft(row.id, body.session))) {
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

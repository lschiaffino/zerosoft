import { after, NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import {
  DocsConflictError,
  cleanContent,
  decorateShares,
  deleteDocPage,
  parseBlocks,
  getDocAccess,
  getDocPageRow,
  listEffectiveDocShares,
  toDocPage,
  updateDocPage,
} from '@/lib/docs';
import { stripFileUrls } from '@/lib/docs-files';
import { SHARED_EDITABLE_FIELDS, docPageUpdateSchema } from '@/lib/docs-schema';
import { maybeAutoSnapshot } from '@/lib/docs-versions';
import { getRevision } from '@/lib/docs-revisions';
import { runDbEffects } from '@/lib/docs-db-server';
import type { DbEffect } from '@/lib/docs-db-save';
import { notFound, unauthorized, invalidBody, forbidden, docsError } from '@/lib/docs-http';
import { getUserTimeZone } from '@/lib/user-tz';
import { canShareAccess, canWriteAccess } from '@/lib/docs-access';
import { docsAllowed, editorBlocks, lockedSyncedIds } from '@/lib/docs-guard';
import { checkMarksOnlyChange, newSuggestionIds } from '@/lib/docs-marks';
import { auditTargetLabel, logDocsAudit, requestIp, type DocsAuditAction } from '@/lib/docs-audit';
import { notifyDocsSuggestions } from '@/lib/docs-live';
import { listPageInvites } from '@/lib/docs-guests';
import type { DocsPageRow } from '@/lib/db';
import type { SessionUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** La página como la ve el editor (base de la fusión en vivo). */
async function editorPage(row: DocsPageRow, user: SessionUser, access: string) {
  const page = toDocPage(row);
  page.content = await editorBlocks(row, user);
  // Solo lectura: la URL del storage de imágenes/archivos no viaja (se sirven por /api/docs/files).
  if (access === 'view') page.content = stripFileUrls(page.content);
  return page;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const row = await getDocPageRow(params.id);
  const access = row ? await getDocAccess(row, user) : null;
  if (!row || !access) return notFound();
  // Los shares (quién tiene acceso, propios y heredados) solo los ve quien puede compartir.
  const shares = canShareAccess(access) ? await decorateShares(row.user_id, await listEffectiveDocShares(row)) : [];
  const invites = canShareAccess(access) ? await listPageInvites(row.id) : [];
  return NextResponse.json({ ...(await editorPage(row, user, access)), access, shares, invites });
}

/** Campos que cambian la página pero no su contenido (los bloquea el lock igual que el contenido). */
const CONTENT_FIELDS = ['title', 'icon', 'cover_url', 'cover_position', 'content'] as const;

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = docPageUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const row = await getDocPageRow(params.id);
  const access = row ? await getDocAccess(row, user) : null;
  if (!row || !access) return notFound();
  if (access === 'view') return forbidden();

  const { locale: bodyLocale, timezone: bodyTimezone, bypass_lock: bypassLock, ...patch } = parsed.data;
  // El editor manda título, ícono y portada con cada guardado: si no cambiaron
  // no cuentan (quien solo comenta, o una página bloqueada, no los toca).
  if (patch.title !== undefined && patch.title.trim() === row.title) delete patch.title;
  if (patch.icon !== undefined && (patch.icon ?? null) === (row.icon ?? null)) delete patch.icon;
  if (patch.cover_url !== undefined && (patch.cover_url || null) === (row.cover_url || null)) delete patch.cover_url;
  if (patch.cover_position !== undefined && row.cover_position != null && Math.round(patch.cover_position) === Math.round(row.cover_position)) delete patch.cover_position;
  // Sin idioma/zona en el body (cliente viejo, API): la cookie de idioma y la
  // de zona horaria del navegador, antes que caer en inglés y UTC.
  const cookieLocale = req.cookies.get('NEXT_LOCALE')?.value;
  const locale = bodyLocale ?? (cookieLocale === 'es' || cookieLocale === 'pt' || cookieLocale === 'en' ? cookieLocale : undefined);
  const timezone = bodyTimezone ?? (patch.content ? await getUserTimeZone() : undefined);
  const keys = Object.keys(patch);
  const actorId = realUserId(user);

  if (access !== 'owner') {
    // Un invitado o un miembro con edición cambia el contenido y puede
    // bloquear; nunca la publicación, la IA, el árbol ni la papelera.
    const allowed = new Set<string>(access === 'comment' ? ['content', 'base_updated_at'] : [...SHARED_EDITABLE_FIELDS, 'locked']);
    if (keys.some((k) => !allowed.has(k))) return forbidden();
  }
  // Publicar desactivado por un admin en Ajustes › Seguridad.
  if (patch.published === true && !(await docsAllowed(user, row.user_id, 'allow_publish'))) {
    return docsError(403, 'publish_disabled');
  }
  // Rol de los miembros y dueño de la wiki: solo admins o acceso total.
  if ((patch.member_role !== undefined || patch.page_owner_id !== undefined) && access !== 'owner') return forbidden();

  // Bloqueada o "puede comentar": el contenido solo cambia en resaltados de
  // comentarios (y, comentando sin bloqueo, en las sugerencias propias).
  // "Desbloquear solo para mí": quien puede editar sigue editando; el bloqueo queda para el resto.
  const locked = row.locked === 1 && patch.locked !== false && !(bypassLock && canWriteAccess(access));
  const marksOnly = access === 'comment' || locked;
  if (marksOnly) {
    if (CONTENT_FIELDS.some((k) => k !== 'content' && k in patch)) return docsError(423, 'locked');
    if (patch.content !== undefined) {
      // Contra la versión sobre la que se editó (si otra persona guardó en el
      // medio, lo suyo no cuenta como cambio de quien comenta; se fusiona después).
      const rev = patch.base_updated_at && patch.base_updated_at !== row.updated_at ? await getRevision(row.id, patch.base_updated_at) : null;
      const prev = await editorBlocks(row, user, rev ? parseBlocks(rev.content) : undefined);
      const next = cleanContent(patch.content);
      const why = checkMarksOnlyChange(prev, next, actorId, !locked);
      if (why) return docsError(locked ? 423 : 403, locked ? 'locked' : why);
    }
  }
  if (patch.locked !== undefined && !canWriteAccess(access)) return forbidden();
  // Mover adentro de otra página: también hay que poder editar el destino.
  if (patch.parent_id && patch.parent_id !== row.parent_id) {
    const target = await getDocPageRow(patch.parent_id);
    const targetAccess = target && target.user_id === row.user_id ? await getDocAccess(target, user, { includePublished: false, includePublicLink: false }) : null;
    if (!targetAccess || !canWriteAccess(targetAccess)) return notFound();
  }

  let page;
  // Automatizaciones de las bases que disparó este guardado (corren después de responder).
  const effects: DbEffect[] = [];
  const outcome: { merged?: boolean; staleBase?: boolean } = {};
  try {
    // Sincronizados de páginas que esta persona no puede abrir: llegan sin hijos y no se tocan.
    const lockedSynced = patch.content !== undefined ? await lockedSyncedIds(user, row, patch.content) : undefined;
    page = await updateDocPage(row.user_id, params.id, patch, { actorId, locale, timezone, effects, outcome, lockedSynced });
  } catch (err) {
    // Otra persona guardó (o se restauró una versión) desde que el editor
    // cargó la página: se devuelve la versión actual para fusionar en el
    // navegador y reintentar, sin pisar nada.
    if (err instanceof DocsConflictError) {
      const fresh = await getDocPageRow(params.id);
      const current = fresh ? await editorPage(fresh, user, access) : null;
      return NextResponse.json({ error: 'conflict', current }, { status: 409 });
    }
    throw err;
  }
  if (!page) return notFound();
  if (effects.length) {
    const actor = { ...user, realId: realUserId(user) };
    after(() => runDbEffects(effects, actor).catch(() => {}));
  }
  // Sin cambios (autosave con lo mismo) no hay versión nueva.
  if ((patch.content !== undefined || patch.title !== undefined) && page.updated_at !== row.updated_at) {
    await maybeAutoSnapshot(row.user_id, params.id, actorId, row).catch(() => {});
  }

  // Sugerencias nuevas: aviso al dueño de la página (como Notion).
  if (patch.content !== undefined) {
    const fresh = await getDocPageRow(params.id);
    if (fresh) {
      const ids = newSuggestionIds(JSON.parse(row.content || '[]'), JSON.parse(fresh.content || '[]'));
      if (ids.length) await notifyDocsSuggestions(fresh, user, ids.length).catch(() => {});
    }
  }

  // Auditoría de lo que cambia permisos o visibilidad.
  const audits: Array<[DocsAuditAction, string?]> = [];
  if (patch.published !== undefined && (row.published === 1) !== patch.published) audits.push([patch.published ? 'page.published' : 'page.unpublished']);
  if (patch.archived !== undefined && (row.archived === 1) !== patch.archived) audits.push([patch.archived ? 'page.trashed' : 'page.restored']);
  if (patch.locked !== undefined && (row.locked === 1) !== patch.locked) audits.push([patch.locked ? 'page.locked' : 'page.unlocked']);
  if (patch.member_role !== undefined && (row.member_role ?? null) !== patch.member_role) audits.push(['page.member_role', patch.member_role ?? 'inherit']);
  if (patch.parent_id !== undefined && patch.parent_id !== row.parent_id) audits.push(['page.moved', patch.parent_id ?? 'root']);
  if (patch.page_owner_id !== undefined && patch.page_owner_id !== (row.page_owner_id ?? null)) audits.push(['page.owner', patch.page_owner_id ?? '']);
  const ip = requestIp(req.headers);
  const actor = user.actingUser ?? user;
  // Dueño de la wiki: el nombre, no el id.
  for (const a of audits) if (a[0] === 'page.owner' && a[1]) a[1] = await auditTargetLabel('user', a[1]);
  for (const [action, detail] of audits) {
    await logDocsAudit({ workspaceId: row.user_id, actor, action, page: { id: row.id, title: page.title }, detail, ip });
  }

  // El editor recibe el contenido procesado igual que al cargar (base de la
  // fusión) y si se fusionó con lo que había guardado (otra persona, una
  // automatización): en ese caso suma a lo suyo lo que trae `content`.
  const updated = await getDocPageRow(params.id);
  const flags = { merged: outcome.merged === true, stale_base: outcome.staleBase === true };
  return NextResponse.json({ ...(updated ? await editorPage(updated, user, access) : page), ...flags });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  // Borrar para siempre (subárbol, versiones y comentarios) es irreversible:
  // solo admins, como en Track y Chat. Un member puede mandar a la papelera.
  if (!isWorkspaceAdmin(user)) return forbidden();
  const row = await getDocPageRow(params.id);
  if (!row || row.user_id !== user.id) return notFound();
  // Una página de un teamspace privado del que el admin no es miembro tampoco se toca.
  if ((await getDocAccess(row, user)) !== 'owner') return notFound();
  if (!(await deleteDocPage(user.id, params.id))) return notFound();
  await logDocsAudit({
    workspaceId: user.id,
    actor: user.actingUser ?? user,
    action: 'page.deleted',
    page: { id: row.id, title: row.title },
    ip: requestIp(req.headers),
  });
  return new NextResponse(null, { status: 204 });
}

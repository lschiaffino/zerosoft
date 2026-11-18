import { NextResponse } from 'next/server';
import { getChat, getChatRow, listMembers, type ChatPatch } from '@/lib/groups';
import { chatGuard, groupsError, groupsSession, handleGroupsError, readJson, strArr } from '@/lib/groups-http';
import { maskChat, maskMember } from '@/lib/groups-access';
import { patchChatAs, removeChatAs } from '@/lib/groups-chat-ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const guard = await chatGuard(s, id);
  if (guard instanceof NextResponse) return guard;
  const [chat, row] = await Promise.all([getChat(s.ws, id), getChatRow(s.ws, id)]);
  if (!chat || !row) return groupsError(404, 'not_found');
  const { withSameChatLines } = await import('@/lib/groups-same-chat');
  return NextResponse.json({ chat: maskChat(guard.viewer, await withSameChatLines(s.ws, guard.viewer, row, chat)), members: (await listMembers(s.ws, id)).map((m) => maskMember(guard.viewer, m)) });
}

/** Renombrar (también en WhatsApp si es grupo), asignar a persona o equipo, cerrar, fijar, etiquetas, propiedades, CRM, agente, leído o no leído, archivar y posponer. */
export async function PATCH(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const guard = await chatGuard(s, id);
  if (guard instanceof NextResponse) return guard;
  const b = await readJson(req);
  const patch: ChatPatch = {};
  if (typeof b.name === 'string') patch.name = b.name;
  if (typeof b.description === 'string') patch.description = b.description;
  if (b.assignedTo === null || typeof b.assignedTo === 'string') patch.assignedTo = (b.assignedTo as string | null) || null;
  if (b.assignedTeamId === null || typeof b.assignedTeamId === 'string') patch.assignedTeamId = (b.assignedTeamId as string | null) || null;
  if (typeof b.pinned === 'boolean') patch.pinned = b.pinned;
  if (b.status === 'open' || b.status === 'closed') patch.status = b.status;
  if (b.crmContactId === null || typeof b.crmContactId === 'string') patch.crmContactId = (b.crmContactId as string | null) || null;
  if (b.crmCompanyId === null || typeof b.crmCompanyId === 'string') patch.crmCompanyId = (b.crmCompanyId as string | null) || null;
  if (b.agentId === null || typeof b.agentId === 'string') patch.agentId = (b.agentId as string | null) || null;
  if (b.properties && typeof b.properties === 'object' && !Array.isArray(b.properties)) patch.properties = b.properties as Record<string, unknown>;
  if (Array.isArray(b.labelIds)) patch.labelIds = strArr(b.labelIds, 20);
  if (typeof b.read === 'boolean') patch.read = b.read;
  if (typeof b.flagged === 'boolean') patch.flagged = b.flagged;
  if (typeof b.muted === 'boolean') patch.muted = b.muted;
  if (typeof b.archived === 'boolean') patch.archived = b.archived;
  if (typeof b.keepArchived === 'boolean') patch.keepArchived = b.keepArchived;
  if (b.snoozedUntil === null || typeof b.snoozedUntil === 'string') patch.snoozedUntil = (b.snoozedUntil as string | null) || null;
  if (typeof b.hidden === 'boolean') patch.hidden = b.hidden;
  try {
    if (b.folderId === null || typeof b.folderId === 'string') {
      const { moveChatsToFolder } = await import('@/lib/groups-lines');
      await moveChatsToFolder(s.ws, guard.viewer, [id], (b.folderId as string | null) || null);
    }
    const after = await patchChatAs(s.ws, { id: s.me }, id, patch);
    // El mismo chat en otras líneas: leer, archivar, posponer, cerrar, silenciar o eliminar vale para todas.
    const { SAME_CHAT_PATCH_KEYS, withSameChatIds } = await import('@/lib/groups-same-chat');
    const shared: ChatPatch = {};
    for (const k of SAME_CHAT_PATCH_KEYS) if (patch[k] !== undefined) Object.assign(shared, { [k]: patch[k] });
    if (patch.read === true) shared.read = true;
    if (Object.keys(shared).length) {
      for (const other of (await withSameChatIds(s.ws, guard.viewer, [id])).filter((x) => x !== id)) {
        await patchChatAs(s.ws, { id: s.me }, other, shared).catch(() => null);
      }
    }
    return NextResponse.json(maskChat(guard.viewer, after));
  } catch (err) {
    return handleGroupsError(err);
  }
}

/**
 * { action: 'importOlder' }: trae del teléfono los mensajes anteriores a lo importado.
 * { action: 'loadOlder' }: "Cargar mensajes anteriores": lo que guardó el gateway y, si no hay más, el teléfono.
 * { action: 'fetchMissing' }: "Traer mensajes que faltan": le pide al teléfono lo anterior a los huecos y al último
 * mensaje (lib/wa-history-gaps.ts, refreshChatHistory); { action: 'fetchMissingStatus' } dice cómo va.
 * { action: 'fetchMissing', auto: true }: lo pide la pantalla al abrir un chat con la marca de mensajes que WhatsApp no
 * pudo entregar; responde 200 igual si no sale (topes, sin huecos).
 */
export async function POST(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const guard = await chatGuard(s, id);
  if (guard instanceof NextResponse) return guard;
  const b = (await req.json().catch(() => ({}))) as { action?: string; auto?: unknown };
  if (b.action === 'fetchMissing' && b.auto !== true) {
    // "Traer mensajes que faltan" a mano: anclas exactas alrededor de los huecos y antes del último mensaje.
    try {
      const { requestRefresh, refreshResponse } = await import('@/lib/wa-history-gaps');
      const out = await requestRefresh('lines', s.ws, id);
      if (!out) return groupsError(404, 'not_found');
      const r = refreshResponse(out);
      return NextResponse.json(r.body, { status: r.status });
    } catch (err) {
      return handleGroupsError(err);
    }
  }
  if (b.action === 'fetchMissingStatus') {
    // Cómo va el último "Traer mensajes que faltan" del chat (cuántos trajo, si el teléfono respondió).
    try {
      const { requestRefreshStatus } = await import('@/lib/wa-history-gaps');
      const st = await requestRefreshStatus('lines', s.ws, id);
      if (!st) return groupsError(404, 'not_found');
      return NextResponse.json(st);
    } catch (err) {
      return handleGroupsError(err);
    }
  }
  if (b.action === 'fetchMissing') {
    try {
      const { requestChatHistory, historyResponse } = await import('@/lib/wa-history-gaps');
      const out = await requestChatHistory('lines', s.ws, id, { auto: b.auto === true });
      if (!out) return groupsError(404, 'not_found');
      const r = historyResponse(out, b.auto === true);
      return NextResponse.json(r.body, { status: r.status });
    } catch (err) {
      return handleGroupsError(err);
    }
  }
  if (b.action === 'loadOlder') {
    // "Cargar mensajes anteriores": primero lo que guardó el gateway (la importación trae los últimos N); si no hay
    // más ahí, se le pide al teléfono (lib/wa-history-gaps.ts). Solo quien ve el chat (chatGuard, arriba).
    try {
      const { importOlder } = await import('@/lib/groups-import');
      const stored = await importOlder(s.ws, id).catch(() => ({ added: 0, done: true }));
      if (stored.added > 0) return NextResponse.json({ ok: true, delivered: stored.added, pending: false });
      const { requestOlderHistory, olderResponse } = await import('@/lib/wa-history-gaps');
      const out = await requestOlderHistory('lines', s.ws, id);
      if (!out) return groupsError(404, 'not_found');
      const r = olderResponse(out);
      return NextResponse.json(r.body, { status: r.status });
    } catch (err) {
      return handleGroupsError(err);
    }
  }
  if (b.action !== 'importOlder') return groupsError(400, 'invalid_action');
  try {
    const { importOlder } = await import('@/lib/groups-import');
    return NextResponse.json(await importOlder(s.ws, id));
  } catch (err) {
    return handleGroupsError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  // Quitar un chat de Groups (con su historial) es de admins, como los números (docs/permissions.md).
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const guard = await chatGuard(s, id);
  if (guard instanceof NextResponse) return guard;
  const ok = await removeChatAs(s.ws, { id: s.me }, id);
  return ok ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
}

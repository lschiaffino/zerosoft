import { NextResponse } from 'next/server';
import { getChat, listMembers, type ChatPatch } from '@/lib/groups';
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
  const chat = await getChat(s.ws, id);
  if (!chat) return groupsError(404, 'not_found');
  return NextResponse.json({ chat: maskChat(guard.viewer, chat), members: (await listMembers(s.ws, id)).map((m) => maskMember(guard.viewer, m)) });
}

/** Renombrar (también en WhatsApp si es grupo), asignar a persona o equipo, cerrar, fijar, etiquetas, propiedades, CRM, agente, leído o no leído. */
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
  if (typeof b.hidden === 'boolean') patch.hidden = b.hidden;
  try {
    return NextResponse.json(maskChat(guard.viewer, await patchChatAs(s.ws, { id: s.me }, id, patch)));
  } catch (err) {
    return handleGroupsError(err);
  }
}

/** Saca el chat de Groups (el grupo sigue en WhatsApp). */
/** { action: 'importOlder' }: trae del teléfono los mensajes anteriores a lo importado. */
export async function POST(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const guard = await chatGuard(s, id);
  if (guard instanceof NextResponse) return guard;
  const b = (await req.json().catch(() => ({}))) as { action?: string };
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

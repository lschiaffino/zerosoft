import { NextResponse } from 'next/server';
import { deleteChat, getChat, listMembers, updateChat, type ChatPatch } from '@/lib/groups';
import { groupsError, groupsSession, handleGroupsError, readJson, strArr } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const chat = await getChat(s.ws, id);
  if (!chat) return groupsError(404, 'not_found');
  return NextResponse.json({ chat, members: await listMembers(s.ws, id) });
}

/** Renombrar (también en WhatsApp si es grupo), asignar a persona o equipo, cerrar, fijar, etiquetas, propiedades, CRM, agente, leído o no leído. */
export async function PATCH(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
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
  try {
    return NextResponse.json(await updateChat(s.ws, (await ctx.params).id, patch, s.me));
  } catch (err) {
    return handleGroupsError(err);
  }
}

/** Saca el chat de Groups (el grupo sigue en WhatsApp). */
export async function DELETE(_req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const ok = await deleteChat(s.ws, (await ctx.params).id);
  return ok ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
}

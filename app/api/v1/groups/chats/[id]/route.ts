import { NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { getChat, listMembers, type ChatPatch } from '@/lib/groups';
import { maskChat, maskMember } from '@/lib/groups-access';
import { patchChatAs } from '@/lib/groups-chat-ops';
import { v1Chat, v1Error, v1Json } from '@/lib/groups-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/groups/chats/:id: el chat o grupo con sus miembros. */
export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req, 'groups:read');
  if ('res' in auth) return auth.res;
  const id = (await ctx.params).id;
  const g = await v1Chat(auth, id);
  if ('res' in g) return g.res;
  const chat = await getChat(auth.user.id, id);
  if (!chat) return apiError(404, 'not_found', 'Chat not found.');
  return NextResponse.json({ data: { ...maskChat(g.viewer, chat), members: (await listMembers(auth.user.id, id)).map((m) => maskMember(g.viewer, m)) } });
}

/** PATCH /api/v1/groups/chats/:id { assignedTo?, status?, labelIds?, name?, description?, properties?, read? } */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req, 'groups:write');
  if ('res' in auth) return auth.res;
  const id = (await ctx.params).id;
  const g = await v1Chat(auth, id);
  if ('res' in g) return g.res;
  const b = await v1Json(req);
  const patch: ChatPatch = {};
  if (b.assignedTo === null || typeof b.assignedTo === 'string') patch.assignedTo = (b.assignedTo as string | null) || null;
  if (b.status === 'open' || b.status === 'closed') patch.status = b.status;
  if (Array.isArray(b.labelIds)) patch.labelIds = b.labelIds.filter((x): x is string => typeof x === 'string').slice(0, 20);
  if (typeof b.name === 'string') patch.name = b.name;
  if (typeof b.description === 'string') patch.description = b.description;
  if (b.properties && typeof b.properties === 'object' && !Array.isArray(b.properties)) patch.properties = b.properties as Record<string, unknown>;
  if (b.read === true) patch.read = true;
  try {
    return NextResponse.json({ data: maskChat(g.viewer, await patchChatAs(auth.user.id, { id: auth.personId, kind: 'api' }, id, patch)) });
  } catch (err) {
    return v1Error(err);
  }
}

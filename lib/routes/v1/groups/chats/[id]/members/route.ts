import { NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { getChat, groupInviteLink, listMembers, updateMembers } from '@/lib/groups';
import type { ParticipantAction } from '@/lib/groups-provider';
import { maskMember } from '@/lib/groups-access';
import { recordAudit } from '@/lib/groups-audit';
import { v1Chat, v1Error, v1Json } from '@/lib/groups-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };
const ACTIONS: ParticipantAction[] = ['add', 'remove', 'promote', 'demote'];

/** GET /api/v1/groups/chats/:id/members */
export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req, 'groups:read');
  if ('res' in auth) return auth.res;
  const id = (await ctx.params).id;
  const g = await v1Chat(auth, id);
  if ('res' in g) return g.res;
  return NextResponse.json({ data: (await listMembers(auth.user.id, id)).map((m) => maskMember(g.viewer, m)) });
}

/**
 * POST /api/v1/groups/chats/:id/members
 * { action: add|remove|promote|demote, phones: [...] } o { action: 'invite', revoke? } (link de invitación).
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req, 'groups:write');
  if ('res' in auth) return auth.res;
  const id = (await ctx.params).id;
  const g = await v1Chat(auth, id);
  if ('res' in g) return g.res;
  const b = await v1Json(req);
  try {
    if (b.action === 'invite') return NextResponse.json({ data: { link: await groupInviteLink(auth.user.id, id, b.revoke === true) } });
    const action = ACTIONS.find((a) => a === b.action);
    if (!action) return apiError(400, 'invalid_action', 'action must be add, remove, promote, demote or invite.');
    const phones = Array.isArray(b.phones) ? b.phones.filter((x): x is string => typeof x === 'string').slice(0, 200) : [];
    const [result] = await updateMembers(auth.user.id, [id], action, phones);
    if (!result.ok) return apiError(502, result.error ?? 'provider_error', 'WhatsApp did not apply the change.');
    const done = result.results.filter((r) => r.ok).length;
    if (done) {
      const chat = await getChat(auth.user.id, id);
      await recordAudit(auth.user.id, { chatId: id, chatName: chat?.name ?? '', actorId: auth.personId, actorKind: 'api', action: 'members', detail: { action, count: done } });
    }
    return NextResponse.json({ data: { results: result.results, members: (await listMembers(auth.user.id, id)).map((m) => maskMember(g.viewer, m)) } });
  } catch (err) {
    return v1Error(err);
  }
}

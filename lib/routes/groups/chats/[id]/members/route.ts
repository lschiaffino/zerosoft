import { NextResponse } from 'next/server';
import { groupInviteLink, listMembers, syncMembers, updateMembers } from '@/lib/groups';
import type { ParticipantAction } from '@/lib/groups-provider';
import { chatGuard, groupsError, groupsSession, handleGroupsError, readJson, strArr } from '@/lib/groups-http';
import { maskMember, type GroupsViewer } from '@/lib/groups-access';
import { getChat } from '@/lib/groups';
import { recordAudit } from '@/lib/groups-audit';

const masked = (viewer: GroupsViewer, list: Awaited<ReturnType<typeof listMembers>>) => list.map((m) => maskMember(viewer, m));

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const ACTIONS: ParticipantAction[] = ['add', 'remove', 'promote', 'demote'];

export async function GET(_req: Request, ctx: Ctx) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const guard = await chatGuard(s, id);
  if (guard instanceof NextResponse) return guard;
  return NextResponse.json({ members: masked(guard.viewer, await listMembers(s.ws, id)) });
}

/**
 * { action: add|remove|promote|demote, phones } en este grupo,
 * { action: 'sync' } para releer los miembros, o
 * { action: 'invite', revoke? } para el link de invitación.
 */
export async function POST(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const guard = await chatGuard(s, id);
  if (guard instanceof NextResponse) return guard;
  const b = await readJson(req);
  try {
    if (b.action === 'sync') return NextResponse.json({ members: masked(guard.viewer, await syncMembers(s.ws, id)) });
    if (b.action === 'invite') return NextResponse.json({ link: await groupInviteLink(s.ws, id, b.revoke === true) });
    const action = ACTIONS.find((a) => a === b.action);
    if (!action) return groupsError(400, 'invalid_action');
    const [result] = await updateMembers(s.ws, [id], action, strArr(b.phones, 200));
    if (!result.ok) return groupsError(502, result.error ?? 'provider_error');
    const done = result.results.filter((r) => r.ok).map((r) => r.phone);
    if (done.length) {
      const chat = await getChat(s.ws, id);
      await recordAudit(s.ws, { chatId: id, chatName: chat?.name ?? '', actorId: s.me, action: 'members', detail: { action, count: done.length } });
    }
    return NextResponse.json({ result, members: masked(guard.viewer, await listMembers(s.ws, id)) });
  } catch (err) {
    return handleGroupsError(err);
  }
}

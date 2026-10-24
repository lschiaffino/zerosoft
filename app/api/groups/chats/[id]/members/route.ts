import { NextResponse } from 'next/server';
import { groupInviteLink, listMembers, syncMembers, updateMembers } from '@/lib/groups';
import type { ParticipantAction } from '@/lib/groups-provider';
import { groupsError, groupsSession, handleGroupsError, readJson, strArr } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const ACTIONS: ParticipantAction[] = ['add', 'remove', 'promote', 'demote'];

export async function GET(_req: Request, ctx: Ctx) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  return NextResponse.json({ members: await listMembers(s.ws, (await ctx.params).id) });
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
  const b = await readJson(req);
  try {
    if (b.action === 'sync') return NextResponse.json({ members: await syncMembers(s.ws, id) });
    if (b.action === 'invite') return NextResponse.json({ link: await groupInviteLink(s.ws, id, b.revoke === true) });
    const action = ACTIONS.find((a) => a === b.action);
    if (!action) return groupsError(400, 'invalid_action');
    const [result] = await updateMembers(s.ws, [id], action, strArr(b.phones, 200));
    if (!result.ok) return groupsError(502, result.error ?? 'provider_error');
    return NextResponse.json({ result, members: await listMembers(s.ws, id) });
  } catch (err) {
    return handleGroupsError(err);
  }
}

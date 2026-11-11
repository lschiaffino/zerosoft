import { NextResponse } from 'next/server';
import { updateMembers } from '@/lib/groups';
import type { ParticipantAction } from '@/lib/groups-provider';
import { groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, strArr } from '@/lib/groups-http';
import { canSeeChat } from '@/lib/groups-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** En lote: { chatIds, action: add|remove|promote|demote, phones } con resultado por grupo y por teléfono. */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const action = (['add', 'remove', 'promote', 'demote'] as ParticipantAction[]).find((a) => a === b.action);
  if (!action) return groupsError(400, 'invalid_action');
  const requested = strArr(b.chatIds, 100);
  if (requested.length === 0) return groupsError(400, 'no_groups');
  // Solo los grupos que esta persona puede ver; el resto no existe para ella.
  const viewer = await sessionViewer(s);
  const chatIds: string[] = [];
  for (const id of requested) if (await canSeeChat(viewer, id)) chatIds.push(id);
  if (chatIds.length === 0) return groupsError(404, 'not_found');
  try {
    return NextResponse.json({ results: await updateMembers(s.ws, chatIds, action, strArr(b.phones, 200)) });
  } catch (err) {
    return handleGroupsError(err);
  }
}

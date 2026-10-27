import { NextResponse } from 'next/server';
import { deleteChatTeam, getChatTeam, updateChatTeam } from '@/lib/chat-collab';
import { chatError, chatSession, collabError, readBody } from '@/lib/chat-http';
import { recordChatAudit } from '@/lib/chat-audit';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, props: Ctx) {
  const { id } = await props.params;
  const s = await chatSession();
  if (s instanceof NextResponse) return s;
  const team = await getChatTeam(s.ws, id);
  return team ? NextResponse.json(team) : chatError(404, 'not_found');
}

/** { name?, memberIds? } */
export async function PATCH(req: Request, props: Ctx) {
  const { id } = await props.params;
  const s = await chatSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const body = await readBody(req);
  if (!body) return chatError(400, 'invalid_input');
  try {
    const team = await updateChatTeam(s.ws, id, { name: body.name, memberIds: body.memberIds }, s.agents.map((a) => a.id));
    if (team) await recordChatAudit(s.ws, s.me, 'team.updated', { id: team.id, name: team.name, members: team.member_ids.length });
    return team ? NextResponse.json(team) : chatError(404, 'not_found');
  } catch (err) {
    return collabError(err);
  }
}

export async function DELETE(_req: Request, props: Ctx) {
  const { id } = await props.params;
  const s = await chatSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  if (!(await deleteChatTeam(s.ws, id))) return chatError(404, 'not_found');
  await recordChatAudit(s.ws, s.me, 'team.deleted', { id });
  return NextResponse.json({ ok: true });
}

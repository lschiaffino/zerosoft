import { NextResponse } from 'next/server';
import { createChatTeam, listChatTeams } from '@/lib/chat-collab';
import { chatError, chatSession, collabError, readBody } from '@/lib/chat-http';
import { recordChatAudit } from '@/lib/chat-audit';

export const dynamic = 'force-dynamic';

/** Equipos de Chat del workspace, con miembros y conversaciones abiertas. */
export async function GET() {
  const s = await chatSession();
  if (s instanceof NextResponse) return s;
  return NextResponse.json({ teams: await listChatTeams(s.ws) });
}

/** { name, memberIds? }: solo admins (como los equipos de Intercom). */
export async function POST(req: Request) {
  const s = await chatSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const body = await readBody(req);
  if (!body) return chatError(400, 'invalid_input');
  try {
    const team = await createChatTeam(s.ws, { name: body.name, memberIds: body.memberIds }, s.agents.map((a) => a.id));
    await recordChatAudit(s.ws, s.me, 'team.created', { id: team.id, name: team.name, members: team.member_ids.length });
    return NextResponse.json(team, { status: 201 });
  } catch (err) {
    return collabError(err);
  }
}

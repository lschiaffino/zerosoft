import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { parseSkills } from '@/lib/chat-data';
import { chatError, chatSession, readBody } from '@/lib/chat-http';
import { recordChatAudit } from '@/lib/chat-audit';

export const dynamic = 'force-dynamic';

/** Habilidades y límite de carga por persona. */
export async function GET() {
  const s = await chatSession();
  if (s instanceof NextResponse) return s;
  const rows = (await getDb().prepare('SELECT user_id, skills, capacity FROM chat_agent_routing WHERE workspace_id = ?').all(s.ws)) as Array<{
    user_id: string;
    skills: string;
    capacity: number | null;
  }>;
  const byId = new Map(rows.map((r) => [r.user_id, r]));
  return NextResponse.json({
    agents: s.agents.map((a) => ({
      id: a.id,
      name: a.name || a.email,
      skills: parseSkills(byId.get(a.id)?.skills),
      capacity: byId.get(a.id)?.capacity ?? null,
    })),
  });
}

/** { userId, skills: string[], capacity: number | null } (admins). */
export async function PUT(req: Request) {
  const s = await chatSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const body = await readBody(req);
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  if (!body || !s.agents.some((a) => a.id === userId) || !Array.isArray(body.skills)) return chatError(400, 'invalid_input');
  const skills = [...new Set(body.skills.filter((x): x is string => typeof x === 'string').map((x) => x.trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 20);
  const capacity = body.capacity === null || body.capacity === '' ? null : Number(body.capacity);
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 0 || capacity > 1000)) return chatError(400, 'invalid_input');
  await getDb()
    .prepare(
      `INSERT INTO chat_agent_routing (workspace_id, user_id, skills, capacity, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET skills = excluded.skills, capacity = excluded.capacity, updated_at = excluded.updated_at`,
    )
    .run(s.ws, userId, JSON.stringify(skills), capacity, new Date().toISOString());
  await recordChatAudit(s.ws, s.me, 'routing.updated', { userId, skills: skills.length, capacity });
  return NextResponse.json({ id: userId, skills, capacity });
}

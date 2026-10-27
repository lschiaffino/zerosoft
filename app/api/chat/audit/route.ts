import { NextResponse } from 'next/server';
import { listChatAudit } from '@/lib/chat-audit';
import { chatSession } from '@/lib/chat-http';

export const dynamic = 'force-dynamic';

/** Registro de auditoría de Chat (exports, equipos, salientes): solo admins. */
export async function GET(req: Request) {
  const s = await chatSession({ admin: true });
  if (s instanceof NextResponse) return s;
  const limit = Number(new URL(req.url).searchParams.get('limit') ?? 100) || 100;
  return NextResponse.json({ entries: await listChatAudit(s.ws, limit) });
}

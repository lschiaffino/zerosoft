import { NextResponse } from 'next/server';
import { chatError, chatSession, collabError, readBody } from '@/lib/chat-http';
import { createSnoozeOption, deleteSnoozeOption, listSnoozeOptions } from '@/lib/chat-snooze';

export const dynamic = 'force-dynamic';

/** Opciones de posponer. Cada persona ve las de todos y las de sus equipos; los admins, todas. */
export async function GET() {
  const s = await chatSession();
  if (s instanceof NextResponse) return s;
  return NextResponse.json({ options: await listSnoozeOptions(s.ws, s.isAdmin ? null : s.me) });
}

export async function POST(req: Request) {
  const s = await chatSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const body = await readBody(req);
  if (!body) return chatError(400, 'invalid_input');
  try {
    return NextResponse.json(await createSnoozeOption(s.ws, body), { status: 201 });
  } catch (err) {
    return collabError(err);
  }
}

export async function DELETE(req: Request) {
  const s = await chatSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!(await deleteSnoozeOption(s.ws, id))) return chatError(404, 'not_found');
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assistantUser, owner } from '@/lib/assistant/http';
import { createConversation, listConversations } from '@/lib/assistant/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Charlas de la persona en el workspace activo (las más recientes primero). */
export async function GET(req: NextRequest) {
  const user = await assistantUser();
  if (user instanceof NextResponse) return user;
  const q = req.nextUrl.searchParams.get('q') ?? undefined;
  return NextResponse.json({ conversations: await listConversations(owner(user), { q }) });
}

export async function POST(req: NextRequest) {
  const user = await assistantUser();
  if (user instanceof NextResponse) return user;
  const parsed = z.object({ title: z.string().max(200).optional() }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const row = await createConversation(owner(user), parsed.data.title ?? '');
  return NextResponse.json(row, { status: 201 });
}

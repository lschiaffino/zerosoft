import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { listChatWidgets } from '@/lib/chat-data';
import { listWorkspaceTags } from '@/lib/chat-inbox';

export const dynamic = 'force-dynamic';

/** Tags en uso en las conversaciones del workspace (filtro del inbox). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const widgets = await listChatWidgets(user.id, user.team?.id ?? null);
  return NextResponse.json({ rows: await listWorkspaceTags(widgets.map((w) => w.id)) });
}

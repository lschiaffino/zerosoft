import { NextResponse } from 'next/server';
import { listAccessibleChatWidgets } from '@/lib/chat-access';
import { getCurrentUser } from '@/lib/session';
import { listWorkspaceTags } from '@/lib/chat-inbox';

export const dynamic = 'force-dynamic';

/** Tags en uso en las conversaciones del workspace (filtro del inbox). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const widgets = await listAccessibleChatWidgets(user);
  return NextResponse.json({ rows: await listWorkspaceTags(widgets.map((w) => w.id)) });
}

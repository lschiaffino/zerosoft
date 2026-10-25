import { NextRequest, NextResponse } from 'next/server';
import { createGroupTask, listGroupTasks } from '@/lib/groups-tasks';
import { groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';
import { requestLocale } from '@/lib/request-locale';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Tareas de los chats (?chat=, ?status=open|done|all, ?owner=me|<id>, ?q=). */
export async function GET(req: NextRequest) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const p = req.nextUrl.searchParams;
  const status = p.get('status');
  return NextResponse.json({
    tasks: await listGroupTasks(s.ws, s.me, {
      chatId: p.get('chat') || undefined,
      status: status === 'done' || status === 'all' ? status : 'open',
      ownerId: p.get('owner') || undefined,
      q: p.get('q') ?? undefined,
    }),
  });
}

/** { chatId, messageId?, title, notes?, dueAt?, ownerId?, timezone? }: la tarea queda también en CRM › Tareas. */
export async function POST(req: NextRequest) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    const task = await createGroupTask(s.ws, s.me, {
      chatId: str(b.chatId, 100) ?? '',
      messageId: str(b.messageId, 100) || null,
      title: str(b.title, 200),
      notes: str(b.notes, 4000),
      dueAt: str(b.dueAt, 40) || null,
      ownerId: str(b.ownerId, 100) || null,
      timezone: str(b.timezone, 60) ?? req.cookies.get('tz')?.value,
      locale: requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language')),
    });
    return NextResponse.json(task, { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}

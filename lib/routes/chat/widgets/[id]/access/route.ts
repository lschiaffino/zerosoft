import { NextResponse } from 'next/server';
import { canAccessWidget, listWidgetAccess, setWidgetAccess } from '@/lib/chat-access';
import { getChatWidget } from '@/lib/chat-data';
import { chatError, chatSession, readBody } from '@/lib/chat-http';
import { recordChatAudit } from '@/lib/chat-audit';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, props: Ctx) {
  const { id } = await props.params;
  const s = await chatSession();
  if (s instanceof NextResponse) return s;
  const widget = await getChatWidget(id);
  if (!(await canAccessWidget(widget, s.user))) return chatError(404, 'not_found');
  return NextResponse.json({ restricted: Number(widget!.restricted ?? 0) === 1, memberIds: await listWidgetAccess(id) });
}

/** { restricted: boolean, memberIds: string[] }: solo admins y solo personas del workspace. */
export async function PUT(req: Request, props: Ctx) {
  const { id } = await props.params;
  const s = await chatSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const widget = await getChatWidget(id);
  if (!(await canAccessWidget(widget, s.user))) return chatError(404, 'not_found');
  const body = await readBody(req);
  if (!body || typeof body.restricted !== 'boolean' || !Array.isArray(body.memberIds)) return chatError(400, 'invalid_input');
  const valid = new Set(s.agents.map((a) => a.id));
  const memberIds = body.memberIds.filter((x): x is string => typeof x === 'string' && valid.has(x));
  const result = await setWidgetAccess(id, body.restricted, memberIds);
  await recordChatAudit(s.ws, s.me, 'widget.access', { id, restricted: body.restricted, members: memberIds.length, ...result });
  return NextResponse.json({ restricted: body.restricted, memberIds, ...result });
}

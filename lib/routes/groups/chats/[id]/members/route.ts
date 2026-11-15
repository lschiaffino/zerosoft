import { NextResponse } from 'next/server';
import { groupInviteLink, listMembers, syncMembers, updateMembers } from '@/lib/groups';
import type { ParticipantAction } from '@/lib/groups-provider';
import { chatGuard, groupsError, groupsSession, handleGroupsError, readJson, strArr } from '@/lib/groups-http';
import { maskMember, type GroupsViewer } from '@/lib/groups-access';
import { getChat } from '@/lib/groups';
import { recordAudit } from '@/lib/groups-audit';

const masked = (viewer: GroupsViewer, list: Awaited<ReturnType<typeof listMembers>>) => list.map((m) => maskMember(viewer, m));

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const ACTIONS: ParticipantAction[] = ['add', 'remove', 'promote', 'demote'];

/**
 * Los miembros; ?phone=<dígitos> o ?message=<id> (quien lo mandó): la ficha de
 * esa persona; con &shared=media|docs|links|starred, lo compartido en su chat 1:1.
 */
export async function GET(req: Request, ctx: Ctx) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const guard = await chatGuard(s, id);
  if (guard instanceof NextResponse) return guard;
  const sp = new URL(req.url).searchParams;
  if (sp.has('phone') || sp.has('message')) {
    try {
      const { personCard, personPhone, sharedContent } = await import('@/lib/groups-person');
      const phone = await personPhone(s.ws, id, { phone: sp.get('phone')?.slice(0, 40), messageId: sp.get('message')?.slice(0, 100) });
      const person = await personCard(guard.viewer, id, phone);
      const kind = sp.get('shared');
      if (kind) {
        if (kind !== 'media' && kind !== 'docs' && kind !== 'links' && kind !== 'starred') return groupsError(400, 'invalid_input');
        return NextResponse.json({ items: person.dm ? await sharedContent(guard.viewer, person.dm.id, kind) : [] });
      }
      return NextResponse.json({ person });
    } catch (err) {
      return handleGroupsError(err);
    }
  }
  return NextResponse.json({ members: masked(guard.viewer, await listMembers(s.ws, id)) });
}

/**
 * { action: add|remove|promote|demote, phones } en este grupo,
 * { action: 'sync' } para releer los miembros, o
 * { action: 'invite', revoke? } para el link de invitación, o
 * { action: 'message', phone? | messageId? } para abrir el chat 1:1 con esa persona.
 */
export async function POST(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const guard = await chatGuard(s, id);
  if (guard instanceof NextResponse) return guard;
  const b = await readJson(req);
  try {
    if (b.action === 'sync') return NextResponse.json({ members: masked(guard.viewer, await syncMembers(s.ws, id)) });
    if (b.action === 'invite') return NextResponse.json({ link: await groupInviteLink(s.ws, id, b.revoke === true) });
    // "Mensaje" desde la ficha de una persona: abre (o crea) su chat 1:1 en la misma línea, sin pasarle el teléfono a quien no lo ve.
    if (b.action === 'message') {
      const { personPhone } = await import('@/lib/groups-person');
      const { startChat } = await import('@/lib/groups-new-chat');
      const chat = await getChat(s.ws, id);
      if (!chat) return groupsError(404, 'not_found');
      const phone = await personPhone(s.ws, id, { phone: typeof b.phone === 'string' ? b.phone : null, messageId: typeof b.messageId === 'string' ? b.messageId : null });
      const res = await startChat(guard.viewer, { numberId: chat.numberId, phone });
      return NextResponse.json(res, { status: res.created ? 201 : 200 });
    }
    const action = ACTIONS.find((a) => a === b.action);
    if (!action) return groupsError(400, 'invalid_action');
    const [result] = await updateMembers(s.ws, [id], action, strArr(b.phones, 200));
    if (!result.ok) return groupsError(502, result.error ?? 'provider_error');
    const done = result.results.filter((r) => r.ok).map((r) => r.phone);
    if (done.length) {
      const chat = await getChat(s.ws, id);
      await recordAudit(s.ws, { chatId: id, chatName: chat?.name ?? '', actorId: s.me, action: 'members', detail: { action, count: done.length } });
    }
    return NextResponse.json({ result, members: masked(guard.viewer, await listMembers(s.ws, id)) });
  } catch (err) {
    return handleGroupsError(err);
  }
}

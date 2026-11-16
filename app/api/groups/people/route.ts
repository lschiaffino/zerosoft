import { NextResponse } from 'next/server';
import { groupsSession, handleGroupsError, sessionViewer } from '@/lib/groups-http';
import { conditionalJson } from '@/lib/etag';
import { listLinesContacts } from '@/lib/groups-contacts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Lines › Contactos: cada persona una sola vez (teléfono y lid unidos) con sus
 * líneas, grupos, último mensaje y contacto y empresa de HubSpot. Solo las
 * personas de los chats que quien pide puede ver. ?q= busca por nombre (o
 * teléfono, si no lo tiene oculto), ?lines=id1,id2, ?hubspot=linked|unlinked,
 * ?chat=dm|groups.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const p = new URL(req.url).searchParams;
  const hubspot = p.get('hubspot');
  const chat = p.get('chat');
  try {
    const dto = await listLinesContacts(await sessionViewer(s), {
      q: (p.get('q') ?? '').slice(0, 200),
      lines: (p.get('lines') ?? '').split(',').filter((x) => /^[\w-]{1,80}$/.test(x)).slice(0, 50),
      hubspot: hubspot === 'linked' || hubspot === 'unlinked' ? hubspot : undefined,
      chat: chat === 'dm' || chat === 'groups' ? chat : undefined,
    });
    return conditionalJson(req, dto, { 'cache-control': 'private, no-store' });
  } catch (err) {
    return handleGroupsError(err);
  }
}

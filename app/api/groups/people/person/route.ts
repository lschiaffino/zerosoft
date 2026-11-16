import { NextResponse } from 'next/server';
import { groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, str } from '@/lib/groups-http';
import { contactHubspotMatches, contactMessageTarget, createContactHubspot, linesContact, linkContactHubspot, unlinkContactHubspot } from '@/lib/groups-contacts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'private, no-store' };

/**
 * La ficha de un contacto de Lines: ?id=<id de la persona>. Con
 * &hubspot=matches, los contactos de HubSpot con su teléfono. 404 si la
 * persona no está en ningún chat que quien pide ve.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const sp = new URL(req.url).searchParams;
  const id = (sp.get('id') ?? '').slice(0, 64);
  try {
    const viewer = await sessionViewer(s);
    if (sp.get('hubspot') === 'matches') return NextResponse.json({ matches: await contactHubspotMatches(viewer, id) }, { headers: NO_STORE });
    return NextResponse.json(await linesContact(viewer, id), { headers: NO_STORE });
  } catch (err) {
    return handleGroupsError(err);
  }
}

/**
 * { id, action }:
 * - 'message' (numberId?): abre el chat 1:1 con la persona (o lo crea en la línea donde está);
 * - 'link' { contactId }: la vincula a ese contacto de HubSpot y a su empresa;
 * - 'unlink': quita el vínculo;
 * - 'create': crea el contacto en HubSpot si no hay ninguno con su teléfono
 *   (si hay, devuelve { existing } para elegir) y la vincula.
 */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  if (s.user.role === 'guest') return groupsError(403, 'forbidden');
  const b = await readJson(req);
  const id = str(b.id, 64) ?? '';
  try {
    const viewer = await sessionViewer(s);
    if (b.action === 'message') {
      const target = await contactMessageTarget(viewer, id, str(b.numberId, 100));
      if ('chatId' in target) return NextResponse.json({ id: target.chatId, created: false });
      const { startChat } = await import('@/lib/groups-new-chat');
      const res = await startChat(viewer, target);
      return NextResponse.json(res, { status: res.created ? 201 : 200 });
    }
    if (b.action === 'link') return NextResponse.json({ row: await linkContactHubspot(viewer, s.me, id, str(b.contactId, 20) ?? '') });
    if (b.action === 'unlink') return NextResponse.json({ row: await unlinkContactHubspot(viewer, id) });
    if (b.action === 'create') {
      const res = await createContactHubspot(viewer, s.me, id);
      return NextResponse.json(res, { status: res.row ? 201 : 200 });
    }
    return groupsError(400, 'invalid_action');
  } catch (err) {
    return handleGroupsError(err);
  }
}

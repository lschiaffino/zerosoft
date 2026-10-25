import { after, NextResponse } from 'next/server';
import { createBroadcast, listBroadcasts, processBroadcasts } from '@/lib/groups-broadcasts';
import { groupsSession, handleGroupsError, readJson, sessionViewer, str, strArr } from '@/lib/groups-http';
import { visibleChatIds } from '@/lib/groups-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const p = new URL(req.url).searchParams;
  const kind = p.get('kind') === 'scheduled' || p.get('kind') === 'broadcast' ? (p.get('kind') as 'scheduled' | 'broadcast') : undefined;
  return NextResponse.json({ broadcasts: await listBroadcasts(s.ws, { kind, chatId: p.get('chat') || undefined }) });
}

/**
 * Crea un envío masivo o un mensaje programado: { chatIds, body, media?,
 * scheduledAt?, perMinute?, name?, kind? }. Si es para ahora, el primer lote
 * sale después de responder; el resto, con el cron de cada minuto.
 */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const m = b.media && typeof b.media === 'object' ? (b.media as Record<string, unknown>) : null;
  // Acceso por etiqueta: solo a chats que la persona ve.
  const visible = await visibleChatIds(await sessionViewer(s));
  try {
    const broadcast = await createBroadcast(s.ws, s.me, {
      numberId: str(b.numberId, 100),
      name: str(b.name, 120),
      body: str(b.body) ?? '',
      media:
        m && typeof m.url === 'string' && /^(https:\/\/|\/uploads\/)/.test(m.url)
          ? {
              // El proveedor baja la media de una URL pública: un /uploads/ se completa con el origen.
              url: m.url.startsWith('/') ? `${(process.env.NEXTAUTH_URL || new URL(req.url).origin).replace(/\/$/, '')}${m.url}` : m.url,
              mimetype: str(m.mimetype, 100) || 'application/octet-stream', filename: str(m.filename, 200) || 'file' }
          : null,
      chatIds: strArr(b.chatIds, 2000).filter((id) => !visible || visible.has(id)),
      poll: b.poll ?? null,
      scheduledAt: str(b.scheduledAt, 40) || null,
      perMinute: Number(b.perMinute) || undefined,
      kind: b.kind === 'scheduled' ? 'scheduled' : 'broadcast',
    });
    if (Date.parse(broadcast.scheduledAt) <= Date.now() + 1000) {
      after(() => processBroadcasts({ broadcastId: broadcast.id, budgetMs: 25_000 }).catch(() => null));
    }
    return NextResponse.json(broadcast, { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}

import { NextResponse } from 'next/server';
import { getChatRow, listMessages, sendMessage } from '@/lib/groups';
import { groupsError, groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Mensajes del chat. ?after=<iso> trae solo los nuevos (la pantalla consulta cada pocos segundos). */
export async function GET(req: Request, ctx: Ctx) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const chat = await getChatRow(s.ws, id);
  if (!chat) return groupsError(404, 'not_found');
  const after = new URL(req.url).searchParams.get('after') || undefined;
  return NextResponse.json({ messages: await listMessages(s.ws, id, { after }) });
}

/** Manda texto, media o una nota interna ({ note: true }). */
export async function POST(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const media =
    b.media && typeof b.media === 'object'
      ? (() => {
          const m = b.media as Record<string, unknown>;
          const url = str(m.url, 2000) ?? '';
          // Solo archivos subidos a zerosoft o URLs https públicas.
          if (!/^(\/uploads\/|https:\/\/)/.test(url)) return null;
          return { url, mimetype: str(m.mimetype, 100) || 'application/octet-stream', filename: str(m.filename, 200) || 'file' };
        })()
      : null;
  try {
    const msg = await sendMessage(s.ws, s.me, (await ctx.params).id, {
      body: str(b.body) ?? '',
      replyToId: str(b.replyToId, 100) || null,
      note: b.note === true,
      media: media ? { ...media, url: absoluteUrl(media.url, req) } : null,
    });
    return NextResponse.json(msg, { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}

/** El proveedor baja la media de una URL pública: un /uploads/ relativo se completa con el origen. */
function absoluteUrl(url: string, req: Request): string {
  if (!url.startsWith('/')) return url;
  const base = (process.env.NEXTAUTH_URL || new URL(req.url).origin).replace(/\/$/, '');
  return `${base}${url}`;
}

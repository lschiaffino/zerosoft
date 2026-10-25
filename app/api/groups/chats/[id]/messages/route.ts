import { NextResponse } from 'next/server';
import { GroupsError, getChatRow, listMessages, sendMessage } from '@/lib/groups';
import { chatGuard, groupsError, groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';
import { maskMessage } from '@/lib/groups-access';
import { normalizePoll } from '@/lib/groups-polls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Mensajes del chat. ?after=<iso> trae solo los nuevos (la pantalla consulta cada pocos segundos). */
export async function GET(req: Request, ctx: Ctx) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const guard = await chatGuard(s, id);
  if (guard instanceof NextResponse) return guard;
  const chat = await getChatRow(s.ws, id);
  if (!chat) return groupsError(404, 'not_found');
  const p = new URL(req.url).searchParams;
  const after = p.get('after') || undefined;
  const limit = Number(p.get('limit')) || undefined;
  return NextResponse.json({ messages: (await listMessages(s.ws, id, { after, limit })).map((m) => maskMessage(guard.viewer, m)) });
}

/** Manda texto, media, una encuesta ({ poll: { question, options, multi } }) o una nota interna ({ note: true }). */
export async function POST(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const guard = await chatGuard(s, (await ctx.params).id);
  if (guard instanceof NextResponse) return guard;
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
    let poll = null;
    if (b.poll != null) {
      try {
        poll = normalizePoll(b.poll);
      } catch (err) {
        throw new GroupsError((err as Error).message);
      }
    }
    const msg = await sendMessage(s.ws, s.me, (await ctx.params).id, {
      poll,
      body: str(b.body) ?? '',
      replyToId: str(b.replyToId, 100) || null,
      note: b.note === true,
      media: media ? { ...media, url: absoluteUrl(media.url, req) } : null,
    });
    return NextResponse.json(maskMessage(guard.viewer, msg), { status: 201 });
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

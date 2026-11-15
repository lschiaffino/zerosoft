import { getDb } from '@/lib/db';
import { iJson, inboxOwner } from '@/lib/inbox/http';
import { waPictureResponse } from '@/lib/wa-picture-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Foto de un contacto de la libreta de WhatsApp de la persona (Inbox es
 * personal). La URL de la CDN de WhatsApp nunca llega al navegador.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const who = await inboxOwner();
  if ('res' in who) return who.res;
  const { id } = await ctx.params;
  const row = (await getDb()
    .prepare("SELECT picture_url FROM wa_contacts WHERE id = ? AND user_id = ? AND app = 'inbox'")
    .get(id, who.owner)) as { picture_url: string } | undefined;
  if (!row?.picture_url) return iJson({ error: 'not_found' }, 404);
  return (await waPictureResponse(row.picture_url)) ?? iJson({ error: 'not_found' }, 404);
}

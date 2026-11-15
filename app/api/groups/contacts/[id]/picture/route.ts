import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { canSeeNumber } from '@/lib/groups-access';
import { groupsError, groupsSession, sessionViewer } from '@/lib/groups-http';
import { waPictureResponse } from '@/lib/wa-picture-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Foto de un contacto de la libreta de WhatsApp de una línea, con la sesión
 * y el acceso a esa línea. La URL de la CDN de WhatsApp nunca llega al
 * navegador.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const { id } = await ctx.params;
  const row = (await getDb()
    .prepare("SELECT account_id, picture_url FROM wa_contacts WHERE id = ? AND user_id = ? AND app = 'lines'")
    .get(id, s.ws)) as { account_id: string; picture_url: string } | undefined;
  if (!row?.picture_url) return groupsError(404, 'not_found');
  if (!(await canSeeNumber(await sessionViewer(s), row.account_id))) return groupsError(404, 'not_found');
  return (await waPictureResponse(row.picture_url)) ?? groupsError(404, 'not_found');
}

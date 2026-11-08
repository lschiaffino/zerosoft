import { getThread, listAccounts } from '@/lib/inbox/core';
import { composeGmail } from '@/lib/inbox/gmail';
import { iJson, parseBody, withOwner } from '@/lib/inbox/http';
import { limitByIp } from '@/lib/rate-limit';
import { composeSchema } from '@/lib/inbox/schemas';
import { sendToThread } from '@/lib/inbox/send';
import { InboxError } from '@/lib/inbox/types';
import { startWhatsappChat } from '@/lib/inbox/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Chat nuevo de WhatsApp (por número) o correo nuevo. Devuelve el chat para abrirlo. */
export async function POST(req: Request) {
  const limited = await limitByIp(req, 'inbox-compose', 120, 60).catch(() => null);
  if (limited) return limited;
  return withOwner(async (owner) => {
    const body = await parseBody(req, composeSchema);
    if (body.channel === 'whatsapp') {
      const t = await startWhatsappChat(owner, body.to);
      if (body.body?.trim()) await sendToThread(owner, t.id, body.body);
      return iJson({ thread: await getThread(owner, t.id) }, 201);
    }
    const gmail = (await listAccounts(owner)).filter((a) => a.kind === 'gmail' && a.status === 'connected');
    const account = body.accountId ? gmail.find((a) => a.id === body.accountId) : gmail[0];
    if (!account) throw new InboxError('not_connected', 409);
    const t = await composeGmail(account, { to: body.to, subject: body.subject, text: body.body });
    return iJson({ thread: await getThread(owner, t.id) }, 201);
  });
}

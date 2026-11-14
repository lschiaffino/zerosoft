import { z } from 'zod';
import { getThread } from '@/lib/inbox/core';
import { iJson, parseBody, withOwner } from '@/lib/inbox/http';
import { createWhatsappGroup } from '@/lib/inbox/new-chat';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ name: z.string().trim().min(1).max(100), phones: z.array(z.string().max(40)).min(1).max(256) });

/** Grupo nuevo de WhatsApp desde Inbox: { name, phones }. Devuelve el chat del grupo para abrirlo. */
export async function POST(req: Request) {
  const limited = await limitByIp(req, 'inbox-group-create', 20, 60).catch(() => null);
  if (limited) return limited;
  return withOwner(async (owner) => {
    const body = await parseBody(req, schema);
    const t = await createWhatsappGroup(owner, body);
    return iJson({ thread: await getThread(owner, t.id) }, 201);
  });
}

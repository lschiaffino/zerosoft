import { z } from 'zod';
import { getThread } from '@/lib/inbox/core';
import { iJson, parseBody, withOwner } from '@/lib/inbox/http';
import { joinWhatsappGroup } from '@/lib/inbox/new-chat';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ invite: z.string().trim().min(1).max(300), threadId: z.string().max(100).optional() });

/**
 * Entra a un grupo de WhatsApp con un link de invitación: { invite, threadId? }.
 * Usa la cuenta del chat donde llegó el link (o la de WhatsApp de la dueña) y
 * devuelve el chat del grupo para abrirlo. Entrar se ve en el grupo: la
 * pantalla pide confirmación antes.
 */
export async function POST(req: Request) {
  const limited = await limitByIp(req, 'inbox-group-join', 20, 60).catch(() => null);
  if (limited) return limited;
  return withOwner(async (owner) => {
    const body = await parseBody(req, schema);
    const t = await joinWhatsappGroup(owner, body);
    return iJson({ thread: await getThread(owner, t.id) }, 201);
  });
}

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { copyEnvelope, envelopeDto, listRecipients, remindEnvelope, sendEnvelope, signLinkForMe, voidEnvelope } from '@/lib/sign/core';
import { parseBody, sFail, signActor, signLimit, sJson, type Ctx } from '@/lib/sign/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  action: z.enum(['send', 'void', 'copy', 'remind', 'sign_link']),
  reason: z.string().max(500).optional(),
  recipientId: z.string().max(80).nullable().optional(),
  rotate: z.boolean().optional(),
});

/**
 * POST: send (el borrador sale), void (anula uno enviado, con motivo),
 * copy (borrador nuevo igual: así se corrige un enviado), remind (reenvía el
 * link; con rotate el anterior deja de servir) y sign_link (firmar desde la
 * app cuando el sobre espera a esta persona).
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await signActor();
  if ('res' in a) return a.res;
  const limited = await signLimit(req, 'actions', 120, 3600, a.actor.person);
  if (limited) return limited;
  try {
    const id = (await params).id;
    const input = await parseBody(req, schema);
    switch (input.action) {
      case 'send': {
        const env = await sendEnvelope(a.actor, id);
        return sJson({ envelope: await envelopeDto(a.actor, env, await listRecipients(id), { fields: true, events: true }) });
      }
      case 'void': {
        const reason = (input.reason ?? '').trim();
        if (!reason) return sJson({ error: 'reason_required' }, 400);
        const env = await voidEnvelope(a.actor, id, reason);
        return sJson({ envelope: await envelopeDto(a.actor, env, await listRecipients(id), { fields: true, events: true }) });
      }
      case 'copy': {
        const env = await copyEnvelope(a.actor, id);
        return sJson({ id: env.id }, 201);
      }
      case 'remind':
        return sJson({ reminded: await remindEnvelope(a.actor, id, { recipientId: input.recipientId ?? null, rotate: input.rotate }) });
      case 'sign_link':
        return sJson({ url: await signLinkForMe(a.actor, id) });
    }
  } catch (err) {
    return sFail(err);
  }
}

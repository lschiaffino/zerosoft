import { NextRequest } from 'next/server';
import { z } from 'zod';
import { envelopeDto, getEnvelopeRow, saveRecipients } from '@/lib/sign/core';
import { parseBody, sFail, signActor, sJson, type Ctx } from '@/lib/sign/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  recipients: z
    .array(
      z.object({
        id: z.string().max(80).optional(),
        role: z.enum(['signer', 'approver', 'cc']),
        name: z.string().max(120),
        email: z.string().max(254),
        routingOrder: z.number().int().min(1).max(50),
      }),
    )
    .max(50),
});

/** PUT: reemplaza los destinatarios del borrador. */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const a = await signActor();
  if ('res' in a) return a.res;
  try {
    const id = (await params).id;
    const { recipients } = await parseBody(req, schema);
    const rows = await saveRecipients(a.actor, id, recipients);
    return sJson({ envelope: await envelopeDto(a.actor, (await getEnvelopeRow(a.actor.ws, id))!, rows, { fields: true }) });
  } catch (err) {
    return sFail(err);
  }
}

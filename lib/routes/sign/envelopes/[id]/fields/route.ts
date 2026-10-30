import { NextRequest } from 'next/server';
import { z } from 'zod';
import { envelopeDto, getEnvelopeRow, listRecipients, saveFields } from '@/lib/sign/core';
import { FIELD_KINDS, type FieldKind } from '@/lib/sign/types';
import { parseBody, sFail, signActor, sJson, type Ctx } from '@/lib/sign/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  fields: z
    .array(
      z.object({
        recipientId: z.string().max(80),
        kind: z.enum(FIELD_KINDS as [FieldKind, ...FieldKind[]]),
        page: z.number().int().min(1).max(1000),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
        required: z.boolean().optional(),
        label: z.string().max(80).optional(),
        options: z.array(z.string().max(100)).max(50).optional(),
      }),
    )
    .max(500),
});

/** PUT: reemplaza los campos del borrador (cada uno de un destinatario que firma o aprueba). */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const a = await signActor();
  if ('res' in a) return a.res;
  try {
    const id = (await params).id;
    const { fields } = await parseBody(req, schema);
    await saveFields(a.actor, id, fields);
    return sJson({ envelope: await envelopeDto(a.actor, (await getEnvelopeRow(a.actor.ws, id))!, await listRecipients(id), { fields: true }) });
  } catch (err) {
    return sFail(err);
  }
}

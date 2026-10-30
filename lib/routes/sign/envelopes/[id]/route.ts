import { NextRequest } from 'next/server';
import { z } from 'zod';
import { deleteEnvelope, envelopeDto, getEnvelopeRow, listRecipients, requireSee, updateEnvelope } from '@/lib/sign/core';
import { parseBody, sFail, signActor, sJson, type Ctx } from '@/lib/sign/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: el sobre con destinatarios, campos y línea de tiempo (para quien lo ve). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const a = await signActor();
  if ('res' in a) return a.res;
  try {
    const { env, recipients } = await requireSee(a.actor, (await params).id);
    return sJson({ envelope: await envelopeDto(a.actor, env, recipients, { fields: true, events: true }) });
  } catch (err) {
    return sFail(err);
  }
}

const patchSchema = z.object({
  title: z.string().max(200).optional(),
  message: z.string().max(4000).optional(),
  signingOrder: z.enum(['sequential', 'parallel']).optional(),
  otpRequired: z.boolean().optional(),
  expiresDays: z.number().int().min(1).max(365).optional(),
  reminderDays: z.number().int().min(0).max(30).optional(),
});

/** PATCH: título y ajustes de un borrador (enviado no cambia: 409 envelope_locked). */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const a = await signActor();
  if ('res' in a) return a.res;
  try {
    const id = (await params).id;
    await updateEnvelope(a.actor, id, await parseBody(req, patchSchema));
    return sJson({ envelope: await envelopeDto(a.actor, (await getEnvelopeRow(a.actor.ws, id))!, await listRecipients(id), { fields: true }) });
  } catch (err) {
    return sFail(err);
  }
}

/** DELETE: borra un sobre que no está en curso (uno enviado se anula primero). */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const a = await signActor();
  if ('res' in a) return a.res;
  try {
    await deleteEnvelope(a.actor, (await params).id);
    return sJson({ ok: true });
  } catch (err) {
    return sFail(err);
  }
}

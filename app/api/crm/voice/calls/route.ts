import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canSeeActivityRefs, sessionScope } from '@/lib/crm-visibility';
import { crmError, invalidBody, limitAction, notFound, unauthorized } from '@/lib/crm-http';
import { e164, voiceConfigured } from '@/lib/twilio-voice';
import { callView, createOutboundCall, getVoiceSettings } from '@/lib/crm-voice';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const id = z.string().min(1).max(64);
const schema = z.object({
  to: z.string().trim().min(3).max(40),
  contactId: id.nullish(),
  companyId: id.nullish(),
  dealId: id.nullish(),
});

/**
 * Prepara una llamada saliente desde el navegador: valida el número y que la
 * persona vea los registros; la UI conecta el Voice SDK con el id devuelto.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!voiceConfigured()) return crmError(400, 'voice_not_configured');
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const personId = realUserId(user);
  const limited = await limitAction(personId, 'voice-call', 120, 3600);
  if (limited) return limited;
  const to = e164(parsed.data.to);
  if (!to) return crmError(400, 'invalid_number');
  const settings = await getVoiceSettings(user.id);
  if (!settings.callerId) return crmError(400, 'no_caller_id');
  const refs = { contact_id: parsed.data.contactId, company_id: parsed.data.companyId, deal_id: parsed.data.dealId, owner_id: personId };
  const db = getDb();
  for (const [table, value] of [
    ['crm_contacts', parsed.data.contactId],
    ['crm_companies', parsed.data.companyId],
    ['crm_deals', parsed.data.dealId],
  ] as const) {
    if (value && !(await db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND user_id = ?`).get(value, user.id))) return notFound();
  }
  if (!(await canSeeActivityRefs(user.id, refs, await sessionScope(user)))) return notFound();

  const call = await createOutboundCall(user.id, personId, {
    to,
    from: settings.callerId,
    contactId: parsed.data.contactId,
    companyId: parsed.data.companyId,
    dealId: parsed.data.dealId,
    recorded: settings.recordCalls,
  });
  return NextResponse.json(
    { call: callView(call), to, recorded: settings.recordCalls, consent: settings.recordCalls && settings.consentEnabled },
    { status: 201 },
  );
}

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { countBoxes, createEnvelope, deleteEnvelope, getEnvelopeRow, envelopeDto, listEnvelopes, listRecipients, saveRecipients, setDocument, SIGN_BOXES, type SignBox } from '@/lib/sign/core';
import { crmPrefill } from '@/lib/sign/integrations';
import { MAX_PDF_BYTES } from '@/lib/sign/pdf';
import { parseBody, pdfFromForm, sFail, signActor, signLimit, sJson } from '@/lib/sign/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: sobres que la persona ve (?box=action|waiting|completed|closed|drafts, ?q=) y el conteo por caja. */
export async function GET(req: NextRequest) {
  const a = await signActor();
  if ('res' in a) return a.res;
  const sp = req.nextUrl.searchParams;
  const box = (SIGN_BOXES as string[]).includes(sp.get('box') ?? '') ? (sp.get('box') as SignBox) : 'all';
  const all = await listEnvelopes(a.actor, { q: sp.get('q') ?? '' });
  return sJson({ envelopes: box === 'all' ? all : all.filter((e) => e.box === box), counts: countBoxes(all) });
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  message: z.string().max(4000).optional(),
  locale: z.string().max(5).optional(),
  crm: z.string().max(100).optional(),
  people: z.object({ kind: z.enum(['offer', 'policy', 'employee']), id: z.string().max(80), label: z.string().max(120).optional() }).optional(),
  recipients: z
    .array(z.object({ role: z.enum(['signer', 'approver', 'cc']), name: z.string().max(120), email: z.string().max(254), routingOrder: z.number().int().min(1).max(50) }))
    .max(50)
    .optional(),
});

/**
 * POST: sobre nuevo (borrador). JSON con el título (y opcional mensaje, un
 * vínculo del CRM "deal:<id>" o "contact:<id>", un vínculo de People y los
 * destinatarios), o multipart con `file` (PDF) y `title`.
 */
export async function POST(req: NextRequest) {
  const a = await signActor();
  if ('res' in a) return a.res;
  const limited = await signLimit(req, 'create', 120, 3600, a.actor.person);
  if (limited) return limited;
  try {
    if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
      const file = await pdfFromForm(req, MAX_PDF_BYTES);
      const form = file.form;
      const title = String(form.get('title') ?? '').trim() || file.name.replace(/\.pdf$/i, '');
      const crm = String(form.get('crm') ?? '');
      const prefill = crm ? await crmPrefill(a.user, crm) : null;
      const env = await createEnvelope(a.actor, { title, locale: String(form.get('locale') ?? 'en'), links: prefill ? [prefill.link] : [], source: prefill ? 'crm' : 'upload' });
      try {
        await setDocument(a.actor, env.id, { bytes: file.bytes, name: file.name });
      } catch (err) {
        await deleteEnvelope(a.actor, env.id).catch(() => undefined);
        throw err;
      }
      if (prefill?.recipient) await saveRecipients(a.actor, env.id, [{ role: 'signer', name: prefill.recipient.name, email: prefill.recipient.email, routingOrder: 1 }]);
      return sJson({ envelope: await envelopeDto(a.actor, (await getEnvelopeRow(a.actor.ws, env.id))!, await listRecipients(env.id)) }, 201);
    }
    const input = await parseBody(req, createSchema);
    const prefill = input.crm ? await crmPrefill(a.user, input.crm) : null;
    if (input.crm && !prefill) return sJson({ error: 'crm_not_found' }, 404);
    const links = [...(prefill ? [prefill.link] : []), ...(input.people ? [{ app: 'people' as const, kind: input.people.kind, id: input.people.id, label: input.people.label }] : [])];
    const env = await createEnvelope(a.actor, { title: input.title, message: input.message, locale: input.locale, links, source: prefill ? 'crm' : input.people ? 'people' : 'upload' });
    const recipients = input.recipients ?? (prefill?.recipient ? [{ role: 'signer' as const, ...prefill.recipient, routingOrder: 1 }] : []);
    if (recipients.length) await saveRecipients(a.actor, env.id, recipients);
    return sJson({ envelope: await envelopeDto(a.actor, env, await listRecipients(env.id)) }, 201);
  } catch (err) {
    return sFail(err);
  }
}

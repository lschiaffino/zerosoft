import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { apiScope, canSeeRecord } from '@/lib/crm-visibility';
import { getEmailTemplate, listEmailTemplates, loadTemplateContext, renderEmailTemplate } from '@/lib/crm-email';
import { contactsByEmail } from '@/lib/crm-email-sync';
import { normalizeEmail } from '@/lib/crm-extension';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Templates y snippets del workspace para insertar desde la redacción de Gmail. */
export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;
  const rows = await listEmailTemplates(auth.user.id);
  return NextResponse.json({ templates: rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name })) });
}

const schema = z.object({
  templateId: z.string().min(1).max(64),
  to: z.string().max(2000).optional(),
});

/**
 * Template con las variables del destinatario resueltas (contacto, empresa,
 * deal abierto y owner), si el destinatario es un contacto que la key ve.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_input', 'Pass templateId and optionally to.');
  const tpl = await getEmailTemplate(auth.user.id, parsed.data.templateId);
  if (!tpl) return apiError(404, 'not_found', 'Template not found.');

  const email = normalizeEmail((parsed.data.to ?? '').split(/[,;]/)[0]);
  let contactId: string | null = null;
  if (email) {
    const found = (await contactsByEmail(auth.user.id, [email])).get(email) ?? null;
    if (found && (await canSeeRecord(auth.user.id, 'crm_contacts', found, await apiScope(auth)))) contactId = found;
  }
  const ctx = await loadTemplateContext(auth.user.id, { contactId, senderId: auth.personId });
  const subject = renderEmailTemplate(tpl.subject, ctx);
  const body = renderEmailTemplate(tpl.body, ctx);
  return NextResponse.json({
    kind: tpl.kind,
    subject: subject.text,
    body: body.text,
    contactId,
    missing: [...new Set([...subject.missing, ...body.missing])],
  });
}

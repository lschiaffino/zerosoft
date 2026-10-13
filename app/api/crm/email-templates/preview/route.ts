import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { loadTemplateContext, renderEmailTemplate } from '@/lib/crm-email';
import { templatePreviewSchema } from '@/lib/crm-email-schema';
import { invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Render de subject/body con un contacto (y deal) + variables faltantes. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = templatePreviewSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const ctx = await loadTemplateContext(user.id, {
    contactId: parsed.data.contactId ?? null,
    dealId: parsed.data.dealId ?? null,
    senderId: realUserId(user),
  });
  const subject = renderEmailTemplate(parsed.data.subject ?? '', ctx);
  const rendered = renderEmailTemplate(parsed.data.body ?? '', ctx);
  return NextResponse.json({
    subject: subject.text,
    body: rendered.text,
    missing: [...new Set([...subject.missing, ...rendered.missing])],
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { aiEnabled, aiGenerateText, AiError } from '@/lib/ai';
import { getDb } from '@/lib/db';
import { loadTemplateContext } from '@/lib/crm-email';
import { aiDraftSchema } from '@/lib/crm-email-schema';
import { crmError, invalidBody, limitAction, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const INSTRUCTIONS = `You write short, plain-text B2B sales emails for a salesperson.
Rules: no subject line, no markdown, no placeholders like [Name]; 60-140 words; friendly and specific;
one clear call to action; sign off with the sender's first name. Write in the language of the
previous emails if there are any, otherwise in the language of the user's instructions.`;

/** Borrador de email con IA (contexto: contacto, company, deal y últimos emails). */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!aiEnabled()) return crmError(503, 'ai_disabled');
  const limited = await limitAction(realUserId(user), 'ai-draft', 30, 3600);
  if (limited) return limited;
  const body: unknown = await req.json().catch(() => null);
  const parsed = aiDraftSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const ctx = await loadTemplateContext(user.id, { contactId: parsed.data.contactId, senderId: realUserId(user) });
  if (!ctx.contact) return notFound();
  const recent = (await getDb()
    .prepare(
      `SELECT e.direction, e.subject, e.snippet FROM crm_emails e
       JOIN crm_email_contacts ec ON ec.email_id = e.id
       WHERE ec.user_id = ? AND ec.contact_id = ? ORDER BY e.sent_at DESC LIMIT 5`,
    )
    .all(user.id, parsed.data.contactId)) as Array<{ direction: string; subject: string; snippet: string }>;

  const prompt = [
    `Recipient: ${`${ctx.contact.first_name} ${ctx.contact.last_name}`.trim() || ctx.contact.email}${ctx.contact.job_title ? `, ${ctx.contact.job_title}` : ''}${ctx.company ? ` at ${ctx.company.name}` : ''}.`,
    ctx.deal ? `Open deal: ${ctx.deal.name}.` : '',
    `Sender: ${ctx.owner?.name || ctx.owner?.email || 'the salesperson'}.`,
    parsed.data.subject ? `Subject: ${parsed.data.subject}` : '',
    recent.length
      ? `Previous emails (newest first):\n${recent.map((r) => `- ${r.direction === 'in' ? 'From them' : 'From us'}: ${r.subject} — ${r.snippet}`).join('\n')}`
      : '',
    `What the email should do: ${parsed.data.instructions || 'a friendly follow-up to move the conversation forward'}`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const res = await aiGenerateText({
      workspaceId: user.id,
      feature: 'crm_email_draft',
      instructions: INSTRUCTIONS,
      prompt,
      maxOutputTokens: 600,
      temperature: 0.6,
    });
    return NextResponse.json({ body: res.text.trim() });
  } catch (err) {
    if (err instanceof AiError) return crmError(err.code === 'ai_disabled' ? 503 : 429, err.code);
    return crmError(502, 'ai_failed');
  }
}

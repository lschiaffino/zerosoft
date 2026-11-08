'use server';

import { redirect } from 'next/navigation';
import { isAdminEmail } from '@/lib/feedback';
import { appSender, sendEmail } from '@/lib/email';
import { lifecycleLinks } from '@/lib/lifecycle/scheduler';
import { renderLifecycleEmail, sampleRenderInput } from '@/lib/lifecycle/templates';
import { LIFECYCLE_TEMPLATES, TEMPLATE_CATEGORY, type LifecycleLocale, type LifecycleTemplate } from '@/lib/lifecycle/types';
import { siteUrl } from '@/lib/board-urls';
import { requireUser } from '@/lib/session';

/** Admin: manda una plantilla con datos de ejemplo a quien la pide (para verla en un cliente de correo real). */
export async function sendLifecycleTest(formData: FormData): Promise<void> {
  const locale = (['en', 'es', 'pt'] as const).find((l) => l === formData.get('locale')) ?? 'en';
  const user = await requireUser(locale);
  const me = user.actingUser ?? user;
  if (!isAdminEmail(me.email)) redirect(`/${locale}/app`);
  const raw = String(formData.get('template') ?? '');
  const template: LifecycleTemplate = (LIFECYCLE_TEMPLATES as readonly string[]).includes(raw) ? (raw as LifecycleTemplate) : 'welcome';
  const mailLocale = (['en', 'es', 'pt'] as const).find((l) => l === formData.get('mailLocale')) ?? (locale as LifecycleLocale);
  const links = lifecycleLinks(me.id, TEMPLATE_CATEGORY[template], mailLocale);
  const email = renderLifecycleEmail({
    ...sampleRenderInput(template, mailLocale, siteUrl()),
    email: me.email,
    name: me.name,
    unsubscribeUrl: links.unsubscribeUrl,
    unsubscribeAllUrl: links.unsubscribeAllUrl,
    preferencesUrl: links.preferencesUrl,
  });
  const res = await sendEmail({
    to: me.email,
    from: appSender(),
    subject: `[test] ${email.subject}`,
    text: email.text,
    html: email.html,
    headers: { 'List-Unsubscribe': `<${links.oneClickUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  });
  const qs = new URLSearchParams({
    template,
    lang: mailLocale,
    theme: String(formData.get('theme') ?? 'light'),
    width: String(formData.get('width') ?? '600'),
    ...(res.ok ? { sent: '1' } : { error: res.error ?? 'send_error' }),
  });
  redirect(`/${locale}/app/settings/lifecycle?${qs.toString()}`);
}

/**
 * People: avisos por email a personas del workspace. El texto es fijo: no lleva
 * nombres, fechas ni tipo de licencia, solo un link a la app (donde se ve con
 * permisos). Un tope por persona y una clave por evento: dos corridas no mandan
 * dos veces. Nunca tira.
 */
import { appSender, sendEmail } from './email';
import { getDb } from './db';
import { rateLimit } from './rate-limit';
import { seedLocale } from './seed-locale';

type Kind = 'timeoff_request' | 'timeoff_approved' | 'timeoff_declined';

const COPY: Record<'en' | 'es' | 'pt', Record<Kind, string>> = {
  en: { timeoff_request: 'A time off request is waiting for your decision', timeoff_approved: 'Your time off request was approved', timeoff_declined: 'Your time off request was declined' },
  es: { timeoff_request: 'Hay un pedido de licencia esperando tu decisión', timeoff_approved: 'Aprobaron tu pedido de licencia', timeoff_declined: 'Rechazaron tu pedido de licencia' },
  pt: { timeoff_request: 'Há um pedido de folga aguardando sua decisão', timeoff_approved: 'Seu pedido de folga foi aprovado', timeoff_declined: 'Seu pedido de folga foi recusado' },
};

const OPEN: Record<'en' | 'es' | 'pt', string> = { en: 'Open it in People', es: 'Abrilo en People', pt: 'Abra no People' };

const DAILY_CAP = 40;

export async function emailPeople(userIds: Array<string | null | undefined>, kind: Kind, eventId: string): Promise<void> {
  const ids = [...new Set(userIds.filter((x): x is string => Boolean(x)))];
  const base = (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
  for (const id of ids) {
    try {
      const u = (await getDb().prepare('SELECT email FROM users WHERE id = ?').get(id)) as { email: string } | undefined;
      if (!u?.email) continue;
      if (!(await rateLimit(`people:mail:${id}`, DAILY_CAP, 86_400)).ok) continue;
      const lang = await seedLocale();
      const href = `${base}/${lang}/app/people/time-off${kind === 'timeoff_request' ? '?tab=approvals' : ''}`;
      await sendEmail({
        to: u.email,
        from: appSender(),
        subject: COPY[lang][kind],
        text: `${COPY[lang][kind]}.\n\n${OPEN[lang]}: ${href}`,
        idempotencyKey: `people:${kind}:${eventId}:${id}`,
      });
    } catch (err) {
      console.error('[people] email failed', err instanceof Error ? err.message : 'error');
    }
  }
}

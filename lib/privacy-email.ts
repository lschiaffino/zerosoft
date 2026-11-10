/**
 * Aviso por email de un borrado pedido (cuenta o workspace): si no lo pidió la persona, se
 * entera y entra a cancelarlo. Server-only.
 */
import type { UserRow } from './db';
import { appSender, escapeHtml, renderBrandedHtml, sendEmail } from './email';

type Lang = 'en' | 'es' | 'pt';

const COPY: Record<Lang, { subject: Record<'account' | 'workspace', string>; body: (kind: 'account' | 'workspace', date: string) => string[]; cta: string }> = {
  en: {
    subject: { account: 'Your zerosoft account will be deleted', workspace: 'Your zerosoft workspace will be deleted' },
    body: (kind, date) => [
      kind === 'account'
        ? `You asked to delete your zerosoft account and the workspace you own. Everything will be erased on ${date}.`
        : `You asked to delete your zerosoft workspace. Everything in it will be erased on ${date}.`,
      'Until then you can download your data or cancel in Settings. If you did not ask for this, sign in and cancel it, then sign out of your other sessions in Settings › Security.',
    ],
    cta: 'Open settings',
  },
  es: {
    subject: { account: 'Tu cuenta de zerosoft se va a borrar', workspace: 'Tu workspace de zerosoft se va a borrar' },
    body: (kind, date) => [
      kind === 'account'
        ? `Pediste borrar tu cuenta de zerosoft y el workspace del que sos owner. Todo se borra el ${date}.`
        : `Pediste borrar tu workspace de zerosoft. Todo lo que tiene se borra el ${date}.`,
      'Hasta entonces podés descargar tus datos o cancelar en Ajustes. Si no lo pediste vos, entrá y cancelalo, y después cerrá tus otras sesiones en Ajustes › Seguridad.',
    ],
    cta: 'Abrir ajustes',
  },
  pt: {
    subject: { account: 'Sua conta da zerosoft será excluída', workspace: 'Seu workspace da zerosoft será excluído' },
    body: (kind, date) => [
      kind === 'account'
        ? `Você pediu para excluir sua conta da zerosoft e o workspace do qual é dono. Tudo será apagado em ${date}.`
        : `Você pediu para excluir seu workspace da zerosoft. Tudo o que ele tem será apagado em ${date}.`,
      'Até lá você pode baixar seus dados ou cancelar em Configurações. Se não foi você, entre e cancele, e depois encerre suas outras sessões em Configurações › Segurança.',
    ],
    cta: 'Abrir configurações',
  },
};

export async function sendErasureNotice(user: UserRow, kind: 'account' | 'workspace', dueAt: string): Promise<void> {
  const l: Lang = user.locale === 'es' || user.locale === 'pt' ? user.locale : 'en';
  const c = COPY[l];
  const date = new Date(dueAt).toLocaleDateString(l, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const base = (process.env.NEXTAUTH_URL || 'https://zerosoft.ai').replace(/\/$/, '');
  const link = `${base}/${l}/app/settings${kind === 'workspace' ? '/workspace' : ''}`;
  const paragraphs = c.body(kind, date);
  await sendEmail({
    to: user.email,
    from: appSender(),
    subject: c.subject[kind],
    text: `${paragraphs.join('\n\n')}\n\n${c.cta}: ${link}\n`,
    html: renderBrandedHtml({
      heading: c.subject[kind],
      eyebrow: 'zerosoft',
      paragraphs: [...paragraphs.map(escapeHtml), `<a href="${escapeHtml(link)}">${escapeHtml(c.cta)}</a>`],
    }),
  });
}

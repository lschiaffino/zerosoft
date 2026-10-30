import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import ClientMessages from '@/components/i18n/ClientMessages';
import SigningRoom from '@/components/sign/SigningRoom';
import { markViewed, publicView, resolveToken, sessionCookieName, sessionValid } from '@/lib/sign/signing';
import { TOKEN_RE } from '@/lib/sign/types';
import { clientIp } from '@/lib/rate-limit';
import '@/styles/sign.css';
import '@/styles/esign.css';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; token: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'sign.public' });
  // El link es personal: ni índice ni referer con el token.
  return { title: t('metaTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

/** Firma pública de Sign: el destinatario firma con su link, sin cuenta. */
export default async function SignPublicPage(props: Props) {
  const { locale, token } = await props.params;
  setRequestLocale(locale);
  if (!TOKEN_RE.test(token)) notFound();
  const r = await resolveToken(token);
  if (!r) notFound();
  const jar = await cookies();
  const sessionOk = sessionValid(r.recipient, jar.get(sessionCookieName(r.recipient.id))?.value);
  const view = await publicView(r, sessionOk);
  if (view.state === 'ready') {
    const h = await headers();
    // Misma regla de IP que las rutas (proxy de confianza, ver lib/rate-limit.ts).
    const ip = clientIp(new Request('http://local/', { headers: h }));
    await markViewed(r, { ip, ua: (h.get('user-agent') ?? '').slice(0, 300) }).catch(() => undefined);
  }
  return (
    <ClientMessages locale={locale} namespaces={['sign']}>
      <SigningRoom token={token} initial={view} />
    </ClientMessages>
  );
}

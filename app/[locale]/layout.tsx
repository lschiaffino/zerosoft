import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { Space_Grotesk, IBM_Plex_Mono } from 'next/font/google';
import { routing } from '@/i18n/routing';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import ChromeGate from '@/components/ChromeGate';
import SupportWidget from '@/components/SupportWidget';
import { supportWidgetId } from '@/lib/support';
import type { ReactNode } from 'react';

const sans = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const {
    locale
  } = params;

  const t = await getTranslations({ locale, namespace: 'common.meta' });
  return {
    title: {
      default: 'Zerosoft — ' + t('tagline'),
      template: '%s — Zerosoft',
    },
    description: t('description'),
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
    // Favicon y apple-icon: app/icon.svg y app/apple-icon.tsx (el cero de lib/zero-mark.ts).
  };
}

export default async function LocaleLayout(
  props: {
    children: ReactNode;
    params: Promise<{ locale: string }>;
  }
) {
  const params = await props.params;

  const {
    locale
  } = params;

  const {
    children
  } = props;

  setRequestLocale(locale);
  const messages = await getMessages();
  const supportId = supportWidgetId();

  return (
    <html lang={locale} className={`${sans.variable} ${mono.variable}`}>
      <body>
        <NextIntlClientProvider messages={messages}>
          <ChromeGate
            header={<Header locale={locale} />}
            footer={<Footer locale={locale} />}
            support={supportId ? <SupportWidget widgetId={supportId} /> : null}
          >
            {children}
          </ChromeGate>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

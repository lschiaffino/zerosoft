import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { Space_Grotesk, IBM_Plex_Mono } from 'next/font/google';
import { routing } from '@/i18n/routing';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
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

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }) {
  const t = await getTranslations({ locale, namespace: 'common.meta' });
  return {
    title: {
      default: 'Zerosoft — ' + t('tagline'),
      template: '%s — Zerosoft',
    },
    description: t('description'),
    icons: {
      icon:
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext x='50' y='82' font-size='96' text-anchor='middle' font-family='monospace'%3E0%3C/text%3E%3C/svg%3E",
    },
  };
}

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale} className={`${sans.variable} ${mono.variable}`}>
      <body>
        <NextIntlClientProvider messages={messages}>
          <Header locale={locale} />
          {children}
          <Footer locale={locale} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

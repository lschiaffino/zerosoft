import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { Archivo, JetBrains_Mono } from 'next/font/google';
import { routing } from '@/i18n/routing';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import ChromeGate from '@/components/ChromeGate';
import SupportWidget from '@/components/SupportWidget';
import { supportWidgetId } from '@/lib/support';
import type { ReactNode } from 'react';

// Archivo variable con el eje de ancho (wdth 62–125): señalética angosta y UI normal.
const sans = Archivo({
  subsets: ['latin', 'latin-ext'],
  axes: ['wdth'],
  variable: '--font-archivo',
  display: 'swap',
});

// JetBrains Mono: solo datos (cero con barra vía la clase .data de styles/brand.css).
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
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
      default: 'zerosoft · ' + t('tagline'),
      template: '%s · zerosoft',
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

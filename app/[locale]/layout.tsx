import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { Archivo, IBM_Plex_Mono, JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import { routing } from '@/i18n/routing';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import ChromeGate from '@/components/ChromeGate';
import SupportWidget from '@/components/SupportWidget';
import FeedbackLauncher from '@/components/FeedbackLauncher';
import { supportWidgetId } from '@/lib/support';
import { surfaceForHost } from '@/lib/host-rewrite';
import { headers } from 'next/headers';
import BrandProvider from '@/components/brand/BrandProvider';
import { getBrandTheme } from '@/lib/brand-theme-server';
import '@/styles/board-public.css';
import type { ReactNode } from 'react';

// Marca default: Space Grotesk (texto y títulos) e IBM Plex Mono (datos, rótulos).
const sans = Space_Grotesk({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

// Tema subte (opcional, html[data-brand="subte"]): Archivo con eje de ancho y
// JetBrains Mono. Sin preload: el navegador solo las baja si el tema las usa.
const subteSans = Archivo({
  subsets: ['latin', 'latin-ext'],
  axes: ['wdth'],
  variable: '--font-archivo',
  display: 'swap',
  preload: false,
});

const subteMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
  preload: false,
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
  // feedback.zerosoft.ai / branding.zerosoft.ai: chrome propio (ver ChromeGate).
  // El layout ya es dinámico (el Header lee la sesión), leer el host no cambia eso.
  const surface = surfaceForHost((await headers()).get('host'));
  // Tema de marca: cookie zs_brand (?brand=subte) o el que fuerce la ruta.
  const brand = await getBrandTheme();

  return (
    <html
      lang={locale}
      data-brand={brand}
      className={`${sans.variable} ${mono.variable} ${subteSans.variable} ${subteMono.variable}`}
    >
      <body>
        <BrandProvider brand={brand}>
        <NextIntlClientProvider messages={messages}>
          <ChromeGate
            header={<Header locale={locale} />}
            footer={<Footer locale={locale} />}
            support={supportId ? <SupportWidget widgetId={supportId} /> : null}
            launcher={<FeedbackLauncher locale={locale} hasSupport={Boolean(supportId)} />}
            surface={surface}
          >
            {children}
          </ChromeGate>
        </NextIntlClientProvider>
        </BrandProvider>
      </body>
    </html>
  );
}

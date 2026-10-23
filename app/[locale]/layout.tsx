import { getTranslations, setRequestLocale } from 'next-intl/server';
import { IBM_Plex_Mono, Space_Grotesk } from 'next/font/google';
import { routing } from '@/i18n/routing';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import ChromeGate from '@/components/ChromeGate';
import SupportWidget from '@/components/SupportWidget';
import FeedbackLauncher from '@/components/FeedbackLauncher';
import { supportWidgetId } from '@/lib/support';
import { surfaceForHost } from '@/lib/host-rewrite';
import { headers } from 'next/headers';
import ClientMessages from '@/components/i18n/ClientMessages';
import BrandProvider from '@/components/brand/BrandProvider';
import { getBrandTheme } from '@/lib/brand-theme-server';
import ThemeProvider from '@/components/theme/ThemeProvider';
import { getThemePref } from '@/lib/color-theme-server';
import { themeAttr } from '@/lib/color-theme';
import { TZ_COOKIE_SCRIPT } from '@/lib/tz-client';
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
  const supportId = supportWidgetId();
  // feedback.zerosoft.ai / branding.zerosoft.ai: chrome propio (ver ChromeGate).
  // El layout ya es dinámico (el Header lee la sesión), leer el host no cambia eso.
  const surface = surfaceForHost((await headers()).get('host'));
  // Tema de marca (hoy solo default; ver lib/brand-theme.ts).
  const brand = await getBrandTheme();
  // Modo de color: cookie zs_theme (light/dark); sin cookie sigue al sistema.
  const themePref = await getThemePref();

  return (
    <html
      lang={locale}
      data-brand={brand}
      data-theme={themeAttr(themePref)}
      className={`${sans.variable} ${mono.variable}`}
    >
      <head>
        {/* Cookie tz antes de hidratar y del primer request a la app (ver lib/tz-client.ts). */}
        <script dangerouslySetInnerHTML={{ __html: TZ_COOKIE_SCRIPT }} />
      </head>
      <body>
        <BrandProvider brand={brand}>
        <ThemeProvider initial={themePref}>
        {/* Al cliente va solo lo común (header, launcher de feedback); cada app
            y página pública suma sus namespaces en su layout. */}
        <ClientMessages root locale={locale} namespaces={['common', 'feedback.form', 'feedbackBoard']}>
          <ChromeGate
            header={<Header locale={locale} />}
            footer={<Footer locale={locale} />}
            support={supportId ? <SupportWidget widgetId={supportId} /> : null}
            launcher={<FeedbackLauncher locale={locale} hasSupport={Boolean(supportId)} />}
            surface={surface}
          >
            {children}
          </ChromeGate>
        </ClientMessages>
        </ThemeProvider>
        </BrandProvider>
      </body>
    </html>
  );
}

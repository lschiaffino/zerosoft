import type { Viewport } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { IBM_Plex_Mono, Space_Grotesk } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { routing } from '@/i18n/routing';
import { homeOgImage, siteOrigin, siteVerification } from '@/lib/seo';
import { ogImages, ogUrl } from '@/lib/og/url';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import ChromeGate from '@/components/ChromeGate';
import SupportWidget from '@/components/SupportWidget';
import { WorkspaceNoticeOutsideApp } from '@/components/app/WorkspaceGuard';
import FeedbackLauncher from '@/components/FeedbackLauncher';
import { supportWidgetId } from '@/lib/support';
import ClientMessages from '@/components/i18n/ClientMessages';
import BrandProvider from '@/components/brand/BrandProvider';
import { DEFAULT_BRAND } from '@/lib/brand-theme';
import ThemeProvider from '@/components/theme/ThemeProvider';
import { THEME_INIT_SCRIPT } from '@/lib/color-theme';
import { SESSION_HINT_SCRIPT } from '@/lib/session-hint';
import { localeCookieScript } from '@/lib/locale-cookie';
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
  // Sin preload: es la fuente de datos y rótulos. Precargada, sus dos archivos
  // ocupaban conexiones antes que el CSS que bloquea el render y demoraban el
  // primer paint (medido con un A/B intercalado). Tiene fallback ajustado.
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

  if (!hasLocale(routing.locales, locale)) return {};

  const t = await getTranslations({ locale, namespace: 'common.meta' });
  return {
    title: {
      default: 'zerosoft · ' + t('tagline'),
      template: '%s · zerosoft',
    },
    description: t('description'),
    // Sin NEXT_PUBLIC_SITE_URL, el dominio de producción: un canonical a localhost desindexaría el sitio.
    metadataBase: new URL(siteOrigin()),
    // Verificación de Search Console y Bing Webmaster Tools por meta tag (docs/seo.md).
    verification: siteVerification(),
    // Título y descripción los completa Next con los de cada página; la que quiere otra imagen pone su openGraph.
    openGraph: {
      type: 'website',
      siteName: 'zerosoft',
      locale: { en: 'en_US', es: 'es_AR', pt: 'pt_BR' }[locale] ?? 'en_US',
      images: ogImages(homeOgImage(locale), t('tagline'), [t('tagline')]),
    },
    twitter: { card: 'summary_large_image', images: [{ url: ogUrl(homeOgImage(locale), [t('tagline')]), alt: t('tagline') }] },
    // Favicon y apple-icon: app/icon.svg y app/apple-icon.tsx (el cero de lib/zero-mark.ts).
  };
}

/**
 * Android (Chrome): con el teclado abierto la página se achica (como WhatsApp, el chat queda arriba
 * del teclado). iOS lo resuelve components/app/KeyboardViewport.tsx.
 */
export const viewport: Viewport = { width: 'device-width', initialScale: 1, interactiveWidget: 'resizes-content' };

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

  // /wp-login.php y cualquier otra raíz con punto llegan acá sin pasar por el middleware.
  if (!hasLocale(routing.locales, locale)) notFound();

  const {
    children
  } = props;

  setRequestLocale(locale);
  const supportId = supportWidgetId();
  // Este layout no lee la request (ni cookies, ni headers, ni la sesión): así
  // las páginas del sitio salen estáticas del CDN. Lo que depende de la
  // request se resuelve en otro lado:
  // - modo de color: THEME_INIT_SCRIPT antes del primer paint (cookie zs_theme);
  // - chrome de feedback.zerosoft.ai, branding.zerosoft.ai y los sitios de Docs:
  //   ChromeGate mira la ruta real (reescrita por el middleware);
  // - el header logueado: HeaderClient, con la cookie zs_who.
  // Tema de marca: hoy solo default (ver lib/brand-theme.ts).
  const brand = DEFAULT_BRAND;

  return (
    // data-theme lo pone el script antes de hidratar: no es un desajuste.
    <html lang={locale} data-brand={brand} className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT + SESSION_HINT_SCRIPT + localeCookieScript(locale) }} />
        <BrandProvider brand={brand}>
        <ThemeProvider>
        {/* Al cliente va solo lo común (header, launcher de feedback); cada app
            y página pública suma sus namespaces en su layout. */}
        <WorkspaceNoticeOutsideApp />
        <ClientMessages root locale={locale} namespaces={['common', 'feedback.form', 'feedbackBoard']}>
          <ChromeGate
            header={<Header locale={locale} />}
            footer={<Footer locale={locale} />}
            support={supportId ? <SupportWidget widgetId={supportId} /> : null}
            launcher={<FeedbackLauncher locale={locale} hasSupport={Boolean(supportId)} />}
          >
            {children}
          </ChromeGate>
        </ClientMessages>
        </ThemeProvider>
        </BrandProvider>
        {/* Cookie tz antes del primer request a la app (ver lib/tz-client.ts). Al
            final del body: en el <head> quedaba detrás del CSS y frenaba el parseo. */}
        <script dangerouslySetInnerHTML={{ __html: TZ_COOKIE_SCRIPT }} />
      </body>
    </html>
  );
}

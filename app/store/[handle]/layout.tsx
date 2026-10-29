import type { CSSProperties, ReactNode } from 'react';
import { publishedStore } from '@/lib/shop-storefront';
import { storefrontStrings } from '@/lib/shop-i18n';
import StoreHeader from '@/components/shop/store/StoreHeader';
import StoreFooter from '@/components/shop/store/StoreFooter';
import '@/styles/store.css';

export const revalidate = 300;

const FONTS: Record<string, string> = {
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  rounded: "ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, sans-serif",
};

/**
 * Tienda pública de Shop (/store/<handle>). Su propio <html>: idioma de la
 * tienda, tema claro y los colores, fuente y logo de su marca. Sin el chrome
 * del sitio ni de la app.
 */
export default async function StoreLayout(props: { children: ReactNode; params: Promise<{ handle: string }> }) {
  const { handle } = await props.params;
  const store = await publishedStore(handle);
  const locale = store?.dto.locale ?? 'en';
  const t = storefrontStrings(locale);
  const brand = store?.dto.brand;
  const style = {
    '--sf-primary': brand?.primary ?? '#111111',
    '--sf-accent': brand?.accent ?? '#2f6bff',
    '--sf-font': FONTS[brand?.font ?? 'sans'] ?? FONTS.sans,
  } as CSSProperties;
  return (
    <html lang={locale} data-theme="light">
      <body className={`sf sf-theme-${store?.dto.theme ?? 'classic'}`} style={style}>
        <a className="sf-skip" href="#sf-main">
          {t.skip}
        </a>
        {store && <StoreHeader store={store} t={t} />}
        <main id="sf-main" className="sf-main">
          {props.children}
        </main>
        {store && <StoreFooter store={store} t={t} />}
      </body>
    </html>
  );
}

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { publishedStore, storefrontCollection, storefrontHome, storefrontProduct, type PublicStore } from '@/lib/shop-storefront';
import { storefrontStrings } from '@/lib/shop-i18n';
import { isZeroDecimalCurrency } from '@/lib/shop-money';
import ProductGrid from '@/components/shop/store/ProductGrid';
import ProductView from '@/components/shop/store/ProductView';
import CartView from '@/components/shop/store/CartView';
import CheckoutView from '@/components/shop/store/CheckoutView';
import SearchView from '@/components/shop/store/SearchView';
import OrderLookup from '@/components/shop/store/OrderLookup';
import OrderStatus from '@/components/shop/store/OrderStatus';
import ViewBeacon from '@/components/shop/store/ViewBeacon';

/**
 * Tienda pública: portada, colección, producto, carrito, checkout, búsqueda
 * y estado del pedido en una sola ruta (presupuesto de rutas). Las páginas de
 * catálogo se generan una vez y se regeneran cuando el comercio cambia algo
 * (revalidatePath en lib/shop.ts) o a los 5 minutos; lo que depende del
 * visitante (carrito, pedido) se arma en el navegador contra la API.
 */
export const revalidate = 300;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

type Params = { handle: string; path?: string[] };

const SEG = /^[a-z0-9][a-z0-9-]{0,63}$/;

function appBase(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

function abs(url: string): string {
  return url.startsWith('/') ? `${appBase()}${url}` : url;
}

export async function generateMetadata(props: { params: Promise<Params> }): Promise<Metadata> {
  const { handle, path = [] } = await props.params;
  const store = await publishedStore(handle);
  if (!store) return { robots: { index: false } };
  const t = storefrontStrings(store.dto.locale);
  const canonical = `${appBase()}/store/${store.dto.handle}${path.length ? `/${path.join('/')}` : ''}`;
  const site = store.dto.name;
  const base: Metadata = { alternates: { canonical }, openGraph: { siteName: site, url: canonical } };
  const [kind, slug] = path;
  if (kind === 'products' && slug && SEG.test(slug)) {
    const p = await storefrontProduct(store.row, slug);
    if (!p) return { title: site };
    const description = p.seoDescription || p.descriptionText.slice(0, 160) || undefined;
    return {
      ...base,
      title: `${p.seoTitle || p.title} · ${site}`,
      description,
      openGraph: { ...base.openGraph, type: 'website', title: p.seoTitle || p.title, description, images: p.images.slice(0, 1).map(abs) },
    };
  }
  if (kind === 'collections' && slug && SEG.test(slug)) {
    const c = await storefrontCollection(store.row.workspace_id, slug);
    return { ...base, title: c ? `${c.collection.title} · ${site}` : site };
  }
  const titles: Record<string, string> = { cart: t.cartTitle, checkout: t.checkoutTitle, search: t.searchTitle, orders: t.orderStatus };
  if (kind && titles[kind]) return { title: `${titles[kind]} · ${site}`, robots: { index: false } };
  return {
    ...base,
    title: site,
    description: store.dto.brand.heroText || undefined,
    openGraph: { ...base.openGraph, title: site, images: store.dto.brand.logoUrl ? [abs(store.dto.brand.logoUrl)] : undefined },
  };
}

/** JSON-LD de Product (Google): nombre, fotos, SKU, marca y una oferta por variante. */
function productJsonLd(store: PublicStore, p: NonNullable<Awaited<ReturnType<typeof storefrontProduct>>>) {
  const url = `${appBase()}/store/${store.dto.handle}/products/${p.handle}`;
  const price = (c: number) => (isZeroDecimalCurrency(store.dto.currency) ? String(Math.round(c / 100)) : (c / 100).toFixed(2));
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.title,
    description: p.descriptionText || undefined,
    image: p.images.map(abs),
    sku: p.variants[0]?.sku || undefined,
    brand: p.vendor ? { '@type': 'Brand', name: p.vendor } : undefined,
    offers: p.variants.map((v) => ({
      '@type': 'Offer',
      url,
      sku: v.sku || undefined,
      name: v.title !== 'Default' ? v.title : undefined,
      price: price(v.priceCents),
      priceCurrency: store.dto.currency,
      availability: v.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    })),
  };
  // Sin "<" crudo: el JSON no puede cerrar el <script>.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export default async function StorePage(props: { params: Promise<Params> }) {
  const { handle, path = [] } = await props.params;
  const store = await publishedStore(handle);
  if (!store) notFound();
  const t = storefrontStrings(store.dto.locale);
  const h = store.dto.handle;
  const { currency, locale } = store.dto;
  const [kind, slug, extra] = path;
  if (extra !== undefined) notFound();

  if (!kind) {
    const home = await storefrontHome(store.row.workspace_id);
    const brand = store.dto.brand;
    return (
      <>
        <ViewBeacon handle={h} />
        <section className="sf-hero">
          <h1 className="sf-hero-title">{brand.heroTitle || store.dto.name}</h1>
          {brand.heroText && <p className="sf-hero-text">{brand.heroText}</p>}
        </section>
        {home.featured.map((f) => (
          <section key={f.collection.id} className="sf-section">
            <div className="sf-section-head">
              <h2 className="sf-h2">{f.collection.title}</h2>
              <Link href={`/store/${h}/collections/${f.collection.handle}`}>{t.viewAll}</Link>
            </div>
            <ProductGrid handle={h} products={f.products} currency={currency} locale={locale} t={t} />
          </section>
        ))}
        <section className="sf-section">
          <h2 className="sf-h2">{t.allProducts}</h2>
          {home.latest.length ? (
            <ProductGrid handle={h} products={home.latest} currency={currency} locale={locale} t={t} />
          ) : (
            <p className="sf-muted">{t.noProducts}</p>
          )}
        </section>
      </>
    );
  }

  if (kind === 'products' && slug && SEG.test(slug)) {
    const product = await storefrontProduct(store.row, slug);
    if (!product) notFound();
    return (
      <>
        <ViewBeacon handle={h} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: productJsonLd(store, product) }} />
        <ProductView handle={h} product={product} currency={currency} locale={locale} t={t} />
      </>
    );
  }

  if (kind === 'collections' && slug && SEG.test(slug)) {
    const c = await storefrontCollection(store.row.workspace_id, slug);
    if (!c) notFound();
    return (
      <section className="sf-section">
        <ViewBeacon handle={h} />
        <h1 className="sf-h1">{c.collection.title}</h1>
        {c.collection.descriptionHtml && <div className="sf-desc" dangerouslySetInnerHTML={{ __html: c.collection.descriptionHtml }} />}
        {c.products.length ? <ProductGrid handle={h} products={c.products} currency={currency} locale={locale} t={t} /> : <p className="sf-muted">{t.noProducts}</p>}
      </section>
    );
  }

  if (kind === 'cart' && !slug) return <CartView handle={h} locale={locale} t={t} />;
  if (kind === 'checkout' && !slug) return <CheckoutView handle={h} locale={locale} t={t} manualLabel={store.manualLabel} />;
  if (kind === 'search' && !slug) {
    return (
      <Suspense>
        <SearchView handle={h} currency={currency} locale={locale} t={t} />
      </Suspense>
    );
  }
  if (kind === 'orders' && !slug) return <OrderLookup handle={h} t={t} />;
  if (kind === 'orders' && slug && /^[A-Za-z0-9_-]{16,64}$/.test(slug)) {
    return (
      <Suspense>
        <OrderStatus handle={h} token={slug} locale={locale} t={t} />
      </Suspense>
    );
  }
  notFound();
}

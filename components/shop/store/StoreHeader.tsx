import Link from 'next/link';
import { storefrontCollections, type PublicStore } from '@/lib/shop-storefront';
import type { StorefrontStrings } from '@/lib/shop-i18n';
import CartBadge from './CartBadge';

/** Cabecera de la tienda: aviso, logo o nombre, colecciones, búsqueda, pedido y carrito. */
export default async function StoreHeader({ store, t }: { store: PublicStore; t: StorefrontStrings }) {
  const base = `/store/${store.dto.handle}`;
  const collections = (await storefrontCollections(store.row.workspace_id)).slice(0, 6);
  const brand = store.dto.brand;
  return (
    <header className="sf-header">
      {brand.announcement && <p className="sf-announce">{brand.announcement}</p>}
      <div className="sf-bar">
        <Link href={base} className="sf-logo">
          {brand.logoUrl ? <img src={brand.logoUrl} alt={store.dto.name} height={36} /> : <span>{store.dto.name}</span>}
        </Link>
        <nav className="sf-nav" aria-label={t.nav}>
          <Link href={base}>{t.home}</Link>
          {collections.map((c) => (
            <Link key={c.id} href={`${base}/collections/${c.handle}`}>
              {c.title}
            </Link>
          ))}
        </nav>
        <div className="sf-tools">
          <Link href={`${base}/search`} className="sf-tool" aria-label={t.search}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
          </Link>
          <CartBadge handle={store.dto.handle} label={t.cart} />
        </div>
      </div>
    </header>
  );
}

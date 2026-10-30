import Link from 'next/link';
import type { PublicStore } from '@/lib/shop-storefront';
import type { StorefrontStrings } from '@/lib/shop-i18n';

export default function StoreFooter({ store, t }: { store: PublicStore; t: StorefrontStrings }) {
  const base = `/store/${store.dto.handle}`;
  return (
    <footer className="sf-footer">
      <div className="sf-footer-inner">
        <div>
          <strong>{store.dto.name}</strong>
          {store.dto.contactEmail && (
            <p>
              <a href={`mailto:${store.dto.contactEmail}`}>{store.dto.contactEmail}</a>
            </p>
          )}
        </div>
        <nav aria-label={t.footerNav}>
          <Link href={`${base}/orders`}>{t.orderStatus}</Link>
          <Link href={`${base}/search`}>{t.search}</Link>
        </nav>
      </div>
      <p className="sf-powered">
        <a href="https://zerosoft.ai" target="_blank" rel="noreferrer">
          {t.poweredBy}
        </a>
      </p>
    </footer>
  );
}

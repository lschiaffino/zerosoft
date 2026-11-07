import Link from 'next/link';
import type { PublicStore } from '@/lib/shop-storefront';
import type { StorefrontStrings } from '@/lib/shop-i18n';
import { storefrontPages } from '@/lib/shop-pages';

export default async function StoreFooter({ store, t }: { store: PublicStore; t: StorefrontStrings }) {
  const base = `/store/${store.dto.handle}`;
  const [pages, articles] = await Promise.all([storefrontPages(store.row.workspace_id, 'page', 12), storefrontPages(store.row.workspace_id, 'article', 1)]);
  const whatsapp = store.dto.brand.whatsapp;
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
          {pages.map((p) => (
            <Link key={p.handle} href={`${base}/pages/${p.handle}`}>{p.title}</Link>
          ))}
          {articles.length > 0 && <Link href={`${base}/blog`}>{t.blog}</Link>}
          <Link href={`${base}/orders`}>{t.orderStatus}</Link>
          <Link href={`${base}/account`}>{t.accountTitle}</Link>
          <Link href={`${base}/search`}>{t.search}</Link>
        </nav>
      </div>
      {whatsapp && (
        <a className="sf-whatsapp" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer noopener" data-testid="sf-whatsapp">
          {t.whatsapp}
        </a>
      )}
      <p className="sf-powered">
        <a href="https://zerosoft.ai" target="_blank" rel="noreferrer">
          {t.poweredBy}
        </a>
      </p>
    </footer>
  );
}

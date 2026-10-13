import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { listProducts } from '@/lib/crm-products';
import { getCrmSettings } from '@/lib/crm-currency';
import ProductQuickCreate from '@/components/crm/ProductQuickCreate';
import ProductsTable from '@/components/crm/ProductsTable';

export const dynamic = 'force-dynamic';

interface ProductsPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(v: string | string[] | undefined): string {
  return typeof v === 'string' ? v : '';
}

/** Catálogo de productos: lo que se agrega como line item a los deals. */
export default async function ProductsPage(props: ProductsPageProps) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const q = one(sp.q).trim();
  const showArchived = one(sp.archived) === '1';
  const { rows, total } = await listProducts(user.id, {
    q: q || undefined,
    active: showArchived ? undefined : true,
    pageSize: 200,
  });
  const { baseCurrency } = await getCrmSettings(user.id);

  return (
    <div className="app-page">
      <div className="page-head">
        <div>
          <h1 className="app-title">{t('products.title')}</h1>
          <p className="muted app-sub">{t('products.subtitle')}</p>
        </div>
        <ProductQuickCreate defaultCurrency={baseCurrency} />
      </div>

      <form className="prod-toolbar" method="get">
        <input
          className="input"
          type="search"
          name="q"
          defaultValue={q}
          placeholder={t('products.search')}
          aria-label={t('products.search')}
        />
        {showArchived && <input type="hidden" name="archived" value="1" />}
        <Link
          href={{ pathname: '/app/crm/products', query: { ...(q ? { q } : {}), ...(showArchived ? {} : { archived: '1' }) } }}
          className="link-btn"
        >
          {showArchived ? t('products.hideArchived') : t('products.showArchived')}
        </Link>
        <span className="mono muted prod-count">{t('common.results', { count: total })}</span>
      </form>

      {rows.length === 0 ? (
        <div className="empty-state">
          <p className="empty-zeros mono" aria-hidden>
            0 0 0 0 0 0 0
          </p>
          <h2>{q ? t('products.emptySearch') : t('products.emptyTitle')}</h2>
          <p className="muted">{t('products.emptySub')}</p>
        </div>
      ) : (
        <ProductsTable
          rows={rows.map((p) => ({
            id: p.id,
            name: p.name,
            sku: p.sku,
            description: p.description,
            price: p.price,
            currency: p.currency,
            recurring: p.recurring,
            tax_pct: p.tax_pct,
            active: p.active,
          }))}
          locale={locale}
          defaultCurrency={baseCurrency}
        />
      )}
    </div>
  );
}

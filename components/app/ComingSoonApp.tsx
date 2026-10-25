import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { PRODUCT_CONFIG, type ProductKey } from '@/lib/products';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';

/**
 * Inicio de una app registrada que todavía se está construyendo (Voice, Rec,
 * Talk): dice que no hay nada para usar, sin fechas ni funciones prometidas,
 * y ofrece proponer una idea en el board público o leer el plan en la landing.
 */
export default async function ComingSoonApp({ locale, product }: { locale: string; product: ProductKey }) {
  const t = await getTranslations({ locale, namespace: 'common.appSoon' });
  const name = PRODUCT_CONFIG[product].name;
  return (
    <div className="app-page ui-page" data-testid="app-soon">
      <PageHeader title={name} description={t('desc', { app: name })} />
      <EmptyState
        product={product}
        title={t('title', { app: name })}
        body={t('body', { app: name })}
        action={{ label: t('propose'), href: `/feedback-board/new?product=${product}` }}
        secondary={
          <Link href={`/products/${product}`}>{t('plan', { app: name })}</Link>
        }
      />
    </div>
  );
}

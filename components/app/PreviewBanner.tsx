import { getTranslations } from 'next-intl/server';
import { PRODUCT_CONFIG, type ProductKey } from '@/lib/products';

/** Aviso arriba de una app "Próximamente" abierta por el staff: no es lo que ven los clientes. */
export default async function PreviewBanner({ app, locale }: { app: ProductKey; locale: string }) {
  const t = await getTranslations({ locale, namespace: 'common.comingSoon' });
  return (
    <p className="preview-banner" role="note" data-testid="preview-banner">
      <strong>{t('previewTag')}</strong>
      <span>{t('previewBanner', { name: PRODUCT_CONFIG[app].name })}</span>
    </p>
  );
}

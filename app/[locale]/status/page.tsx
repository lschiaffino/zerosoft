import { getTranslations, setRequestLocale } from 'next-intl/server';
import ProductGlyph from '@/components/brand/ProductGlyph';
import BrandSymbol from '@/components/brand/BrandSymbol';
import type { ProductKey } from '@/lib/products';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'pages.status' });
  return { title: t('meta.title'), description: t('meta.description') };
}

/** Los servicios de zerosoft.ai; los que son una app llevan su línea. */
const SERVICES: Array<{ id: string; product?: ProductKey }> = [
  { id: 's1', product: 'link' },
  { id: 's2', product: 'crm' },
  { id: 's3', product: 'track' },
  { id: 's4', product: 'cal' },
  { id: 's5', product: 'docs' },
  { id: 's6', product: 'chat' },
  { id: 's10', product: 'flow' },
  { id: 's9', product: 'agents' },
  { id: 's11', product: 'robots' },
  { id: 's12', product: 'notes' },
  { id: 's13', product: 'board' },
  { id: 's7' },
  { id: 's8' },
];

/**
 * Estado honesto: los servicios que forman zerosoft.ai y la aclaración de que
 * el monitoreo en vivo todavía no está conectado. Sin números de uptime ni
 * incidentes hasta que haya datos reales detrás.
 */
export default async function StatusPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'pages.status' });

  return (
    <main className="container">
      <header className="read-hero">
        <h1 className="read-title">{t('title')}</h1>
        <p className="read-intro">{t('sub')}</p>
      </header>

      <div className="read-body">
        <ul className="status-rows" aria-label={t('title')}>
          {SERVICES.map((s) => (
            <li className="status-row" key={s.id}>
              <span className="status-name">
                {s.product ? <ProductGlyph product={s.product} size={12} onLine /> : <BrandSymbol size={12} />}
                {t(`${s.id}.name`)}
              </span>
              <span className="status-desc">{t(`${s.id}.desc`)}</span>
              <span className="status-val">{t('noData')}</span>
            </li>
          ))}
        </ul>

        <div className="status-note-block">
          <h2>{t('monitoringTitle')}</h2>
          <p>{t('monitoringBody')}</p>
          <p>{t('contact')}</p>
        </div>
      </div>
    </main>
  );
}

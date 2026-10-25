import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import Icon from './Icon';
import ProductGlyph from '@/components/brand/ProductGlyph';
import { CATEGORY_PRODUCTS, PRODUCT_NAMES, RIVALS } from './catalog';
import type { ProductKey } from '@/lib/products';

/**
 * La suite por categoría (vender, atender, automatizar, construir, trabajo
 * diario), con una nota arriba: todas sirven para equipos y para uso
 * personal. Una lista de filas finas
 * (sin tarjetas). Cada app con su cero de color, el nombre en señalética,
 * qué hace y lo que reemplaza. Home y /products. En /products, `parity` suma
 * el porcentaje de paridad contra el competidor (content/feature-parity).
 */
export default function SuiteGrid({
  cta,
  parity,
}: {
  cta?: { label: string; href: string };
  parity?: Partial<Record<ProductKey, string>>;
}) {
  const h = useTranslations('common.home');
  const c = useTranslations('common.categories');
  return (
    <div className="suite">
      <div className="suite-audience">
        <p className="suite-audience-title">{h('suite.audienceTitle')}</p>
        <p className="suite-audience-desc">{h('suite.audienceDesc')}</p>
      </div>
      {CATEGORY_PRODUCTS.map(({ category, products }) => (
        <section key={category} className="suite-group" aria-labelledby={`suite-${category}`}>
          <header className="suite-group-head">
            <h3 id={`suite-${category}`}>{c(`${category}.title`)}</h3>
            <p>{c(`${category}.desc`)}</p>
          </header>
          <ul className="suite-rows">
            {products.map((k) => (
              <li key={k} className={`suite-row card-${k}`}>
                <Link href={`/products/${k}`} className="suite-row-link">
                  <ProductGlyph product={k} size={18} className="suite-glyph" />
                  <span className="suite-name">{PRODUCT_NAMES[k]}</span>
                  <span className="suite-line">{h(`suite.${k}.line`)}</span>
                  <span className="suite-vs">
                    {h('suite.replaces', { rival: RIVALS[k] })}
                    {parity?.[k] && <span className="suite-parity data">{parity[k]}</span>}
                  </span>
                  <Icon name="arrow" size={16} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {cta && (
        <div className="suite-foot">
          <p>
            <strong>{h('suite.one.title')}</strong> {h('suite.one.desc')}
          </p>
          <Link className="lp-textlink" href={cta.href}>
            {cta.label} <Icon name="arrow" size={14} />
          </Link>
        </div>
      )}
    </div>
  );
}

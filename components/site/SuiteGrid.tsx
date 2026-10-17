import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import Icon from './Icon';
import ProductGlyph from '@/components/brand/ProductGlyph';
import { AUDIENCE_PRODUCTS, PRODUCT_NAMES, RIVALS, type Audience } from './catalog';

const AUDIENCES: readonly Audience[] = ['teams', 'personal'];

/**
 * La suite dividida en "Para equipos" y "Para vos": una lista de filas finas
 * (sin tarjetas). Cada app es su línea: el tramo de color con su estación, el
 * nombre en señalética, qué hace y lo que reemplaza. Home y /products.
 */
export default function SuiteGrid({ cta }: { cta?: { label: string; href: string } }) {
  const h = useTranslations('common.home');
  return (
    <div className="suite">
      {AUDIENCES.map((a) => (
        <section key={a} className="suite-group" aria-labelledby={`suite-${a}`}>
          <header className="suite-group-head">
            <h3 id={`suite-${a}`}>{h(`suite.${a}Title`)}</h3>
            <p>{h(`suite.${a}Desc`)}</p>
          </header>
          <ul className="suite-rows">
            {AUDIENCE_PRODUCTS[a].map((k) => (
              <li key={k} className={`suite-row card-${k}`}>
                <Link href={`/products/${k}`} className="suite-row-link">
                  <ProductGlyph product={k} size={18} onLine className="suite-glyph" />
                  <span className="suite-name">{PRODUCT_NAMES[k]}</span>
                  <span className="suite-line">{h(`suite.${k}.line`)}</span>
                  <span className="suite-vs">{h('suite.replaces', { rival: RIVALS[k] })}</span>
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

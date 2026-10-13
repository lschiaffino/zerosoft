import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import Reveal from '@/components/Reveal';
import Icon from './Icon';
import { INCUMBENTS, PRODUCT_NAMES, SITE_PRODUCTS } from './catalog';

/** Las seis apps con su color, qué reemplazan y tres features clave (home y /products). */
export default function SuiteGrid({ cta }: { cta?: { label: string; href: string } }) {
  const h = useTranslations('common.home');
  return (
    <div className="suite-grid">
      {SITE_PRODUCTS.map((k) => (
        <Reveal as="article" key={k} className={`suite-card card-${k}`}>
          <Link href={`/products/${k}`} className="suite-card-link">
            <div className="suite-card-top">
              <span className="suite-icon" aria-hidden="true">
                0
              </span>
              <h3>{PRODUCT_NAMES[k]}</h3>
              <span className="suite-vs">{h('suite.vs', { rival: INCUMBENTS[k].rival })}</span>
            </div>
            <p className="suite-line">{h(`suite.${k}.line`)}</p>
            <ul className="suite-bullets">
              {(['b1', 'b2', 'b3'] as const).map((b) => (
                <li key={b}>
                  <Icon name="check" size={14} />
                  {h(`suite.${k}.${b}`)}
                </li>
              ))}
            </ul>
            <span className="suite-more">
              {h('suite.explore', { name: PRODUCT_NAMES[k] })} <Icon name="arrow" size={14} />
            </span>
          </Link>
        </Reveal>
      ))}
      <Reveal className="suite-one">
        <div className="suite-one-dots" aria-hidden="true">
          {SITE_PRODUCTS.map((k) => (
            <i key={k} className={`card-${k}`} />
          ))}
        </div>
        <div>
          <h3>{h('suite.one.title')}</h3>
          <p>{h('suite.one.desc')}</p>
        </div>
        {cta && (
          <Link className="btn btn-invert" href={cta.href}>
            {cta.label} <Icon name="arrow" size={14} />
          </Link>
        )}
      </Reveal>
    </div>
  );
}

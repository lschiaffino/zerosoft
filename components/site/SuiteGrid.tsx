import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import Reveal from '@/components/Reveal';
import Icon from './Icon';
import { AUDIENCE_PRODUCTS, INCUMBENTS, PRODUCT_NAMES, UPCOMING, type Audience } from './catalog';

const AUDIENCES: readonly Audience[] = ['teams', 'personal'];

/**
 * La suite dividida en "Para equipos" y "Para vos": una lista de filas finas
 * (sin tarjetas), cada app con su color, lo que reemplaza y su línea. Las que
 * están en construcción van al final, atenuadas y sin link. Home y /products.
 */
export default function SuiteGrid({ cta }: { cta?: { label: string; href: string } }) {
  const h = useTranslations('common.home');
  let n = 0;
  return (
    <div className="suite">
      {AUDIENCES.map((a) => (
        <Reveal as="section" key={a} className="suite-group" aria-labelledby={`suite-${a}`}>
          <header className="suite-group-head">
            <h3 id={`suite-${a}`}>{h(`suite.${a}Title`)}</h3>
            <p>{h(`suite.${a}Desc`)}</p>
          </header>
          <ul className="suite-rows">
            {AUDIENCE_PRODUCTS[a].map((k) => {
              n += 1;
              return (
                <li key={k} className={`suite-row card-${k}`}>
                  <Link href={`/products/${k}`} className="suite-row-link">
                    <span className="suite-num">{String(n).padStart(2, '0')}</span>
                    <span className="suite-name">{PRODUCT_NAMES[k]}</span>
                    <span className="suite-line">{h(`suite.${k}.line`)}</span>
                    <span className="suite-vs">{h('suite.replaces', { rival: INCUMBENTS[k].rival })}</span>
                    <Icon name="arrow" size={16} />
                  </Link>
                </li>
              );
            })}
            {UPCOMING.filter((u) => u.audience === a).map((u) => {
              n += 1;
              const inner = (
                <>
                  <span className="suite-num">{String(n).padStart(2, '0')}</span>
                  <span className="suite-name">{u.name}</span>
                  <span className="suite-line">{h(`suite.upcoming.${u.key}`)}</span>
                  <span className="suite-vs">{h('suite.replaces', { rival: u.rival })}</span>
                  <span className="suite-soon">{h(u.href ? 'suite.new' : 'suite.soon')}</span>
                </>
              );
              return (
                <li key={u.key} className={`suite-row ${u.href ? '' : 'is-soon '}card-${u.key}`}>
                  {u.href ? (
                    <Link href={u.href} className="suite-row-link">
                      {inner}
                    </Link>
                  ) : (
                    <div className="suite-row-link">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </Reveal>
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

import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import Icon from '@/components/site/Icon';
import { PARITY } from '@/content/feature-parity';
import type { ParityRow, ParityStatus } from '@/content/feature-parity/types';
import { computeAreas, computeParity, loc } from '@/lib/feature-parity';
import { PRODUCT_CONFIG, type ProductKey } from '@/lib/products';
import { ideaForCapability } from '@/lib/feature-parity-ideas';

/** Marca de cada estado, en mono: se lee en blanco y negro y con lector de pantalla va el texto. */
const MARK: Record<ParityStatus, string> = { have: '[x]', better: '[+]', partial: '[~]', missing: '[ ]' };

/**
 * Bloque de paridad de la página de producto: el porcentaje contra el
 * competidor (calculado de content/feature-parity/<product>.ts), las barras
 * por área, la tabla de todo lo incluido, lo que hacemos de más y lo que
 * todavía falta (con link al board para votar). Todo se renderiza en el
 * servidor, así que la tabla queda en el HTML.
 */
export default async function FeatureParity({ locale, product, headingId }: { locale: string; product: ProductKey; headingId: string }) {
  const t = await getTranslations({ locale, namespace: 'pages.product.parity' });
  const parity = PARITY[product];
  const name = PRODUCT_CONFIG[product].name;
  const competitor = parity.competitor;
  const score = computeParity(parity.rows);
  const areas = computeAreas(parity).filter((a) => a.counted > 0);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${parity.lastReviewed}T00:00:00Z`));

  const included = (r: ParityRow) => r.status !== 'missing';
  const beyond = parity.rows.filter((r) => r.status === 'better');
  const missing = parity.rows.filter((r) => r.status === 'missing');
  const statusLabel = (s: ParityStatus) => t(`status.${s}`);

  return (
    <div className="container parity">
      <div className="parity-head">
        <div className="parity-score">
          <p className="parity-kicker data">{t('kicker', { competitor })}</p>
          <p className="parity-num" aria-describedby={`${headingId}-method`}>
            <span className="data">{`${score.percent}%`}</span>
            <span className="parity-num-label">{t('ofCompetitor', { competitor })}</span>
          </p>
          <dl className="parity-counts">
            <div>
              <dt>{t('counts.have')}</dt>
              <dd className="data">{score.have}</dd>
            </div>
            <div>
              <dt>{t('counts.partial')}</dt>
              <dd className="data">{score.partial}</dd>
            </div>
            <div>
              <dt>{t('counts.missing')}</dt>
              <dd className="data">{score.missing}</dd>
            </div>
          </dl>
          <p className="parity-method" id={`${headingId}-method`}>
            {t('method', { count: score.counted, competitor, date })}{' '}
            <Link href="/changelog" className="parity-link">
              {t('changelog')}
            </Link>
          </p>
        </div>

        <ul className="parity-areas" aria-label={t('areasLabel')}>
          {areas.map((a) => (
            <li key={a.id} className="parity-area">
              <span className="parity-area-name">{loc(a.label, locale)}</span>
              <span className="parity-bar" aria-hidden="true">
                <i style={{ width: `${a.percent}%` }} />
              </span>
              <span className="parity-area-num data">{`${a.percent}%`}</span>
            </li>
          ))}
        </ul>
      </div>

      <h3 className="parity-h3">{t('tableTitle', { name })}</h3>
      <p className="parity-legend data">
        {(['have', 'better', 'partial'] as const).map((s) => (
          <span key={s}>
            {MARK[s]} {statusLabel(s)}
          </span>
        ))}
      </p>
      <div className="table-wrap parity-table-wrap">
        <table className="table parity-table">
          <caption className="sr-only">{t('tableCaption', { name, competitor })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('col.capability')}</th>
              <th scope="col">{name}</th>
              <th scope="col">{competitor}</th>
            </tr>
          </thead>
          {parity.areas.map((a) => {
            const rows = parity.rows.filter((r) => r.area === a.id && included(r));
            if (rows.length === 0) return null;
            return (
              <tbody key={a.id}>
                <tr className="parity-group">
                  <th scope="colgroup" colSpan={3}>
                    {loc(a.label, locale)}
                  </th>
                </tr>
                {rows.map((r) => (
                  <tr key={r.id} data-status={r.status}>
                    <th scope="row" className="parity-cap">
                      {loc(r.label, locale)}
                    </th>
                    <td className="parity-ours">
                      <span className={`parity-status parity-status--${r.status}`}>
                        <span className="data" aria-hidden="true">
                          {MARK[r.status]}
                        </span>{' '}
                        {statusLabel(r.status)}
                      </span>
                      {r.detail && <span className="parity-detail">{loc(r.detail, locale)}</span>}
                    </td>
                    <td className="parity-theirs">
                      <span className="parity-theirs-label">{competitor}: </span>
                      {r.competitorHas ? t('yes') : t('no')}
                    </td>
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>

      {beyond.length > 0 && (
        <section className="parity-beyond" aria-labelledby={`${headingId}-beyond`}>
          <h3 className="parity-h3" id={`${headingId}-beyond`}>
            {t('beyondTitle')}
          </h3>
          <ul className="parity-list">
            {beyond.map((r) => (
              <li key={r.id}>
                <strong>{loc(r.label, locale)}</strong>
                {r.detail && <span>{loc(r.detail, locale)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {missing.length > 0 && (
        <details className="parity-missing">
          <summary>
            {t('missingTitle', { count: missing.length })}
            <span className="faq-plus" aria-hidden="true" />
          </summary>
          <p className="parity-missing-lead">{t('missingLead', { competitor })}</p>
          <ul className="parity-list">
            {missing.map((r) => {
              const idea = ideaForCapability(product, r.id);
              const href = idea
                ? { pathname: '/feedback-board', query: { q: idea.title } }
                : { pathname: '/feedback-board', query: { product } };
              return (
                <li key={r.id}>
                  <strong>{loc(r.label, locale)}</strong>
                  {r.detail && <span>{loc(r.detail, locale)}</span>}
                  <Link href={href} className="parity-link">
                    {t('vote')} <Icon name="arrow" size={14} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}

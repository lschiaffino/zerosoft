import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import Icon from './Icon';
import { GITHUB_URL } from './catalog';
import { AI_MULTIPLIER, PAID_MINIMUM, PRICE_MULTIPLIER, PRICING_MEASURED, USAGE_RATES, usageCost, usagePrice } from '@/lib/pricing';

const PLANS = ['a', 'b', 'c'] as const;

/**
 * Los precios, con la regla a la vista: las tres formas de usar zerosoft y la
 * tabla de uso de zerosoft Cloud con nuestro costo al lado del precio (× 3).
 * La usan el home, /products y cada página de producto.
 */
export default function CloudPricing({ headingId }: { headingId: string }) {
  const locale = useLocale();
  const t = useTranslations('common.pricing');
  const tm = useTranslations('common.model');
  const tag = locale === 'en' ? 'en-US' : locale === 'pt' ? 'pt-BR' : 'es-AR';
  const usd = new Intl.NumberFormat(tag, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2 });
  const whole = new Intl.NumberFormat(tag, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 });
  const num = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
  const measured = new Intl.DateTimeFormat(tag, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${PRICING_MEASURED}T12:00:00Z`));

  return (
    <div className="pricing">
      <ol className="plan-rows" aria-labelledby={headingId}>
        {PLANS.map((key) => (
          <li className="plan-row" key={key}>
            <p className="plan-row-price">{tm(`${key}.price`)}</p>
            <div className="plan-row-body">
              <h3>{tm(`${key}.title`)}</h3>
              <p className="plan-row-note">{tm(`${key}.priceNote`)}</p>
              <p>{tm(`${key}.desc`)}</p>
            </div>
            <div className="plan-row-action">
              {key === 'a' ? (
                <a className="btn btn-secondary" href={GITHUB_URL} target="_blank" rel="noreferrer">
                  <Icon name="github" size={15} /> {t('selfHost')}
                </a>
              ) : key === 'b' ? (
                <Link className="btn btn-primary" href="/app">
                  {t('start')}
                </Link>
              ) : (
                <a className="btn btn-secondary" href="mailto:hola@zerosoft.ai">
                  {t('contact')}
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>

      <div className="pricing-usage">
        <div className="pricing-usage-head">
          <h3 className="pricing-usage-title">{t('usageTitle', { x: PRICE_MULTIPLIER })}</h3>
          <p>{t('usageLead')}</p>
        </div>
        <div className="table-wrap">
          <table className="table pricing-table">
            <caption className="sr-only">{t('caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('colResource')}</th>
                <th scope="col">{t('colFree')}</th>
                <th scope="col">{t('colBlock')}</th>
                <th scope="col" className="num">
                  {t('colCost')}
                </th>
                <th scope="col" className="num">
                  {t('colPrice', { x: PRICE_MULTIPLIER })}
                </th>
              </tr>
            </thead>
            <tbody>
              {USAGE_RATES.map((rate) => (
                <tr key={rate.key}>
                  <th scope="row">{t(`usage.${rate.key}.name`)}</th>
                  <td>{t(`usage.${rate.key}.free`)}</td>
                  <td>{t(`usage.${rate.key}.block`)}</td>
                  <td className="num data">{usd.format(usageCost(rate))}</td>
                  <td className="num data pricing-price">{usd.format(usagePrice(rate))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="pricing-notes">
          <li>{t('seats')}</li>
          <li>{t('ai', { x: num.format(AI_MULTIPLIER) })}</li>
          <li>{t('minimum', { min: whole.format(PAID_MINIMUM) })}</li>
          <li>{t('measured', { date: measured })}</li>
        </ul>
      </div>
    </div>
  );
}

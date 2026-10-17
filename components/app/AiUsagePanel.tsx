import { getTranslations } from 'next-intl/server';
import { aiEnabled, getAiUsage } from '@/lib/ai';
import { formatNumber } from '@/lib/utils';
import { quotaPct } from '@/lib/settings-nav';
import FormSection from '@/components/ui/FormSection';

/** Uso de IA del workspace en el mes (tokens usados / cuota). Server component. */
export default async function AiUsagePanel({ workspaceId, locale }: { workspaceId: string; locale: string }) {
  const t = await getTranslations({ locale, namespace: 'settings.ai' });
  const usage = await getAiUsage(workspaceId);
  const enabled = aiEnabled();
  const pct = quotaPct(usage.totalTokens, usage.freeTokens);
  const featureLabel = (f: string) => (t.has(`features.${f}`) ? t(`features.${f}`) : f);
  const n = (v: number) => formatNumber(v, locale);

  return (
    <FormSection
      id="ai"
      title={t('title')}
      description={t('desc')}
      footer={<p className="ui-section-note">{t('quotaNote')}</p>}
    >
      {!enabled && <p className="st-callout">{t('notConfigured')}</p>}
      <dl className="st-facts st-facts-row">
        <div>
          <dt>{t('used')}</dt>
          <dd className="data st-figure">{n(usage.totalTokens)}</dd>
        </div>
        <div>
          <dt>{t('free')}</dt>
          <dd className="data st-figure">{usage.freeTokens === null ? t('unlimited') : n(usage.freeTokens)}</dd>
        </div>
        {usage.overageTokens > 0 && (
          <div>
            <dt>{t('overage')}</dt>
            <dd className="data st-figure st-bad">{n(usage.overageTokens)}</dd>
          </div>
        )}
      </dl>
      {usage.freeTokens !== null && (
        <div className="st-meter-wrap">
          <div
            className={`st-meter${pct >= 100 ? ' is-full' : ''}`}
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label={t('used')}
          >
            <span style={{ width: `${pct}%` }} />
          </div>
          <span className="ui-help data">{t('meter', { pct })}</span>
        </div>
      )}
      {usage.byFeature.length > 0 && (
        <div className="table-wrap">
          <table className="table table-compact">
            <caption className="sr-only">{t('title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('feature')}</th>
                <th scope="col" className="num">
                  {t('tokens')}
                </th>
              </tr>
            </thead>
            <tbody>
              {usage.byFeature.map((f) => (
                <tr key={f.feature}>
                  <td>{featureLabel(f.feature)}</td>
                  <td className="num data">{n(f.tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FormSection>
  );
}

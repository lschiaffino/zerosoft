import { getTranslations } from 'next-intl/server';
import { aiEnabled, getAiUsage } from '@/lib/ai';
import { formatNumber } from '@/lib/utils';

/** Uso de AI del workspace en el mes (tokens usados / cuota gratis). Server component. */
export default async function AiUsagePanel({ workspaceId, locale }: { workspaceId: string; locale: string }) {
  const t = await getTranslations({ locale, namespace: 'link.settings.aiUsage' });
  const usage = await getAiUsage(workspaceId);
  const enabled = aiEnabled();
  const pct =
    usage.freeTokens === null || usage.freeTokens === 0
      ? usage.totalTokens > 0 && usage.freeTokens === 0
        ? 100
        : 0
      : Math.min(100, Math.round((usage.totalTokens / usage.freeTokens) * 100));
  const featureLabel = (f: string) => (t.has(`features.${f}`) ? t(`features.${f}`) : f);

  return (
    <>
      <p className="muted">{t('sub')}</p>
      {!enabled && <p className="muted ai-usage-note">{t('notConfigured')}</p>}
      <div className="profile-fields ai-usage-fields">
        <div className="profile-field">
          <span className="label">{t('used')}</span>
          <span className="mono">{formatNumber(usage.totalTokens, locale)}</span>
        </div>
        <div className="profile-field">
          <span className="label">{t('free')}</span>
          <span className="mono">
            {usage.freeTokens === null ? t('unlimited') : formatNumber(usage.freeTokens, locale)}
          </span>
        </div>
        {usage.overageTokens > 0 && (
          <div className="profile-field">
            <span className="label">{t('overage')}</span>
            <span className="mono">{formatNumber(usage.overageTokens, locale)}</span>
          </div>
        )}
      </div>
      {usage.freeTokens !== null && (
        <div
          className="ai-usage-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={t('used')}
        >
          <span className={pct >= 100 ? 'ai-usage-fill full' : 'ai-usage-fill'} style={{ width: `${pct}%` }} />
        </div>
      )}
      {usage.byFeature.length > 0 && (
        <div className="profile-fields ai-usage-fields">
          {usage.byFeature.map((f) => (
            <div className="profile-field" key={f.feature}>
              <span className="label">{featureLabel(f.feature)}</span>
              <span className="mono">{formatNumber(f.tokens, locale)}</span>
            </div>
          ))}
        </div>
      )}
      {usage.freeTokens !== null && <p className="muted ai-usage-note">{t('quotaNote')}</p>}
    </>
  );
}

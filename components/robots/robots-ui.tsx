'use client';

import { useTranslations } from 'next-intl';
import type { RobotUsage } from '@/lib/robots';

type T = ReturnType<typeof useTranslations<'robots'>>;

/** Texto de un código de error de la API (robots.errors.*). */
export function errorText(t: T, code: string | undefined, values: Record<string, string | number> = {}): string {
  if (code && t.has(`errors.${code}`)) return t(`errors.${code}` as 'errors.generic', values);
  return t('errors.generic');
}

export function UsageMeter({ usage }: { usage: RobotUsage }) {
  const t = useTranslations('robots');
  const pct = usage.minutesLimit ? Math.min(100, (usage.minutesUsed / usage.minutesLimit) * 100) : 0;
  return (
    <div className="robots-usage">
      <div className="robots-usage-head">
        <span className="robots-section-title">{t('usage.title')}</span>
        <span className="robots-usage-val">
          {usage.minutesLimit !== null
            ? t('usage.minutes', { used: usage.minutesUsed, limit: usage.minutesLimit })
            : t('usage.minutesUnlimited', { used: usage.minutesUsed })}
          <span className="muted"> · {t('usage.runs', { count: usage.runs })}</span>
        </span>
      </div>
      {usage.minutesLimit !== null && (
        <div
          className={`robots-usage-bar${pct >= 90 ? ' is-high' : ''}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={usage.minutesLimit}
          aria-valuenow={usage.minutesUsed}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="muted robots-usage-foot">{t('usage.perHour', { count: usage.runsPerHour })}</p>
    </div>
  );
}

export function RunnerNote({ backend }: { backend: RobotUsage['backend'] }) {
  const t = useTranslations('robots');
  if (backend === 'none') {
    return (
      <div className="robots-runner is-none" role="note">
        <strong>{t('runner.none')}</strong>
        <p className="muted">{t('runner.noneHint')}</p>
      </div>
    );
  }
  return (
    <div className="robots-runner" role="note">
      <span className="robots-dot is-success" aria-hidden="true" />
      <span className="muted">{t(`runner.${backend}`)}</span>
    </div>
  );
}

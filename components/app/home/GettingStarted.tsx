import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import Icon, { type IconName } from '@/components/app/icons';
import { SOURCE_TOOLS } from '@/lib/onboarding';
import type { OnboardingState, OnboardingStepKey } from '@/lib/onboarding-state';
import HideGettingStarted from './HideGettingStarted';

const ICONS: Record<OnboardingStepKey, IconName> = {
  profile: 'settings',
  invite: 'people',
  import: 'download',
  calendar: 'calendar',
  email: 'inbox',
  whatsapp: 'groups',
  desktop: 'desktop',
};

/**
 * "Primeros pasos" del inicio: lo que falta de lo que la persona eligió al
 * empezar (lib/onboarding-state.ts). Cada fila se marca por los datos (una
 * cuenta conectada, un import, alguien invitado, la app de escritorio abierta),
 * no por haber tocado el botón. Se oculta a mano; con todo hecho dice que está.
 */
export default async function GettingStarted({ state, locale }: { state: OnboardingState; locale: string }) {
  const t = await getTranslations({ locale, namespace: 'common.appHome.start' });
  const rows = state.steps.filter((s) => s.relevant);
  const tool = state.sourceTool ? SOURCE_TOOLS[state.sourceTool] : undefined;
  const pct = state.totalCount ? Math.round((state.doneCount / state.totalCount) * 100) : 100;
  // Lo primero pendiente lleva el botón principal; el resto, secundario.
  const firstPending = rows.find((s) => !s.done)?.key;

  return (
    <section className="gs" aria-labelledby="gs-title" data-testid="getting-started">
      <header className="gs-head">
        <div className="gs-head-text">
          <h2 id="gs-title" className="gs-title">
            {t('title')}
          </h2>
          <p className="gs-progress data" data-testid="getting-started-progress">
            {t('progress', { done: state.doneCount, total: state.totalCount })}
          </p>
        </div>
        <div className="gs-head-actions">
          {!state.setupDoneAt && !state.complete && (
            <Link href="/app/welcome" className="btn btn-ghost btn-sm">
              {t('continueSetup')}
            </Link>
          )}
          <HideGettingStarted label={t('hide')} ariaLabel={t('hideLabel')} error={t('error')} />
        </div>
      </header>
      <div className="gs-bar" role="progressbar" aria-valuemin={0} aria-valuemax={state.totalCount} aria-valuenow={state.doneCount} aria-labelledby="gs-title">
        <span style={{ width: `${pct}%` }} />
      </div>
      {state.complete ? (
        <p className="gs-allset" role="status">
          <Icon name="check" size={14} />
          {t('allSet')}
        </p>
      ) : (
        <ol className="gs-list">
          {rows.map((s) => (
            <li key={s.key} className={`gs-row${s.done ? ' is-done' : ''}`} data-testid={`gs-${s.key}`} data-done={s.done ? '1' : '0'}>
              <span className="gs-mark" aria-hidden="true">
                <Icon name={s.done ? 'check' : ICONS[s.key]} size={14} />
              </span>
              <span className="gs-text">
                <span className="gs-row-title">
                  {s.key === 'import' ? (tool ? t('steps.import.title', { tool: tool.name }) : t('steps.import.titleAny')) : t(`steps.${s.key}.title`)}
                </span>
                {!s.done && <span className="gs-row-body">{t(`steps.${s.key}.body`)}</span>}
              </span>
              {s.done ? (
                <span className="gs-done">{t('done')}</span>
              ) : (
                <Link href={s.href} className={`btn btn-sm ${s.key === firstPending ? 'btn-primary' : 'btn-secondary'}`}>
                  {t(`steps.${s.key}.cta`)}
                </Link>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

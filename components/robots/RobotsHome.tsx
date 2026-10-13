'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, useRouter } from '@/i18n/navigation';
import type { RobotListItem, RobotUsage } from '@/lib/robots';
import { ROBOT_TEMPLATES } from '@/lib/robots-schema';
import { errorText, RunnerNote, UsageMeter } from './robots-ui';

interface Props {
  robots: RobotListItem[];
  usage: RobotUsage;
  canEdit: boolean;
}

/** Lista de robots + uso del mes + plantillas (/app/robots). */
export default function RobotsHome({ robots, usage, canEdit }: Props) {
  const t = useTranslations('robots');
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoCreated = useRef(false);

  async function create(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);
    const res = await fetch('/api/robots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { id?: string; error?: string } | null;
    setBusy(null);
    if (!res?.ok || !data?.id) {
      setError(errorText(t, data?.error));
      return;
    }
    router.push(`/app/robots/${data.id}`);
  }

  // ?new=1 (sidebar / ⌘K): crea un robot vacío y abre el editor.
  useEffect(() => {
    if (params.get('new') === '1' && canEdit && !autoCreated.current) {
      autoCreated.current = true;
      void create({ name: t('editor.untitled') }, 'new');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, canEdit]);

  function scheduleLabel(r: RobotListItem): string {
    if (!r.schedule) return t('list.noSchedule');
    const base =
      r.schedule.mode === 'daily'
        ? `${t('settings.scheduleDaily')} ${r.schedule.time} ${r.schedule.timezone}`
        : `${t('settings.scheduleInterval').replace('N', String(r.schedule.every))}`;
    return r.enabled ? base : `${base} · off`;
  }

  return (
    <div className="app-page robots-home">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('title')}</h1>
          <p className="muted robots-sub">{t('subtitle')}</p>
        </div>
        {canEdit && (
          <button
            type="button"
            className="btn btn-solid"
            disabled={busy !== null}
            onClick={() => create({ name: t('editor.untitled') }, 'new')}
          >
            {t('list.new')}
          </button>
        )}
      </div>

      <div className="robots-strip">
        <UsageMeter usage={usage} />
        <RunnerNote backend={usage.backend} />
      </div>

      {!canEdit && <p className="muted robots-note">{t('list.adminOnly')}</p>}
      {error && (
        <p className="robots-error" role="alert">
          {error}
        </p>
      )}

      <section className="robots-section" aria-labelledby="robots-list-title">
        <h2 id="robots-list-title" className="robots-section-title">
          {t('list.title')}
        </h2>
        {robots.length === 0 ? (
          <div className="robots-empty">
            <p>{t('list.empty')}</p>
            <p className="muted">{t('list.emptyHint')}</p>
          </div>
        ) : (
          <div className="robots-table" role="table">
            <div className="robots-row robots-row-head" role="row">
              <span role="columnheader">{t('list.name')}</span>
              <span role="columnheader">{t('list.lastRun')}</span>
              <span role="columnheader" className="robots-num">
                {t('list.runs7d')}
              </span>
              <span role="columnheader">{t('list.schedule')}</span>
            </div>
            {robots.map((r) => (
              <div className="robots-row" role="row" key={r.id}>
                <span role="cell" className="robots-row-name">
                  <Link href={`/app/robots/${r.id}`}>{r.name}</Link>
                  {r.description && <span className="muted">{r.description}</span>}
                </span>
                <span role="cell" className="robots-row-last">
                  {r.lastRun ? (
                    <>
                      <span className={`robots-dot is-${r.lastRun.status}`} aria-hidden="true" />
                      {t(`runs.status.${r.lastRun.status}`)}
                      <span className="muted" suppressHydrationWarning>
                        {' · '}
                        {format.relativeTime(new Date(r.lastRun.createdAt), now)}
                      </span>
                    </>
                  ) : (
                    <span className="muted">{t('list.never')}</span>
                  )}
                </span>
                <span role="cell" className="robots-num">
                  {r.runs7d}
                </span>
                <span role="cell" className="robots-row-sched muted">
                  {scheduleLabel(r)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="robots-section" aria-labelledby="robots-templates-title">
        <h2 id="robots-templates-title" className="robots-section-title">
          {t('templates.title')}
        </h2>
        <p className="muted robots-section-sub">{t('templates.subtitle')}</p>
        <div className="robots-templates">
          {ROBOT_TEMPLATES.map((tpl) => (
            <article className="robots-template" key={tpl.key}>
              <ol className="robots-template-steps" aria-hidden="true">
                {tpl.steps.map((s, i) => (
                  <li key={i}>{t(`steps.types.${s.type}`)}</li>
                ))}
              </ol>
              <h3>{t(`templates.items.${tpl.key}.name`)}</h3>
              <p className="muted">{t(`templates.items.${tpl.key}.desc`)}</p>
              {canEdit && (
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy !== null}
                  onClick={() => create({ name: t(`templates.items.${tpl.key}.name`), template: tpl.key }, tpl.key)}
                >
                  {busy === tpl.key ? t('editor.saving') : t('templates.use')}
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

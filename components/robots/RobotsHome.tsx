'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, useRouter } from '@/i18n/navigation';
import type { RobotListItem, RobotUsage } from '@/lib/robots';
import { ROBOT_TEMPLATES } from '@/lib/robots-schema';
import { presetUsesTime, schedulePreset, scheduleTime } from '@/lib/robots-editor';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import DataTable from '@/components/ui/DataTable';
import { errorText, RunnerNote, StatusBadge, UsageMeter } from './robots-ui';

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
    if (!res?.ok || !data?.id) {
      setBusy(null);
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
    const s = r.schedule;
    const preset = schedulePreset(s);
    const tz = s.timezone.replace(/_/g, ' ');
    const base = presetUsesTime(preset)
      ? `${t(`settings.presets.${preset}`)}, ${scheduleTime(s)} ${tz}`
      : preset === 'hourly'
        ? t('settings.presets.hourly')
        : s.mode === 'cron'
          ? `${t('settings.scheduleCron')} ${s.cron ?? ''} ${tz}`
          : `${t('settings.everyN')} ${s.every} ${t(`settings.units.${s.unit === 'minutes' ? 'minutes' : 'hours'}`).toLowerCase()}`;
    return r.enabled ? base : `${base} · ${t('list.paused')}`;
  }

  const createButton = canEdit ? (
    <button
      type="button"
      className="btn btn-primary"
      disabled={busy !== null}
      aria-busy={busy === 'new' || undefined}
      onClick={() => create({ name: t('editor.untitled') }, 'new')}
    >
      {busy === 'new' ? t('list.creating') : t('list.new')}
    </button>
  ) : null;

  return (
    <div className="app-page ui-page robots-home">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <>
            <Link href="/app/robots/recorder" className="btn btn-ghost">
              {t('list.record')}
            </Link>
            {/* Sin robots, la acción principal vive en el estado vacío: una sola. */}
            {robots.length > 0 && createButton}
          </>
        }
      />

      {/* Dónde corre vive en Avanzado; acá solo aparece si falta el runner. */}
      {usage.backend === 'none' ? <RunnerNote backend="none" /> : robots.length > 0 && <UsageMeter usage={usage} />}

      {!canEdit && <p className="robots-muted">{t('list.adminOnly')}</p>}
      {error && (
        <p className="robots-alert" role="alert">
          {error}
        </p>
      )}

      <section className="robots-block" aria-labelledby="robots-list-title">
        <h2 id="robots-list-title" className="ui-section-title">
          {t('list.title')}
        </h2>
        <DataTable
          caption={t('list.title')}
          rows={robots}
          rowKey={(r) => r.id}
          empty={
            <EmptyState
              title={t('list.emptyTitle')}
              body={t('list.emptyHint')}
              action={createButton}
              secondary={canEdit ? <a href="#robots-templates-title">{t('list.emptyAlt')}</a> : undefined}
            />
          }
          columns={[
            {
              key: 'name',
              header: t('list.name'),
              cell: (r) => (
                <span className="robots-cell-name">
                  <Link href={`/app/robots/${r.id}`} className="cell-link">
                    {r.name}
                  </Link>
                  {r.description && <span className="robots-cell-desc">{r.description}</span>}
                </span>
              ),
            },
            {
              key: 'last',
              header: t('list.lastRun'),
              width: '220px',
              cell: (r) =>
                r.lastRun ? (
                  <span className="robots-cell-last">
                    <StatusBadge status={r.lastRun.status} />
                    <span className="robots-muted" suppressHydrationWarning>
                      {format.relativeTime(new Date(r.lastRun.createdAt), now)}
                    </span>
                  </span>
                ) : (
                  <span className="robots-muted">{t('list.never')}</span>
                ),
            },
            { key: 'runs', header: t('list.runs7d'), numeric: true, width: '120px', cell: (r) => r.runs7d },
            {
              key: 'schedule',
              header: t('list.schedule'),
              width: '260px',
              cell: (r) => <span className={`robots-cell-sched${r.schedule && r.enabled ? '' : ' robots-muted'}`}>{scheduleLabel(r)}</span>,
            },
          ]}
        />
      </section>

      <section className="robots-block" aria-labelledby="robots-templates-title">
        <div className="robots-block-head is-stacked">
          <h2 id="robots-templates-title" className="ui-section-title">
            {t('templates.title')}
          </h2>
          <p className="robots-muted">{t('templates.subtitle')}</p>
        </div>
        <ul className="robots-templates">
          {ROBOT_TEMPLATES.map((tpl) => (
            <li className="robots-template" key={tpl.key}>
              <div className="robots-template-text">
                <h3 className="robots-template-name">{t(`templates.items.${tpl.key}.name`)}</h3>
                <p className="robots-muted">{t(`templates.items.${tpl.key}.desc`)}</p>
              </div>
              <ol className="robots-template-steps" aria-label={t('templates.stepsLabel', { count: tpl.steps.length })}>
                {tpl.steps.map((s, i) => (
                  <li key={i}>{t(`steps.types.${s.type}`)}</li>
                ))}
              </ol>
              {canEdit && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy !== null}
                  aria-busy={busy === tpl.key || undefined}
                  onClick={() => create({ name: t(`templates.items.${tpl.key}.name`), template: tpl.key }, tpl.key)}
                >
                  {busy === tpl.key ? t('list.creating') : t('templates.use')}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

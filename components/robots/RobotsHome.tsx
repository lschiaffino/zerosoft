'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, useRouter } from '@/i18n/navigation';
import type { RobotListItem, RobotUsage } from '@/lib/robots';
import { ROBOT_TEMPLATES, TEMPLATE_CATEGORIES, type RobotStep, type RobotTemplateCategory } from '@/lib/robots-schema';
import { presetUsesTime, schedulePreset, scheduleTime } from '@/lib/robots-editor';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import DataTable from '@/components/ui/DataTable';
import { errorText, RunnerNote, StatusBadge, UsageMeter } from './robots-ui';
import { AiBuilderDialog } from './RobotDialogs';
import { parseDbUtc } from '@/lib/utils';

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
  const importRef = useRef<HTMLInputElement>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [category, setCategory] = useState<'all' | RobotTemplateCategory>('all');
  const [tq, setTq] = useState('');
  const templates = useMemo(() => {
    const q = tq.trim().toLowerCase();
    return ROBOT_TEMPLATES.filter((tpl) => {
      if (category !== 'all' && tpl.category !== category) return false;
      if (!q) return true;
      const text = `${t(`templates.items.${tpl.key}.name`)} ${t(`templates.items.${tpl.key}.desc`)} ${tpl.site ?? ''}`.toLowerCase();
      return text.includes(q);
    });
  }, [category, tq, t]);

  async function importFile(file: File) {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setError(t('errors.invalid_import'));
      return;
    }
    const name = parsed && typeof parsed === 'object' && typeof (parsed as { name?: unknown }).name === 'string' ? (parsed as { name: string }).name : t('editor.untitled');
    await create({ name: name.slice(0, 120) || t('editor.untitled'), import: parsed }, 'import');
  }

  async function create(body: Record<string, unknown>, key: string): Promise<boolean> {
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
      return false;
    }
    router.push(`/app/robots/${data.id}`);
    return true;
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
            {canEdit && (
              <>
                <button type="button" className="btn btn-ghost" disabled={busy !== null} aria-busy={busy === 'import' || undefined} onClick={() => importRef.current?.click()}>
                  {busy === 'import' ? t('list.importing') : t('list.import')}
                </button>
                <input
                  ref={importRef}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  aria-label={t('list.import')}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void importFile(f);
                  }}
                />
                <button type="button" className="btn btn-secondary" onClick={() => setBuilderOpen(true)}>
                  {t('list.buildAi')}
                </button>
              </>
            )}
            {/* Sin robots, la acción principal vive en el estado vacío: una sola. */}
            {robots.length > 0 && createButton}
          </>
        }
      />

      {/* Dónde corre vive en Avanzado; acá solo aparece si falta el runner. */}
      {usage.backend === 'none' ? <RunnerNote backend="none" /> : robots.length > 0 && <UsageMeter usage={usage} />}
      {robots.length > 0 && usage.byRobot.length > 0 && (
        <details className="robots-usage-detail">
          <summary>{t('usage.byRobotTitle')}</summary>
          <div className="table-wrap">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th scope="col">{t('usage.byRobotName')}</th>
                  <th scope="col" className="num">
                    {t('usage.byRobotRuns')}
                  </th>
                  <th scope="col" className="num">
                    {t('usage.byRobotMinutes')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {usage.byRobot.map((u) => (
                  <tr key={u.robotId}>
                    <td>
                      <Link href={`/app/robots/${u.robotId}`} className="cell-link">
                        {u.name}
                      </Link>
                    </td>
                    <td className="num">{u.runs}</td>
                    <td className="num">{u.minutes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

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
                    <StatusBadge status={r.lastRun.status} warnings={r.lastRun.warnings} />
                    <span className="robots-muted" suppressHydrationWarning>
                      {format.relativeTime(parseDbUtc(r.lastRun.createdAt), now)}
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
        <div className="robots-data-bar">
          <div className="btn-group" role="group" aria-label={t('templates.categoriesLabel')}>
            {(['all', ...TEMPLATE_CATEGORIES] as const).map((c) => (
              <button key={c} type="button" className="btn btn-sm" aria-pressed={category === c} onClick={() => setCategory(c)}>
                {t(`templates.categories.${c}`)}
              </button>
            ))}
          </div>
          <input
            className="input robots-data-search"
            type="search"
            value={tq}
            placeholder={t('templates.search')}
            aria-label={t('templates.search')}
            onChange={(e) => setTq(e.target.value)}
          />
        </div>
        {templates.length === 0 && <p className="robots-muted">{t('templates.searchEmpty', { q: tq })}</p>}
        <ul className="robots-templates">
          {templates.map((tpl) => (
            <li className="robots-template" key={tpl.key}>
              <div className="robots-template-text">
                <h3 className="robots-template-name">{t(`templates.items.${tpl.key}.name`)}</h3>
                {tpl.site && <p className="robots-small data">{t('templates.site', { site: tpl.site })}</p>}
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

      {canEdit && (
        <AiBuilderDialog
          open={builderOpen}
          onClose={() => setBuilderOpen(false)}
          onCreate={(b: { name: string; description: string; steps: RobotStep[] }) => create({ name: b.name || t('editor.untitled'), description: b.description, steps: b.steps }, 'ai')}
        />
      )}
    </div>
  );
}

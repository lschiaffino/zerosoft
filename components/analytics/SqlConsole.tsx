'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { VIRTUAL_COLUMNS, VIRTUAL_TABLES } from '@/lib/analytics/sql-safe';
import type { InsightDto, InsightResult, SqlQuery } from '@/lib/analytics/types';
import { ApiError, apiErrorText, api, notifyChanged, runQuery } from './client';
import { SqlForm } from './InsightEditor';
import InsightResultView from './InsightResultView';
import NameDialog from './NameDialog';

const SAMPLE =
  "SELECT pathname, count() AS views, count(DISTINCT person_id) AS visitors\nFROM events\nWHERE event = '$pageview' AND timestamp > (strftime('%s', 'now') - 7 * 86400) * 1000\nGROUP BY pathname\nORDER BY views DESC\nLIMIT 20";

/**
 * Editor SQL de solo lectura (como el SQL de PostHog, sobre SQLite): tablas
 * virtuales del proyecto, ⌘↵ para correr y guardar como insight.
 */
export default function SqlConsole({ projectId }: { projectId: string }) {
  const t = useTranslations('analytics.sql');
  const te = useTranslations('analytics.editor');
  const tc = useTranslations('analytics.common');
  const router = useRouter();
  const [q, setQ] = useState<SqlQuery>({ kind: 'sql', sql: SAMPLE });
  const [result, setResult] = useState<InsightResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setResult(await runQuery(projectId, q));
    } catch (err) {
      setResult(null);
      if (err instanceof ApiError) {
        const base = te.has(`errors.${err.code}`) ? te(`errors.${err.code}`) : te('errors.request_failed');
        setError(err.detail ? `${base} (${err.detail})` : base);
      } else setError(te('errors.request_failed'));
    } finally {
      setRunning(false);
    }
  };

  const save = async (name: string) => {
    setSaving(true);
    try {
      const { insight } = await api<{ insight: InsightDto }>('/api/analytics/insights', { body: { projectId, name, query: q } });
      notifyChanged();
      router.push(`/app/analytics/insights/${insight.id}`);
    } catch (err) {
      setError(apiErrorText(err, tc));
    } finally {
      setSaving(false);
      setAsking(false);
    }
  };

  return (
    <div className="app-page ui-page an-page">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <button type="button" className="btn" onClick={() => setAsking(true)} disabled={!q.sql.trim()}>
              {t('saveInsight')}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={running || !q.sql.trim()} aria-busy={running}>
              {t('run')}
            </button>
          </>
        }
      />
      <div className="an-editor-grid">
        <section className="an-editor-def" aria-label={t('query')}>
          <SqlForm q={q} set={setQ} onRun={() => void run()} />
          <details className="an-more" open>
            <summary>{t('schema')}</summary>
            <dl className="an-schema">
              {VIRTUAL_TABLES.map((table) => (
                <div key={table}>
                  <dt className="an-mono">{table}</dt>
                  <dd className="an-mono an-small">{VIRTUAL_COLUMNS[table].join(', ')}</dd>
                </div>
              ))}
            </dl>
          </details>
        </section>
        <section className="an-editor-result an-panel" aria-label={t('results')} aria-busy={running} data-testid="an-sql-result">
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
          {running && <span className="ui-skeleton ui-skeleton-block" />}
          {!running && result && <InsightResultView result={result} />}
          {!running && !result && !error && <p className="an-muted">{te('runHint')}</p>}
        </section>
      </div>
      <NameDialog open={asking} title={t('saveInsight')} label={te('name')} submitLabel={tc('save')} busy={saving} onClose={() => setAsking(false)} onSubmit={(n) => void save(n)} />
    </div>
  );
}

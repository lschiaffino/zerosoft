'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { RobotRunDto } from '@/lib/robots';

function duration(ms: number | null): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

function pretty(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2) ?? '';
  } catch {
    return String(v);
  }
}

/** Valor como tabla si es una lista de objetos/arrays; null si no se puede. */
function asRows(v: unknown): { head: string[]; rows: string[][] } | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  if (v.every((r) => Array.isArray(r))) {
    const width = Math.max(...v.map((r) => (r as unknown[]).length));
    return {
      head: Array.from({ length: width }, (_, i) => String(i + 1)),
      rows: (v as unknown[][]).slice(0, 200).map((r) => Array.from({ length: width }, (_, i) => cell(r[i]))),
    };
  }
  if (v.every((r) => r && typeof r === 'object')) {
    const head = [...new Set(v.flatMap((r) => Object.keys(r as object)))].slice(0, 20);
    return { head, rows: v.slice(0, 200).map((r) => head.map((h) => cell((r as Record<string, unknown>)[h]))) };
  }
  return { head: ['value'], rows: v.slice(0, 200).map((r) => [cell(r)]) };
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export default function RunsPanel({ runs, selectedId, onSelect }: { runs: RobotRunDto[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const t = useTranslations('robots.runs');
  const format = useFormatter();
  const run = runs.find((r) => r.id === selectedId) ?? null;

  if (runs.length === 0) return <p className="muted robots-pad">{t('empty')}</p>;

  return (
    <div className="robots-runs">
      <ul className="robots-run-list" aria-label={t('steps')}>
        {runs.map((r) => (
          <li key={r.id}>
            <button type="button" className={`robots-run-item${r.id === selectedId ? ' is-active' : ''}`} onClick={() => onSelect(r.id)}>
              <span className={`robots-dot is-${r.status}`} aria-hidden="true" />
              <span className="robots-run-when" suppressHydrationWarning>
                {format.dateTime(new Date(r.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
              <span className="muted">
                {t(`trigger.${r.trigger}`)} · {duration(r.durationMs)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="robots-run-detail">{run ? <RunDetail run={run} /> : <p className="muted robots-pad">{t('select')}</p>}</div>
    </div>
  );
}

function RunDetail({ run }: { run: RobotRunDto }) {
  const t = useTranslations('robots.runs');
  const [view, setView] = useState<'table' | 'json'>('table');
  const entries = Object.entries(run.output ?? {});
  const tableable = entries.some(([, v]) => asRows(v));

  return (
    <div className="robots-run-body">
      <div className="robots-run-meta">
        <span className={`robots-status is-${run.status}`}>
          <span className={`robots-dot is-${run.status}`} aria-hidden="true" />
          {t(`status.${run.status}`)}
        </span>
        <span className="muted">
          {t('duration')}: {duration(run.durationMs)}
        </span>
        <span className="muted">{t(`trigger.${run.trigger}`)}</span>
      </div>
      {run.error && (
        <p className="robots-error mono" role="alert">
          {t('error')}: {run.error}
        </p>
      )}

      <h3 className="robots-section-title">{t('steps')}</h3>
      <ol className="robots-log">
        {run.logs.map((l, i) => (
          <li key={i} className={`is-${l.status}`}>
            <span className="robots-log-num mono">{l.step}</span>
            <span className="robots-log-type">{l.type}</span>
            <span className="robots-log-detail mono">{l.error ? `${l.error}${l.detail ? ` — ${l.detail}` : ''}` : (l.detail ?? '')}</span>
            <span className="robots-log-ms muted">{l.status === 'skipped' ? t('stepStatus.skipped') : duration(l.ms)}</span>
          </li>
        ))}
      </ol>

      <div className="robots-data-head">
        <h3 className="robots-section-title">{t('data')}</h3>
        {entries.length > 0 && (
          <div className="robots-seg" role="tablist">
            {tableable && (
              <button type="button" role="tab" aria-selected={view === 'table'} className={view === 'table' ? 'is-on' : ''} onClick={() => setView('table')}>
                {t('asTable')}
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={view === 'json' || !tableable}
              className={view === 'json' || !tableable ? 'is-on' : ''}
              onClick={() => setView('json')}
            >
              {t('asJson')}
            </button>
            <button type="button" onClick={() => void navigator.clipboard?.writeText(pretty(run.output))}>
              {t('copy')}
            </button>
          </div>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="muted">{t('noData')}</p>
      ) : view === 'json' || !tableable ? (
        <pre className="robots-json">{pretty(run.output)}</pre>
      ) : (
        <div className="robots-vars">
          {entries.map(([k, v]) => {
            const rows = asRows(v);
            return (
              <div key={k} className="robots-var">
                <span className="robots-var-name mono">{k}</span>
                {rows ? (
                  <div className="robots-data-table-wrap">
                    <table className="robots-data-table">
                      <thead>
                        <tr>
                          {rows.head.map((h) => (
                            <th key={h}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.rows.map((r, i) => (
                          <tr key={i}>
                            {r.map((c, j) => (
                              <td key={j}>{c}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <span className="robots-var-val">{cell(v)}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {run.screenshots.length > 0 && (
        <>
          <h3 className="robots-section-title">{t('screenshots')}</h3>
          <div className="robots-shots">
            {run.screenshots.map((s, i) => (
              <figure key={i} className="robots-shot">
                {s.url && !s.url.startsWith('data:') ? (
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.url} alt={s.name} loading="lazy" />
                  </a>
                ) : s.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.url} alt={s.name} loading="lazy" />
                ) : (
                  <p className="muted">{t('omitted')}</p>
                )}
                <figcaption className="mono">{s.name}</figcaption>
              </figure>
            ))}
          </div>
        </>
      )}

      {Object.keys(run.input ?? {}).length > 0 && (
        <>
          <h3 className="robots-section-title">{t('input')}</h3>
          <pre className="robots-json">{pretty(run.input)}</pre>
        </>
      )}
    </div>
  );
}

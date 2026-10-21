'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { RobotRunDto } from '@/lib/robots';
import { csvFilename, valueToCsv } from '@/lib/robots-csv';
import EmptyState from '@/components/ui/EmptyState';
import { StatusBadge } from './robots-ui';

function duration(ms: number | null): string {
  if (ms === null || ms === undefined) return '–';
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

/** Descarga un CSV armado en el navegador (BOM para que Excel lea UTF-8). */
function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

/** Historial de corridas: lista a la izquierda, detalle a la derecha. */
export default function RunsPanel({
  runs,
  selectedId,
  onSelect,
  running = false,
  emptyAction,
  robotName = 'robot',
}: {
  runs: RobotRunDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Hay una corrida en curso (se muestra arriba mientras termina). */
  running?: boolean;
  /** Acción del estado vacío (el botón Correr). */
  emptyAction?: React.ReactNode;
  /** Para el nombre de los CSV descargados. */
  robotName?: string;
}) {
  const t = useTranslations('robots.runs');
  const format = useFormatter();
  const run = runs.find((r) => r.id === selectedId) ?? null;

  if (runs.length === 0 && !running) {
    return <EmptyState title={t('emptyTitle')} body={t('emptyBody')} action={emptyAction} />;
  }

  return (
    <div className="robots-runs">
      <ul className="robots-run-list" aria-label={t('history')}>
        {running && (
          <li>
            <div className="robots-run-item is-pending" aria-current="true">
              <StatusBadge status="running" />
              <span className="robots-run-when">{t('runningNow')}</span>
            </div>
          </li>
        )}
        {runs.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className="robots-run-item"
              aria-current={!running && r.id === selectedId ? 'true' : undefined}
              onClick={() => onSelect(r.id)}
            >
              <StatusBadge status={r.status} warnings={r.warnings} />
              <span className="robots-run-when" suppressHydrationWarning>
                {format.dateTime(new Date(r.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
              <span className="robots-run-sub">
                {t(`trigger.${r.trigger}`)} · <span className="num">{duration(r.durationMs)}</span>
                {r.changed === true && <> · {t('changed')}</>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="robots-run-detail" aria-live="polite">
        {running ? (
          <div className="robots-run-body ui-loading-stack" aria-busy="true">
            <p className="robots-muted">{t('runningHint')}</p>
            <span className="ui-skeleton ui-skeleton-title" />
            <span className="ui-skeleton ui-skeleton-row" />
            <span className="ui-skeleton ui-skeleton-row" />
            <span className="ui-skeleton ui-skeleton-row" />
          </div>
        ) : run ? (
          <RunDetail run={run} robotName={robotName} />
        ) : (
          <p className="robots-run-body robots-muted">{t('select')}</p>
        )}
      </div>
    </div>
  );
}

function RunDetail({ run, robotName }: { run: RobotRunDto; robotName: string }) {
  const t = useTranslations('robots.runs');
  const tTypes = useTranslations('robots.steps.types');
  const [view, setView] = useState<'table' | 'json'>('table');
  const [copied, setCopied] = useState(false);
  const entries = Object.entries(run.output ?? {});
  const tableable = entries.some(([, v]) => asRows(v));
  const asJson = view === 'json' || !tableable;

  return (
    <div className="robots-run-body">
      <div className="robots-run-meta">
        <StatusBadge status={run.status} warnings={run.warnings} />
        <span>
          {t('duration')} <span className="num">{duration(run.durationMs)}</span>
        </span>
        <span>{t(`trigger.${run.trigger}`)}</span>
        {run.changed !== null && <span className="badge">{run.changed ? t('changed') : t('unchanged')}</span>}
      </div>
      {run.status === 'queued' && <p className="ui-help">{t('queuedNotice')}</p>}
      {run.error && (
        <div className="robots-run-error" role="alert">
          <strong>{t('error')}</strong>
          <span className="data">{run.error}</span>
        </div>
      )}
      {run.status === 'success' && run.warnings > 0 && (
        <p className="robots-note-warn">{t('warningsNotice', { count: run.warnings })}</p>
      )}
      {run.failure && <FailureCapture failure={run.failure} runId={run.id} />}

      <section className="robots-block" aria-labelledby={`log-${run.id}`}>
        <h3 className="robots-h3" id={`log-${run.id}`}>
          {t('steps')}
        </h3>
        <div className="table-wrap">
          <table className="table table-compact robots-log">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">{t('logStep')}</th>
                <th scope="col">{t('logDetail')}</th>
                <th scope="col" className="num">
                  {t('logTime')}
                </th>
              </tr>
            </thead>
            <tbody>
              {run.logs.map((l, i) => (
                <tr key={i} data-status={l.status}>
                  <td className="data">{l.step}</td>
                  <td className="robots-log-type">{tTypes.has(l.type) ? tTypes(l.type as 'goto') : l.type}</td>
                  <td className="data robots-log-detail" title={l.error ? `${l.error}${l.detail ? `: ${l.detail}` : ''}` : (l.detail ?? '')}>
                    {l.error ? `${l.error}${l.detail ? `: ${l.detail}` : ''}` : (l.detail ?? '')}
                  </td>
                  <td className="num">
                    {l.status === 'skipped' ? t('stepStatus.skipped') : l.status === 'warning' ? t('stepStatus.warning') : duration(l.ms)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="robots-block" aria-labelledby={`data-${run.id}`}>
        <div className="robots-block-head">
          <h3 className="robots-h3" id={`data-${run.id}`}>
            {t('data')}
          </h3>
          {entries.length > 0 && (
            <div className="robots-block-actions">
              {tableable && (
                <div className="btn-group" role="group" aria-label={t('view')}>
                  <button type="button" className="btn btn-sm" aria-pressed={!asJson} onClick={() => setView('table')}>
                    {t('asTable')}
                  </button>
                  <button type="button" className="btn btn-sm" aria-pressed={asJson} onClick={() => setView('json')}>
                    {t('asJson')}
                  </button>
                </div>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(pretty(run.output)).catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? t('copied') : t('copy')}
              </button>
            </div>
          )}
        </div>
        {entries.length === 0 ? (
          <p className="robots-muted">{t('noData')}</p>
        ) : asJson ? (
          <pre className="robots-json data">{pretty(run.output)}</pre>
        ) : (
          <div className="robots-vars">
            {entries.map(([k, v]) => {
              const rows = asRows(v);
              return (
                <div key={k} className="robots-var">
                  <div className="robots-var-head">
                    <span className="robots-var-name data">{k}</span>
                    {rows && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          const csv = valueToCsv(v);
                          if (csv) downloadCsv(csvFilename(robotName, k, run.createdAt), csv);
                        }}
                      >
                        {t('downloadCsv')}
                      </button>
                    )}
                  </div>
                  {rows ? (
                    <div className="table-wrap robots-scroll">
                      <table className="table table-compact table-sticky">
                        <thead>
                          <tr>
                            {rows.head.map((h) => (
                              <th key={h} scope="col">
                                {h}
                              </th>
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
      </section>

      {run.screenshots.length > 0 && (
        <section className="robots-block" aria-labelledby={`shots-${run.id}`}>
          <h3 className="robots-h3" id={`shots-${run.id}`}>
            {t('screenshots')}
          </h3>
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
                  <p className="robots-muted robots-shot-missing">{t('omitted')}</p>
                )}
                <figcaption className="data">{s.name}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {Object.keys(run.input ?? {}).length > 0 && (
        <section className="robots-block" aria-labelledby={`input-${run.id}`}>
          <h3 className="robots-h3" id={`input-${run.id}`}>
            {t('input')}
          </h3>
          <pre className="robots-json data">{pretty(run.input)}</pre>
        </section>
      )}
    </div>
  );
}

/** Lo que había en la página cuando falló el paso: captura, URL y recorte del DOM. */
function FailureCapture({ failure, runId }: { failure: NonNullable<RobotRunDto['failure']>; runId: string }) {
  const t = useTranslations('robots.runs.failure');
  const tTypes = useTranslations('robots.steps.types');
  const shot = failure.screenshot;
  return (
    <section className="robots-block robots-failure" aria-labelledby={`failure-${runId}`}>
      <h3 className="robots-h3" id={`failure-${runId}`}>
        {t('title', { step: failure.step })}
      </h3>
      <dl className="robots-failure-meta">
        <dt>{t('step')}</dt>
        <dd>
          <span className="data">{failure.step}</span> · {tTypes.has(failure.type) ? tTypes(failure.type as 'goto') : failure.type}
        </dd>
        <dt>{t('error')}</dt>
        <dd className="data">{failure.error}</dd>
        {failure.url && (
          <>
            <dt>{t('url')}</dt>
            <dd className="data robots-failure-url">
              {/^https?:\/\//i.test(failure.url) ? (
                <a href={failure.url} target="_blank" rel="noreferrer noopener">
                  {failure.url}
                </a>
              ) : (
                failure.url
              )}
            </dd>
          </>
        )}
        {failure.title && (
          <>
            <dt>{t('pageTitle')}</dt>
            <dd>{failure.title}</dd>
          </>
        )}
      </dl>
      {failure.matched === false && <p className="ui-help">{t('notMatched')}</p>}
      {shot && (
        <figure className="robots-shot robots-failure-shot">
          {!shot.startsWith('data:') ? (
            <a href={shot} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shot} alt={t('screenshotAlt', { step: failure.step })} loading="lazy" />
            </a>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shot} alt={t('screenshotAlt', { step: failure.step })} loading="lazy" />
          )}
          <figcaption>{t('screenshot')}</figcaption>
        </figure>
      )}
      {failure.dom && (
        <div className="robots-var">
          <span className="robots-var-name">{failure.matched ? t('domElement') : t('domPage')}</span>
          <pre className="robots-json data">{failure.dom}</pre>
        </div>
      )}
    </section>
  );
}

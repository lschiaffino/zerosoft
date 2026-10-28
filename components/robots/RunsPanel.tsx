'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { RobotRunDto } from '@/lib/robots';
import { csvFilename, valueToCsv } from '@/lib/robots-csv';
import EmptyState from '@/components/ui/EmptyState';
import { errorText, StatusBadge } from './robots-ui';

/** Arreglo propuesto para un paso: índice en el robot (y en el loop) y el selector o texto nuevo. */
export interface StepFix {
  index: number;
  child: number | null;
  /** Etiqueta del paso en el log ("3" o "3.2.1"). */
  step: string;
  selector: string;
  text: string;
}
import { parseDbUtc } from '@/lib/utils';

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
  onApplyFix,
  toolbar,
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
  /** Admins: aplicar un arreglo (IA o selector alternativo) al paso en el editor. */
  onApplyFix?: (fix: StepFix) => void;
  /** Botones de arriba (Correr en lote, Actualizar). */
  toolbar?: React.ReactNode;
}) {
  const t = useTranslations('robots.runs');
  const format = useFormatter();
  const run = runs.find((r) => r.id === selectedId) ?? null;

  if (runs.length === 0 && !running) {
    return (
      <>
        {toolbar && <div className="robots-toolbar">{toolbar}</div>}
        <EmptyState title={t('emptyTitle')} body={t('emptyBody')} action={emptyAction} />
      </>
    );
  }

  return (
    <>
    {toolbar && <div className="robots-toolbar">{toolbar}</div>}
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
                {format.dateTime(parseDbUtc(r.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
              <span className="robots-run-sub">
                {t(`trigger.${r.trigger}`)} · <span className="num">{duration(r.durationMs)}</span>
                {r.changed === true && <> · {t('changed')}</>}
                {r.batchId && <> · {t('batch')}</>}
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
          <RunDetail run={run} robotName={robotName} onApplyFix={onApplyFix} />
        ) : (
          <p className="robots-run-body robots-muted">{t('select')}</p>
        )}
      </div>
    </div>
    </>
  );
}

function RunDetail({ run, robotName, onApplyFix }: { run: RobotRunDto; robotName: string; onApplyFix?: (fix: StepFix) => void }) {
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
      {run.dataHidden && <p className="robots-note-warn">{t('dataHidden')}</p>}
      {run.failure && <FailureCapture failure={run.failure} runId={run.id} onApplyFix={onApplyFix} />}
      <RunExtras run={run} onApplyFix={onApplyFix} />

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

/** Autorreparación, IA, tabla acumulada, email de cambios, envíos y país de la corrida. */
function RunExtras({ run, onApplyFix }: { run: RobotRunDto; onApplyFix?: (fix: StepFix) => void }) {
  const t = useTranslations('robots.runs');
  const ti = useTranslations('robots.integrations');
  const x = run.exports ?? {};
  const healed = x.healed ?? [];
  const lines: React.ReactNode[] = [];
  if (x.geo) lines.push(<li key="geo">{x.geo.proxy ? t('geoProxy', { country: (x.geo.country || '–').toUpperCase() }) : t('geo', { country: (x.geo.country || '–').toUpperCase() })}</li>);
  if (x.dataset) lines.push(<li key="ds">{t('dataset', { added: x.dataset.added, changed: x.dataset.changed, removed: x.dataset.removed, total: x.dataset.total })}</li>);
  if (x.email && x.email.sent > 0) lines.push(<li key="mail">{t('emailSent', { count: x.email.sent })}</li>);
  for (const e of x.ai?.errors ?? []) lines.push(<li key={`ai-${e.variable}`} className="robots-log-warn">{t('aiError', { variable: e.variable, error: e.error })}</li>);
  for (const d of x.destinations ?? []) {
    const kind = ti(`kinds.${d.kind}`);
    lines.push(
      <li key={`d-${d.id}`} className={d.ok ? undefined : 'robots-log-warn'}>
        {d.ok ? t('destOk', { kind, count: d.count }) : t('destFail', { kind, error: d.error ?? '' })}
        {d.fake && <span className="robots-muted"> · {t('destFake')}</span>}
      </li>,
    );
  }
  if (!lines.length && !healed.length) return null;
  return (
    <>
      {lines.length > 0 && <ul className="robots-run-extras">{lines}</ul>}
      {healed.length > 0 && (
        <section className="robots-block" aria-labelledby={`heal-${run.id}`}>
          <h3 className="robots-h3" id={`heal-${run.id}`}>
            {t('healedTitle')}
          </h3>
          <ul className="robots-run-extras">
            {healed.map((h) => {
              const parts = h.step.split('.').map(Number);
              const path = parts.length === 1 ? { index: parts[0] - 1, child: null } : parts.length === 3 ? { index: parts[0] - 1, child: parts[2] - 1 } : null;
              return (
                <li key={h.step}>
                  <span>{t('healed', { step: h.step, selector: h.to })}</span>{' '}
                  {onApplyFix && path && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onApplyFix({ ...path, step: h.step, selector: h.to, text: '' })}>
                      {t('promote')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

/** Lo que había en la página cuando falló el paso: captura, URL y recorte del DOM. */
function FailureCapture({
  failure,
  runId,
  onApplyFix,
}: {
  failure: NonNullable<RobotRunDto['failure']>;
  runId: string;
  onApplyFix?: (fix: StepFix) => void;
}) {
  const t = useTranslations('robots.runs.failure');
  const tr = useTranslations('robots');
  const [fixing, setFixing] = useState(false);
  const [fix, setFix] = useState<(StepFix & { reason: string }) | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);
  async function suggest() {
    setFixing(true);
    setFixError(null);
    setFix(null);
    const res = await fetch(`/api/robots/runs/${runId}/fix`, { method: 'POST' }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as (StepFix & { reason: string; error?: string }) | null;
    setFixing(false);
    if (!res?.ok || !data) {
      setFixError(errorText(tr, data?.error));
      return;
    }
    if (!data.selector && !data.text) setFixError(t('fixNone'));
    else setFix(data);
  }
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
      {onApplyFix && failure.dom && (
        <div className="robots-fix" aria-live="polite">
          {!fix && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void suggest()} disabled={fixing} aria-busy={fixing || undefined}>
              {fixing ? t('fixing') : t('fix')}
            </button>
          )}
          {fixError && (
            <p className="ui-error" role="alert">
              {fixError}
            </p>
          )}
          {fix && (
            <div className="robots-note-action">
              <p>
                <span className="data">{fix.selector ? t('fixSelector', { selector: fix.selector }) : t('fixText', { text: fix.text })}</span>
                {fix.reason && fix.reason !== 'fake' && <span className="robots-muted"> · {fix.reason}</span>}
              </p>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  onApplyFix(fix);
                  setFix(null);
                }}
              >
                {t('fixApply', { step: fix.step })}
              </button>
            </div>
          )}
        </div>
      )}
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

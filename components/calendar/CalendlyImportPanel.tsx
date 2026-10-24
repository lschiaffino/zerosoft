'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';
import {
  failedReading,
  ImportConfirm,
  ImportProgress,
  ImportStat,
  useImportErrorText,
  useImportJob,
  useReadFailedText,
  type ImportJobView,
} from '@/components/app/ImportJob';

interface Preview {
  schedules: Array<{ name: string; timezone: string; rules: number; isDefault: boolean; already: boolean }>;
  eventTypes: Array<{ title: string; slug: string; durationMin: number; locations: number; questions: number; unmapped: string[]; active: boolean; already: boolean }>;
  bookings: number;
  bookingsAlready: number;
  includeBookings: boolean;
}

interface Report {
  schedules: number;
  eventTypes: number;
  bookings: number;
  skipped: number;
  failed: Array<{ title: string; reason: string }>;
  renamed: Array<{ from: string; to: string }>;
}

/** Cal › Ajustes › Importar: tipos de evento, horarios y reservas desde Calendly. */
export default function CalendlyImportPanel({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations('calendar.importer');
  const errorText = useImportErrorText();
  const readFailedText = useReadFailedText();
  const { job, error, setError, loading, create, start, cancel, reset } = useImportJob('cal');
  const [token, setToken] = useState('');
  const [includeBookings, setIncludeBookings] = useState(false);
  const readFailed = failedReading(job);
  const status = job?.status ?? null;

  // El token se borra cuando ya se leyó Calendly; si la lectura falla queda para corregirlo.
  useEffect(() => {
    if (status === 'preview' || status === 'importing' || status === 'done') setToken('');
  }, [status]);

  if (!canEdit) {
    return (
      <FormSection title={t('title')} description={t('lead')}>
        <p className="ximp-note">{t('adminOnly')}</p>
      </FormSection>
    );
  }

  let body;
  if (loading) body = <p className="ui-help">{t('loadingJobs')}</p>;
  else if (!job || readFailed) {
    body = (
      <>
      {readFailed && (
        <p className="ximp-note" data-tone="bad" role="alert" data-testid="import-read-failed">
          {readFailedText('Calendly', job?.error)}
        </p>
      )}
      <form
        className="ui-fields"
        onSubmit={async (e) => {
          e.preventDefault();
          if (token.trim().length < 8) return;
          await create({ source: 'calendly', token: token.trim(), includeBookings });
        }}
      >
        <div className="ui-field">
          <label className="label" htmlFor="cly-token">
            {t('token')}
          </label>
          <input
            id="cly-token"
            className="input"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="cly-token-help cly-token-note"
          />
          <p id="cly-token-help" className="ui-help">
            {t('tokenHelp')}
          </p>
          <p id="cly-token-note" className="ximp-note">
            {t('tokenNote')}
          </p>
        </div>
        <label className="ui-check">
          <input type="checkbox" checked={includeBookings} onChange={(e) => setIncludeBookings(e.target.checked)} />
          <span>
            {t('includeBookings')}
            <span className="ui-help"> · {t('includeBookingsHelp')}</span>
          </span>
        </label>
        <div className="ximp-actions">
          <button type="submit" className="btn btn-primary" disabled={token.trim().length < 8}>
            {t('preview')}
          </button>
        </div>
      </form>
      </>
    );
  } else if (job.status === 'fetching' || job.status === 'importing') {
    body = <ImportProgress job={job} onCancel={cancel} />;
  } else if (job.status === 'preview') {
    body = <PreviewView job={job} onConfirm={start} onCancel={cancel} />;
  } else if (job.status === 'done') {
    body = <DoneView job={job} onAgain={reset} />;
  } else {
    body = (
      <div className="ximp-done">
        <p className="ximp-note" data-tone="bad" role="alert">
          {t('failedTitle')} {errorText(job.error)}
        </p>
        <div>
          <button type="button" className="btn" onClick={reset}>
            {t('again')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ximp" data-testid="cal-import">
      <FormSection title={t('title')} description={t('lead')}>
        {error && (
          <p className="ximp-note" data-tone="bad" role="alert">
            {errorText(error)}{' '}
            <button type="button" className="btn btn-sm" onClick={() => setError(null)}>
              {t('dismiss')}
            </button>
          </p>
        )}
        {body}
      </FormSection>
    </div>
  );
}

function PreviewView({ job, onConfirm, onCancel }: { job: ImportJobView; onConfirm: () => Promise<void>; onCancel: () => void }) {
  const t = useTranslations('calendar.importer');
  const p = job.preview as unknown as Preview;
  const pending = p.eventTypes.filter((e) => !e.already).length + p.schedules.filter((s) => !s.already).length + (p.bookings - p.bookingsAlready);
  return (
    <div className="ximp" data-testid="cal-import-preview">
      <div className="ximp-stats">
        <ImportStat value={p.eventTypes.length} label={t('stat.eventTypes')} />
        <ImportStat value={p.schedules.length} label={t('stat.schedules')} />
        {p.includeBookings && <ImportStat value={p.bookings} label={t('stat.bookings')} />}
      </div>

      {p.eventTypes.length > 0 && (
        <section className="ximp-section">
          <h3>{t('eventTypesTitle')}</h3>
          <div className="table-wrap">
            <table className="table table-compact ximp-table">
              <thead>
                <tr>
                  <th scope="col">{t('colTitle')}</th>
                  <th scope="col" className="num">
                    {t('colDuration')}
                  </th>
                  <th scope="col" className="num">
                    {t('colLocations')}
                  </th>
                  <th scope="col" className="num">
                    {t('colQuestions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {p.eventTypes.map((e) => (
                  <tr key={e.slug + e.title}>
                    <td>
                      {e.title}
                      {e.already && <span className="ui-help"> · {t('already')}</span>}
                      {!e.active && <span className="ui-help"> · {t('inactive')}</span>}
                      {e.unmapped.length > 0 && <span className="ui-help"> · {t('unmapped', { kinds: e.unmapped.join(', ') })}</span>}
                    </td>
                    <td className="num data">{t('minutes', { n: e.durationMin })}</td>
                    <td className="num data">{e.locations}</td>
                    <td className="num data">{e.questions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {p.schedules.length > 0 && (
        <section className="ximp-section">
          <h3>{t('schedulesTitle')}</h3>
          <ul className="ximp-links">
            {p.schedules.map((s) => (
              <li key={s.name + s.timezone}>
                {s.name} <span className="ui-help">· {s.timezone} · {t('scheduleRules', { count: s.rules })}</span>
                {s.isDefault && <span className="ui-help"> · {t('defaultSchedule')}</span>}
                {s.already && <span className="ui-help"> · {t('already')}</span>}
              </li>
            ))}
          </ul>
          <p className="ui-help">{t('scheduleNote')}</p>
        </section>
      )}

      <ImportConfirm label={t('confirm')} onConfirm={onConfirm} onCancel={onCancel} disabled={pending === 0} />
    </div>
  );
}

function DoneView({ job, onAgain }: { job: ImportJobView; onAgain: () => void }) {
  const t = useTranslations('calendar.importer');
  const r = job.report as unknown as Report;
  return (
    <div className="ximp-done" data-testid="cal-import-done">
      <p role="status">
        <strong>{t('doneTitle')}</strong> {t('doneSummary', { eventTypes: r.eventTypes, schedules: r.schedules, bookings: r.bookings, skipped: r.skipped })}
      </p>
      {r.renamed.length > 0 && (
        <ul className="ximp-links">
          {r.renamed.map((x) => (
            <li key={x.to} className="ui-help">
              {t('renamed', { from: x.from, to: x.to })}
            </li>
          ))}
        </ul>
      )}
      {r.failed.length > 0 && (
        <p className="ximp-note" data-tone="warn">
          {t('failed', { titles: r.failed.map((f) => f.title).join(', ') })}
        </p>
      )}
      <div className="ximp-actions">
        <Link className="btn btn-primary" href="/app/calendar/event-types">
          {t('openEventTypes')}
        </Link>
        <button type="button" className="btn" onClick={onAgain}>
          {t('again')}
        </button>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
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

/**
 * Docs › Notion por API (dentro del hub de importación): token de una
 * integración interna → vista previa (cuenta, conteos, raíces) → qué traer
 * (páginas, bases, archivos) → progreso → informe (creadas, actualizadas,
 * saltadas, errores con motivo). El job vive en el servidor: al volver, la
 * pantalla retoma el que esté abierto.
 */

interface Preview {
  account: string;
  pages: number;
  databases: number;
  rows: number;
  people: number;
  peopleWithEmail: number;
  alreadyImported: number;
  localEdited?: number;
  estimateMinutes?: number;
  truncated?: boolean;
  maxItems: number;
  roots: Array<{ title: string; kind: 'page' | 'database' }>;
}

interface Report {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  pages: number;
  databases: number;
  rows: number;
  files: number;
  filesSkipped: number;
  errors: string[];
  errorCount: number;
  roots: Array<{ id: string; title: string }>;
  kept?: number;
  notMoved?: number;
}

const SOURCES = ['notion_api'] as const;

export default function NotionApiImportPanel({
  teamspaces,
  canWorkspace,
}: {
  teamspaces: Array<{ id: string; name: string }>;
  canWorkspace: boolean;
}) {
  const t = useTranslations('settings.importHub.notion');
  const errorText = useImportErrorText();
  const readFailedText = useReadFailedText();
  const { job, error, setError, loading, create, start, cancel, reset } = useImportJob('docs', SOURCES);
  const [token, setToken] = useState('');
  const [dest, setDest] = useState<string>(canWorkspace ? '' : (teamspaces[0]?.id ?? ''));
  const [busy, setBusy] = useState(false);
  const readFailed = failedReading(job);
  const status = job?.status ?? null;
  const tokenRef = useRef<HTMLInputElement>(null);

  // El token sale del formulario apenas Notion lo aceptó; si lo rechazó queda para corregirlo.
  useEffect(() => {
    if (status === 'preview' || status === 'importing' || status === 'done') setToken('');
  }, [status]);

  let body;
  if (loading) {
    body = (
      <p className="ui-help" role="status">
        {t('loading')}
      </p>
    );
  } else if (!job || readFailed) {
    body = (
      <form
        className="ui-fields"
        data-testid="notion-api-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (token.trim().length < 8 || busy) return;
          setBusy(true);
          await create({ source: 'notion_api', token: token.trim(), teamspace_id: dest || null });
          setBusy(false);
        }}
      >
        {readFailed && (
          <p className="ximp-note" data-tone="bad" role="alert" data-testid="import-read-failed">
            {readFailedText('Notion', job?.error)}
          </p>
        )}
        <div className="ui-field">
          <label className="label" htmlFor="notion-api-token">
            {t('token')}
          </label>
          <input
            id="notion-api-token"
            ref={tokenRef}
            className="input mono"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="ntn_…"
            aria-describedby="notion-api-token-help"
          />
          <p id="notion-api-token-help" className="ui-help">
            {t('tokenHelp')}
          </p>
        </div>
        {(teamspaces.length > 0 || !canWorkspace) && (
          <div className="ui-field">
            <label className="label" htmlFor="notion-api-dest">
              {t('destination')}
            </label>
            <select id="notion-api-dest" className="select" value={dest} onChange={(e) => setDest(e.target.value)}>
              {canWorkspace && <option value="">{t('destWorkspace')}</option>}
              {teamspaces.map((ts) => (
                <option key={ts.id} value={ts.id}>
                  {ts.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="ximp-actions">
          <button type="submit" className="btn btn-primary" disabled={token.trim().length < 8 || busy} aria-busy={busy || undefined}>
            {busy ? t('checking') : t('connect')}
          </button>
        </div>
      </form>
    );
  } else if (job.status === 'fetching' || job.status === 'importing') {
    body = <ImportProgress job={job} onCancel={cancel} />;
  } else if (job.status === 'preview') {
    body = <PreviewView job={job} teamspaces={teamspaces} onConfirm={(include) => start({ include })} onCancel={cancel} />;
  } else if (job.status === 'done') {
    body = <DoneView job={job} onAgain={reset} />;
  } else {
    body = (
      <div className="ximp-done" data-testid="notion-api-failed">
        <p className="ximp-note" data-tone="bad" role="alert">
          {t('failedTitle')} {errorText(job.error)}
        </p>
        {job.report && <ReportTable report={job.report as unknown as Report} />}
        <div className="ximp-actions">
          <button type="button" className="btn btn-primary" onClick={reset}>
            {t('retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ximp" data-testid="notion-api-import">
      {error && (
        <p className="ximp-note" data-tone="bad" role="alert">
          {errorText(error)}{' '}
          <button type="button" className="btn btn-sm" onClick={() => setError(null)}>
            {t('dismiss')}
          </button>
        </p>
      )}
      {body}
    </div>
  );
}

function PreviewView({
  job,
  teamspaces,
  onConfirm,
  onCancel,
}: {
  job: ImportJobView;
  teamspaces: Array<{ id: string; name: string }>;
  onConfirm: (include: { pages: boolean; databases: boolean; files: boolean; overwrite: boolean }) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations('settings.importHub.notion');
  const p = job.preview as unknown as Preview;
  const [include, setInclude] = useState({ pages: p.pages > 0, databases: p.databases > 0, files: true, overwrite: false });
  const destId = typeof job.options.teamspace_id === 'string' ? job.options.teamspace_id : null;
  const destName = destId ? (teamspaces.find((ts) => ts.id === destId)?.name ?? t('destTeamspace')) : t('destWorkspace');
  const empty = p.pages + p.databases === 0;
  const toggle = (k: keyof typeof include) => setInclude((prev) => ({ ...prev, [k]: !prev[k] }));
  return (
    <div className="ximp" data-testid="notion-api-preview">
      <p className="ximp-note" role="status">
        {p.account ? t('connectedTo', { account: p.account }) : t('connected')}
      </p>
      <div className="ximp-stats">
        <ImportStat value={p.pages} label={t('stat.pages')} />
        <ImportStat value={p.databases} label={t('stat.databases')} />
        <ImportStat value={p.rows} label={t('stat.rows')} />
        <ImportStat value={p.people} label={t('stat.people')} />
      </div>
      {empty && (
        <p className="ximp-note" data-tone="warn">
          {t('emptyShare')}
        </p>
      )}
      {p.truncated && (
        <p className="ximp-note" data-tone="warn">
          {t('truncated', { max: p.maxItems })}
        </p>
      )}
      <p className="ui-help" data-testid="notion-api-destination">
        {t('destinationIs', { dest: destName })}
        {typeof p.estimateMinutes === 'number' && <> · {t('estimate', { minutes: p.estimateMinutes })}</>}
      </p>
      {p.alreadyImported > 0 && <p className="ximp-note">{t('alreadyImported', { count: p.alreadyImported })}</p>}
      {(p.localEdited ?? 0) > 0 && (
        <div className="ximp-section" data-testid="notion-api-local-edits">
          <p className="ximp-note" data-tone="warn">
            {t('localEdited', { count: p.localEdited ?? 0 })}
          </p>
          <label className="ui-check">
            <input type="checkbox" checked={include.overwrite} onChange={() => toggle('overwrite')} />
            <span>{t('overwrite')}</span>
          </label>
        </div>
      )}
      {p.people > 0 && p.peopleWithEmail === 0 && <p className="ui-help">{t('noEmails')}</p>}

      {p.roots.length > 0 && (
        <section className="ximp-section">
          <h3>{t('rootsTitle')}</h3>
          <ul className="ximp-links">
            {p.roots.map((r, i) => (
              <li key={`${r.title}-${i}`}>
                {r.title}
                {r.kind === 'database' && <span className="ui-help"> · {t('kindDatabase')}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <fieldset className="ximp-fieldset ximp-section">
        <legend className="label">{t('whatToImport')}</legend>
        <label className="ui-check">
          <input type="checkbox" checked={include.pages} onChange={() => toggle('pages')} disabled={p.pages === 0} />
          <span>{t('includePages', { count: p.pages })}</span>
        </label>
        <label className="ui-check">
          <input type="checkbox" checked={include.databases} onChange={() => toggle('databases')} disabled={p.databases === 0} />
          <span>{t('includeDatabases', { count: p.databases, rows: p.rows })}</span>
        </label>
        <label className="ui-check">
          <input type="checkbox" checked={include.files} onChange={() => toggle('files')} />
          <span>
            {t('includeFiles')}
            <span className="ui-help"> · {t('includeFilesHelp')}</span>
          </span>
        </label>
      </fieldset>
      <p className="ui-help">{t('dedupe')}</p>
      <ImportConfirm label={t('confirm')} onConfirm={() => onConfirm(include)} onCancel={onCancel} disabled={!include.pages && !include.databases} />
    </div>
  );
}

function ReportTable({ report: r }: { report: Report }) {
  const t = useTranslations('settings.importHub.notion');
  const errorText = useImportErrorText();
  return (
    <>
      <div className="ximp-stats" data-testid="notion-api-report">
        <ImportStat value={r.created} label={t('stat.created')} />
        <ImportStat value={r.updated} label={t('stat.updated')} />
        <ImportStat value={r.skipped} label={t('stat.skipped')} />
        <ImportStat value={r.failed} label={t('stat.failed')} />
        <ImportStat value={r.databases} label={t('stat.databases')} />
        <ImportStat value={r.rows} label={t('stat.rows')} />
        <ImportStat value={r.files} label={t('stat.files')} />
      </div>
      {r.filesSkipped > 0 && <p className="ui-help">{t('filesSkipped', { count: r.filesSkipped })}</p>}
      {(r.kept ?? 0) > 0 && (
        <p className="ximp-note" data-testid="notion-api-kept">
          {t('keptNote', { count: r.kept ?? 0 })}
        </p>
      )}
      {(r.notMoved ?? 0) > 0 && <p className="ximp-note">{t('notMovedNote', { count: r.notMoved ?? 0 })}</p>}
      {r.errorCount > 0 && (
        <section className="ximp-section">
          <h3>{t('errorsTitle', { count: r.errorCount })}</h3>
          <ul className="ximp-links" data-testid="notion-api-errors">
            {r.errors.map((e, i) => {
              const at = e.lastIndexOf(': ');
              const title = at > 0 ? e.slice(0, at) : e;
              const code = at > 0 ? e.slice(at + 2) : '';
              return (
                <li key={i}>
                  <strong>{title}</strong>
                  {code && <span className="ui-help"> · {code === 'content_truncated' ? t('contentTruncated') : errorText(code)}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

function DoneView({ job, onAgain }: { job: ImportJobView; onAgain: () => void }) {
  const t = useTranslations('settings.importHub.notion');
  const r = job.report as unknown as Report;
  return (
    <div className="ximp-done" data-testid="notion-api-done">
      <p role="status">
        <strong>{t('doneTitle')}</strong> {t('doneSummary', { pages: r.pages, databases: r.databases, rows: r.rows })}
      </p>
      <ReportTable report={r} />
      {r.roots.length > 0 && (
        <ul className="ximp-links">
          {r.roots.map((x) => (
            <li key={x.id}>
              <Link href={`/app/docs/${x.id}`}>{x.title || t('untitled')}</Link>
            </li>
          ))}
        </ul>
      )}
      <div className="ximp-actions">
        <Link className="btn btn-primary" href="/app/docs">
          {t('openDocs')}
        </Link>
        <button type="button" className="btn" onClick={onAgain}>
          {t('again')}
        </button>
      </div>
    </div>
  );
}

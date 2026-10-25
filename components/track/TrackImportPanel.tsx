'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
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
import {
  CSV_FIELDS,
  csvHeaderSample,
  detectCsvPreset,
  suggestMapping,
  TRACK_IMPORT_MAX_CSV_BYTES,
  type CsvField,
  type CsvMapping,
} from '@/lib/track-import-map';

type Source = 'linear' | 'linear_csv' | 'jira' | 'jira_csv' | 'github' | 'asana' | 'shortcut' | 'csv';
const SOURCES: Source[] = ['linear', 'linear_csv', 'jira', 'jira_csv', 'github', 'asana', 'shortcut', 'csv'];
const CSV_SOURCES: Source[] = ['linear_csv', 'jira_csv', 'csv'];
/** Nombre de la fuente en el aviso de lectura fallida. */
const SOURCE_NAMES: Record<string, string> = {
  linear: 'Linear',
  github: 'GitHub',
  linear_csv: 'Linear',
  jira: 'Jira',
  jira_csv: 'Jira',
  asana: 'Asana',
  shortcut: 'Shortcut',
  csv: 'CSV',
};
/** Etiqueta y ayuda del campo del token por fuente (claves de track.importer). */
const TOKEN_KEYS: Partial<Record<Source, { label: string; help: string }>> = {
  linear: { label: 'linearToken', help: 'linearHelp' },
  github: { label: 'githubToken', help: 'githubHelp' },
  jira: { label: 'jiraToken', help: 'jiraHelp' },
  asana: { label: 'asanaToken', help: 'asanaHelp' },
  shortcut: { label: 'shortcutToken', help: 'shortcutHelp' },
};
const JIRA_SITE_RE = /^(https:\/\/)?[a-z0-9-]+\.(atlassian\.net|jira\.com)\/?$/i;
const ASANA_PROJECT_RE = /^\d{6,25}$|\/project\/\d{6,25}|app\.asana\.com\/0\/\d{6,25}/;
const PRESET: Record<string, 'linear' | 'jira' | 'csv'> = { linear_csv: 'linear', jira_csv: 'jira', csv: 'csv' };

interface ProjectOption {
  id: string;
  name: string;
}

interface Preview {
  issues: number;
  comments: number;
  alreadyImported: number;
  truncated?: boolean;
  projects: Array<{ name: string; issues: number; existing: string | null }>;
  statuses: Array<{ name: string; category: string; issues: number; existing: boolean }>;
  people: Array<{ label: string; issues: number; member: string | null }>;
  labels: { total: number; existing: number };
  cycles: number;
  milestones: number;
  estimates: number;
  sample: Array<{ key: string | null; title: string; status: string; assignee: string | null }>;
}

interface Report {
  issues: number;
  skipped: number;
  comments: number;
  projectsCreated: number;
  statusesCreated: number;
  cyclesCreated: number;
  milestonesCreated: number;
  unassigned: number;
  parents: number;
  projects: Array<{ id: string; name: string }>;
}

/**
 * Track › Ajustes › Importar y exportar: issues desde Linear (API key o CSV),
 * Jira Cloud (API o CSV), GitHub Issues, Asana y Shortcut (token) o un CSV
 * con mapeo de columnas.
 * Primero una vista previa con conteos y mapeo; después se confirma.
 */
export default function TrackImportPanel({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations('track.importer');
  const errorText = useImportErrorText();
  const readFailedText = useReadFailedText();
  const { job, error, setError, loading, create, start, cancel, reset } = useImportJob('track');
  const readFailed = failedReading(job);
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  useEffect(() => {
    fetch('/api/track/projects?meta=1')
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows?: ProjectOption[] }) => setProjects((d.rows ?? []).map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => setProjects([]));
  }, [job?.status]);

  if (!isAdmin) {
    return (
      <FormSection title={t('title')} description={t('lead')}>
        <p className="ximp-note">{t('adminOnly')}</p>
      </FormSection>
    );
  }

  // El formulario queda montado (oculto) mientras se lee la fuente: si el
  // token se rechaza vuelve con todo lo cargado.
  const showForm = !loading && (!job || readFailed);
  let body;
  if (loading) body = <p className="ui-help">{t('loadingJobs')}</p>;
  else if (!job) body = null;
  else if (readFailed) {
    body = (
      <p className="ximp-note" data-tone="bad" role="alert" data-testid="import-read-failed">
        {readFailedText(SOURCE_NAMES[job.source] ?? job.source, job.error)}
      </p>
    );
  } else if (job.status === 'fetching' || job.status === 'importing') {
    body = <ImportProgress job={job} onCancel={cancel} stageLabel={(s) => (t.has(`stages.${s}`) ? t(`stages.${s}`) : null)} />;
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
    <div className="ximp" data-testid="track-import">
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
        {!loading && (
          <div hidden={!showForm}>
            <ImportForm projects={projects} onCreate={create} jobStatus={job?.status ?? null} />
          </div>
        )}
      </FormSection>
      <ExportSection projects={projects} />
    </div>
  );
}

function ImportForm({
  projects,
  onCreate,
  jobStatus,
}: {
  projects: ProjectOption[];
  onCreate: (body: Record<string, unknown>) => Promise<ImportJobView | null>;
  jobStatus: ImportJobView['status'] | null;
}) {
  const t = useTranslations('track.importer');
  const [source, setSource] = useState<Source>('linear');
  const [token, setToken] = useState('');
  const [repo, setRepo] = useState('');
  const [site, setSite] = useState('');
  const [email, setEmail] = useState('');
  const [query, setQuery] = useState('');
  const [asanaProject, setAsanaProject] = useState('');
  const [target, setTarget] = useState('new');
  const [csv, setCsv] = useState<{ name: string; text: string; headers: string[]; rows: number } | null>(null);
  const [mapping, setMapping] = useState<CsvMapping>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isCsv = CSV_SOURCES.includes(source);

  // El token se borra del formulario cuando ya se leyó la fuente (vista previa
  // o después); si la lectura falla queda para corregirlo.
  useEffect(() => {
    if (jobStatus === 'preview' || jobStatus === 'importing' || jobStatus === 'done') setToken('');
  }, [jobStatus]);

  async function pickFile(file: File | null) {
    setFileError(null);
    setCsv(null);
    if (!file) return;
    if (file.size > TRACK_IMPORT_MAX_CSV_BYTES) {
      setFileError(t('csvTooLarge'));
      return;
    }
    const text = await file.text();
    const { headers, rows } = csvHeaderSample(text);
    if (headers.length === 0) {
      setFileError(t('csvEmpty'));
      return;
    }
    // Si el archivo es de Linear o Jira, se usa ese preset aunque se haya elegido otro CSV.
    const detected = detectCsvPreset(headers);
    const next: Source = source === 'csv' && detected !== 'csv' ? (`${detected}_csv` as Source) : source;
    setSource(next);
    setMapping(suggestMapping(headers, PRESET[next]));
    setCsv({ name: file.name.replace(/\.csv$/i, ''), text, headers, rows });
  }

  const tokenOk = token.trim().length >= 8;
  const ready = isCsv
    ? Boolean(csv && mapping.title)
    : source === 'github'
      ? tokenOk && /^[^/\s]+\/[^/\s]+$/.test(repo.trim().replace(/^https?:\/\/github\.com\//, ''))
      : source === 'jira'
        ? tokenOk && JIRA_SITE_RE.test(site.trim()) && /\S+@\S+/.test(email.trim()) && query.trim().length > 0
        : source === 'asana'
          ? tokenOk && ASANA_PROJECT_RE.test(asanaProject.trim())
          : tokenOk;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    const body: Record<string, unknown> = { source, target };
    if (isCsv) Object.assign(body, { csv: csv!.text, mapping, projectName: csv!.name });
    else {
      Object.assign(body, { token: token.trim() });
      if (source === 'github') body.repo = repo.trim();
      if (source === 'jira') Object.assign(body, { site: site.trim(), email: email.trim(), query: query.trim() });
      if (source === 'asana') body.project = asanaProject.trim();
      if (source === 'shortcut') body.query = query.trim();
    }
    await onCreate(body);
    setBusy(false);
  }

  return (
    <form
      className="ui-fields"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="ui-fields-2">
        <div className="ui-field">
          <label className="label" htmlFor="imp-source">
            {t('source')}
          </label>
          <select
            id="imp-source"
            className="select"
            value={source}
            onChange={(e) => {
              setSource(e.target.value as Source);
              setCsv(null);
              setMapping({});
            }}
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(`sources.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="imp-target">
            {t('target')}
          </label>
          <select id="imp-target" className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="new">{t('targetNew', { kind: t(`kinds.${source}`) })}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {source === 'github' && (
        <div className="ui-field">
          <label className="label" htmlFor="imp-repo">
            {t('githubRepo')}
          </label>
          <input id="imp-repo" className="input data" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" autoComplete="off" spellCheck={false} />
        </div>
      )}

      {source === 'jira' && (
        <>
          <div className="ui-fields-2">
            <div className="ui-field">
              <label className="label" htmlFor="imp-jira-site">
                {t('jiraSite')}
              </label>
              <input id="imp-jira-site" className="input data" value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://acme.atlassian.net" autoComplete="off" spellCheck={false} />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="imp-jira-email">
                {t('jiraEmail')}
              </label>
              <input id="imp-jira-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" spellCheck={false} />
            </div>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="imp-jira-query">
              {t('jiraQuery')}
            </label>
            <input id="imp-jira-query" className="input data" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ENG" autoComplete="off" spellCheck={false} aria-describedby="imp-jira-query-help" />
            <p id="imp-jira-query-help" className="ui-help">
              {t('jiraQueryHelp')}
            </p>
          </div>
        </>
      )}

      {source === 'asana' && (
        <div className="ui-field">
          <label className="label" htmlFor="imp-asana-project">
            {t('asanaProject')}
          </label>
          <input id="imp-asana-project" className="input data" value={asanaProject} onChange={(e) => setAsanaProject(e.target.value)} placeholder="https://app.asana.com/0/1201234567890/list" autoComplete="off" spellCheck={false} aria-describedby="imp-asana-project-help" />
          <p id="imp-asana-project-help" className="ui-help">
            {t('asanaProjectHelp')}
          </p>
        </div>
      )}

      {source === 'shortcut' && (
        <div className="ui-field">
          <label className="label" htmlFor="imp-shortcut-query">
            {t('shortcutQuery')}
          </label>
          <input id="imp-shortcut-query" className="input data" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="!is:archived" autoComplete="off" spellCheck={false} aria-describedby="imp-shortcut-query-help" />
          <p id="imp-shortcut-query-help" className="ui-help">
            {t('shortcutQueryHelp')}
          </p>
        </div>
      )}

      {!isCsv && (
        <div className="ui-field">
          <label className="label" htmlFor="imp-token">
            {t(TOKEN_KEYS[source]?.label ?? 'linearToken')}
          </label>
          <input
            id="imp-token"
            className="input"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="imp-token-help imp-token-note"
          />
          <p id="imp-token-help" className="ui-help">
            {t(TOKEN_KEYS[source]?.help ?? 'linearHelp')}
          </p>
          <p id="imp-token-note" className="ximp-note">
            {t('tokenNote')}
          </p>
        </div>
      )}

      {isCsv && (
        <div className="ui-field">
          <label className="label" htmlFor="imp-file">
            {t('csvFile')}
          </label>
          <input
            id="imp-file"
            className="input ximp-file-input"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
            aria-describedby="imp-file-help"
          />
          <p id="imp-file-help" className="ui-help">
            {t(`csvHelp.${source}`)}
          </p>
          {fileError && (
            <p className="ui-error" role="alert">
              {fileError}
            </p>
          )}
        </div>
      )}

      {isCsv && csv && <MappingEditor headers={csv.headers} rows={csv.rows} mapping={mapping} onChange={setMapping} />}

      {source === 'linear' || source === 'linear_csv' ? <p className="ui-help">{t('linearNote')}</p> : null}
      {source === 'asana' || source === 'shortcut' ? <p className="ui-help">{t(`${source}Note`)}</p> : null}

      <div className="ximp-actions">
        <button type="submit" className="btn btn-primary" disabled={!ready || busy} aria-busy={busy || undefined}>
          {t('preview')}
        </button>
      </div>
    </form>
  );
}

function MappingEditor({ headers, rows, mapping, onChange }: { headers: string[]; rows: number; mapping: CsvMapping; onChange: (m: CsvMapping) => void }) {
  const t = useTranslations('track.importer');
  const unique = useMemo(() => [...new Set(headers.filter(Boolean))], [headers]);
  return (
    <fieldset className="ximp-section ximp-fieldset">
      <legend className="label">{t('mapping')}</legend>
      <p className="ui-help">
        {t('csvRows', { count: rows, columns: headers.length })} · {t('mappingHelp')}
      </p>
      <div className="ximp-map">
        {CSV_FIELDS.map((field: CsvField) => (
          <FieldRow key={field} field={field} value={mapping[field] ?? ''} options={unique} onChange={(v) => onChange({ ...mapping, [field]: v || undefined })} />
        ))}
      </div>
    </fieldset>
  );
}

function FieldRow({ field, value, options, onChange }: { field: CsvField; value: string; options: string[]; onChange: (v: string) => void }) {
  const t = useTranslations('track.importer');
  const id = `imp-map-${field}`;
  return (
    <>
      <label className="label" htmlFor={id}>
        {t(`fields.${field}`)}
        {field === 'title' && ' *'}
      </label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)} required={field === 'title'}>
        <option value="">{t('none')}</option>
        {options.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </>
  );
}

function PreviewView({ job, onConfirm, onCancel }: { job: ImportJobView; onConfirm: () => Promise<void>; onCancel: () => void }) {
  const t = useTranslations('track.importer');
  const p = job.preview as unknown as Preview;
  const toImport = Math.max(0, p.issues - p.alreadyImported);
  const unmatched = p.people.filter((x) => !x.member);
  return (
    <div className="ximp" data-testid="track-import-preview">
      <div className="ximp-stats">
        <ImportStat value={p.issues} label={t('stat.issues')} />
        <ImportStat value={p.comments} label={t('stat.comments')} />
        <ImportStat value={p.projects.length} label={t('stat.projects')} />
        <ImportStat value={p.labels.total} label={t('stat.labels')} />
        <ImportStat value={p.cycles} label={t('stat.cycles')} />
        <ImportStat value={p.milestones} label={t('stat.milestones')} />
      </div>
      {p.alreadyImported > 0 && <p className="ximp-note">{t('already', { count: p.alreadyImported })}</p>}
      {p.truncated && (
        <p className="ximp-note" data-tone="warn">
          {t('truncated')}
        </p>
      )}

      <section className="ximp-section">
        <h3>{t('projectsTitle')}</h3>
        <ul className="ximp-links">
          {p.projects.map((x) => (
            <li key={x.name}>
              {x.name} <span className="ui-help">· {x.existing ? t('projectExisting') : t('projectNew')} · {t('issuesCount', { count: x.issues })}</span>
            </li>
          ))}
        </ul>
      </section>

      {p.statuses.length > 0 && (
        <section className="ximp-section">
          <h3>{t('statusesTitle')}</h3>
          <div className="table-wrap">
            <table className="table table-compact ximp-table">
              <thead>
                <tr>
                  <th scope="col">{t('statusCol')}</th>
                  <th scope="col">{t('categoryCol')}</th>
                  <th scope="col">{t('mapCol')}</th>
                  <th scope="col" className="num">
                    {t('issuesCol')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {p.statuses.map((s) => (
                  <tr key={`${s.name}:${s.category}`}>
                    <td>{s.name || t('statusDefault', { category: t(`categories.${s.category}`) })}</td>
                    <td>{t(`categories.${s.category}`)}</td>
                    <td>{s.existing ? t('statusExisting') : t('statusNew')}</td>
                    <td className="num data">{s.issues}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {p.people.length > 0 && (
        <section className="ximp-section">
          <h3>{t('peopleTitle')}</h3>
          {unmatched.length > 0 && <p className="ximp-note" data-tone="warn">{t('unmatchedNote', { count: unmatched.length })}</p>}
          <div className="table-wrap">
            <table className="table table-compact ximp-table">
              <thead>
                <tr>
                  <th scope="col">{t('personCol')}</th>
                  <th scope="col">{t('memberCol')}</th>
                  <th scope="col" className="num">
                    {t('issuesCol')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {p.people.map((x) => (
                  <tr key={x.label}>
                    <td className="data">{x.label}</td>
                    <td>{x.member ?? <span className="ui-help">{t('unmatched')}</span>}</td>
                    <td className="num data">{x.issues}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {p.sample.length > 0 && (
        <section className="ximp-section">
          <h3>{t('sampleTitle')}</h3>
          <ul className="ximp-links">
            {p.sample.map((s, i) => (
              <li key={i}>
                {s.key && <span className="data">{s.key} </span>}
                {s.title} <span className="ui-help">· {t.has(`categories.${s.status}`) ? t(`categories.${s.status}`) : s.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ImportConfirm label={t('confirm', { count: toImport })} onConfirm={onConfirm} onCancel={onCancel} disabled={p.issues === 0} />
    </div>
  );
}

function DoneView({ job, onAgain }: { job: ImportJobView; onAgain: () => void }) {
  const t = useTranslations('track.importer');
  const locale = useLocale();
  const r = job.report as unknown as Report;
  // Solo lo que se creó: "Se creó 1 proyecto y 4 status."
  const parts = [
    ['projects', r.projectsCreated],
    ['statuses', r.statusesCreated],
    ['cycles', r.cyclesCreated],
    ['milestones', r.milestonesCreated],
  ] as const;
  const created = parts.filter(([, n]) => n > 0).map(([k, n]) => t(`createdPart.${k}`, { count: n }));
  const createdTotal = parts.reduce((sum, [, n]) => sum + n, 0);
  return (
    <div className="ximp-done" data-testid="track-import-done">
      <p role="status">
        <strong>{t('doneTitle')}</strong> {t('doneSummary', { issues: r.issues, comments: r.comments, skipped: r.skipped })}
      </p>
      {created.length > 0 && (
        <p className="ui-help">
          {t('doneCreated', { count: createdTotal, list: new Intl.ListFormat(locale, { type: 'conjunction' }).format(created) })}
        </p>
      )}
      {r.unassigned > 0 && (
        <p className="ximp-note" data-tone="warn">
          {t('doneUnassigned', { count: r.unassigned })}
        </p>
      )}
      {r.projects.length > 0 && (
        <ul className="ximp-links">
          {r.projects.map((p) => (
            <li key={p.id}>
              <Link href={`/app/track/projects/${p.id}`}>{t('openProject', { name: p.name })}</Link>
            </li>
          ))}
        </ul>
      )}
      <div>
        <button type="button" className="btn" onClick={onAgain}>
          {t('again')}
        </button>
      </div>
    </div>
  );
}

function ExportSection({ projects }: { projects: ProjectOption[] }) {
  const t = useTranslations('track.importer');
  const [projectId, setProjectId] = useState('');
  const href = projectId ? `/api/track/export?projectId=${encodeURIComponent(projectId)}` : '/api/track/export';
  return (
    <FormSection
      title={t('exportTitle')}
      description={t('exportLead')}
      footer={
        <a className="btn" href={href} download data-testid="track-export">
          {t('exportButton')}
        </a>
      }
    >
      <div className="ui-field">
        <label className="label" htmlFor="imp-export-project">
          {t('exportProject')}
        </label>
        <select id="imp-export-project" className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">{t('exportAll')}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
    </FormSection>
  );
}

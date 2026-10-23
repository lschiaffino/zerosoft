'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { ImportJobView } from '@/lib/crm-import-jobs';
import type { ImportGroup, ImportProvider } from '@/lib/crm-import-source';

/** Permisos de la Private App de HubSpot (lib/crm-import-hubspot.ts). Se repiten acá: el módulo es server-only. */
const HUBSPOT_SCOPES = [
  'crm.objects.contacts.read',
  'crm.objects.companies.read',
  'crm.objects.deals.read',
  'crm.objects.owners.read',
  'crm.schemas.contacts.read',
  'crm.schemas.companies.read',
  'crm.schemas.deals.read',
  'sales-email-read',
];

const GROUPS: ImportGroup[] = ['companies', 'contacts', 'deals', 'activities'];
const PROVIDERS: ImportProvider[] = ['hubspot', 'pipedrive'];
const NAMES: Record<ImportProvider, string> = { hubspot: 'HubSpot', pipedrive: 'Pipedrive' };

interface Person {
  id: string;
  label: string;
  email: string;
}

type View =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'pick' }
  | { kind: 'connect'; provider: ImportProvider }
  | { kind: 'job'; job: ImportJobView };

const ACTIVE = new Set(['queued', 'running']);

/**
 * Migración desde HubSpot o Pipedrive por API: tarjetas → token → vista previa
 * (conteos, muestra, campos, pipelines, owners) → progreso → resumen. El
 * progreso vive en el servidor (job): al recargar, la pantalla vuelve al job
 * activo. Mientras está abierta empuja tramos (POST .../run); con la pestaña
 * cerrada sigue el cron.
 */
export default function CrmMigrationPanel({
  canAdmin,
  initialProvider = null,
  locale,
}: {
  canAdmin: boolean;
  initialProvider?: ImportProvider | null;
  locale: string;
}) {
  const t = useTranslations('crm.migrate');
  const tc = useTranslations('crm');
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [history, setHistory] = useState<ImportJobView[]>([]);
  const [people, setPeople] = useState<Person[]>([]);

  const load = useCallback(async () => {
    const res = await fetch('/api/crm/import/jobs').catch(() => null);
    if (!res || !res.ok) {
      setView({ kind: 'error' });
      return;
    }
    const data = (await res.json()) as { active: ImportJobView | null; jobs: ImportJobView[]; people: Person[] };
    setHistory(data.jobs);
    setPeople(data.people);
    if (data.active) setView({ kind: 'job', job: data.active });
    else setView(initialProvider ? { kind: 'connect', provider: initialProvider } : { kind: 'pick' });
  }, [initialProvider]);

  useEffect(() => {
    if (!canAdmin) return;
    void load();
  }, [canAdmin, load]);

  if (!canAdmin) return <p className="ui-help">{tc('common.adminOnly')}</p>;
  if (view.kind === 'loading') {
    return (
      <p className="muted" role="status">
        {t('loading')}
      </p>
    );
  }
  if (view.kind === 'error') {
    return (
      <div className="mig-body">
        <p className="form-error">{t('loadError')}</p>
        <div className="form-actions">
          <button type="button" className="btn btn-small" onClick={() => void load()}>
            {t('retry')}
          </button>
        </div>
      </div>
    );
  }

  if (view.kind === 'connect') {
    return (
      <ConnectStep
        provider={view.provider}
        onBack={() => setView({ kind: 'pick' })}
        onPreview={(job) => setView({ kind: 'job', job })}
      />
    );
  }

  if (view.kind === 'job') {
    const job = view.job;
    if (job.status === 'preview') {
      return (
        <PreviewStep
          job={job}
          people={people}
          onChange={(next) => setView({ kind: 'job', job: next })}
          onCancel={() => void load()}
        />
      );
    }
    return (
      <ProgressStep
        job={job}
        locale={locale}
        onChange={(next) => {
          setView({ kind: 'job', job: next });
          if (!ACTIVE.has(next.status)) router.refresh();
        }}
        onDone={(provider) => {
          void load().then(() => setView(provider ? { kind: 'connect', provider } : { kind: 'pick' }));
        }}
      />
    );
  }

  return (
    <div className="mig-body">
      <div className="mig-cards">
        {PROVIDERS.map((p) => (
          <div key={p} className="panel mig-card" data-testid={`migrate-card-${p}`}>
            <h3 className="mig-card-title">{t('cardTitle', { provider: NAMES[p] })}</h3>
            <p className="muted mig-card-body">{t(`cardBody.${p}`)}</p>
            <button type="button" className="btn btn-solid btn-small" onClick={() => setView({ kind: 'connect', provider: p })}>
              {t('cardCta', { provider: NAMES[p] })}
            </button>
          </div>
        ))}
      </div>
      {history.length > 0 && (
        <div className="mig-history">
          <p className="label">{t('history')}</p>
          <ul className="mig-history-list">
            {history.map((j) => (
              <li key={j.id} className="mig-history-row">
                <span>{NAMES[j.provider]}</span>
                <span className="muted">{formatDate(j.createdAt, locale)}</span>
                <span className="mono">{t(`status.${j.status}`)}</span>
                <span className="muted">
                  {t('historyCounts', {
                    contacts: j.counts.contacts.created + j.counts.contacts.updated,
                    companies: j.counts.companies.created + j.counts.companies.updated,
                    deals: j.counts.deals.created + j.counts.deals.updated,
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function formatDate(raw: string, locale: string): string {
  const d = new Date(`${raw.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? raw : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

function errorText(t: ReturnType<typeof useTranslations>, code: string | undefined): string {
  return code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.provider_error');
}

// ---------- Paso 1: token ----------

function ConnectStep({
  provider,
  onBack,
  onPreview,
}: {
  provider: ImportProvider;
  onBack: () => void;
  onPreview: (job: ImportJobView) => void;
}) {
  const t = useTranslations('crm.migrate');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/crm/import/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, token: token.trim() }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.status === 201) {
      setToken('');
      onPreview((await res.json()) as ImportJobView);
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    setError(errorText(t, data?.error));
  }

  return (
    <form className="mig-body" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onBack()}>
      <h3 className="mig-title">{t('connectTitle', { provider: NAMES[provider] })}</h3>
      <ol className="mig-steps-list">
        {(provider === 'hubspot' ? ['hs1', 'hs2', 'hs3'] : ['pd1', 'pd2']).map((k) => (
          <li key={k}>{t(`howto.${k}`)}</li>
        ))}
      </ol>
      {provider === 'hubspot' && (
        <div>
          <p className="label">{t('scopes')}</p>
          <ul className="mig-scopes mono">
            {HUBSPOT_SCOPES.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p className="muted mig-note">{t('scopesNote')}</p>
        </div>
      )}
      <label className="mig-field">
        <span className="label">{t(provider === 'hubspot' ? 'tokenLabelHubspot' : 'tokenLabelPipedrive')}</span>
        <input
          ref={inputRef}
          className="input mono"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          aria-describedby="mig-token-help"
        />
      </label>
      <p id="mig-token-help" className="muted mig-note">
        {t('tokenHelp')}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="btn btn-small" onClick={onBack} disabled={busy}>
          {t('back')}
        </button>
        <button type="submit" className="btn btn-solid btn-small" disabled={!token.trim() || busy} aria-busy={busy}>
          {busy ? t('reading') : t('connect')}
        </button>
      </div>
    </form>
  );
}

// ---------- Paso 2: vista previa ----------

function PreviewStep({
  job,
  people,
  onChange,
  onCancel,
}: {
  job: ImportJobView;
  people: Person[];
  onChange: (job: ImportJobView) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('crm.migrate');
  const p = job.preview;
  const [groups, setGroups] = useState<ImportGroup[]>(job.options.groups);
  const [ownerMap, setOwnerMap] = useState<Record<string, string>>(job.options.ownerMap);
  const [defaultOwner, setDefaultOwner] = useState(job.options.defaultOwnerId || people[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phaseCount = (g: ImportGroup): number | null => {
    const phases = Object.entries(p.counts).filter(([ph]) =>
      g === 'activities' ? !['companies', 'contacts', 'deals'].includes(ph) : ph === g,
    );
    if (!phases.length) return 0;
    let sum = 0;
    for (const [, n] of phases) {
      if (n === null || n === undefined) return null;
      sum += n;
    }
    return sum;
  };

  async function start() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/import/jobs/${job.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groups, ownerMap, defaultOwnerId: defaultOwner }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.ok) {
      onChange((await res.json()) as ImportJobView);
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    setError(errorText(t, data?.error));
  }

  async function cancel() {
    setBusy(true);
    await fetch(`/api/crm/import/jobs/${job.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    onCancel();
  }

  const unmatched = p.owners.filter((o) => !ownerMap[o.id]).length;

  return (
    <div className="mig-body" data-testid="migrate-preview">
      <h3 className="mig-title">{t('previewTitle', { provider: NAMES[job.provider] })}</h3>
      <p className="muted">{t('previewIntro')}</p>

      <fieldset className="mig-groups">
        <legend className="label">{t('whatToImport')}</legend>
        <div className="stat-cards mig-count-cards">
          {GROUPS.map((g) => {
            const n = phaseCount(g);
            const on = groups.includes(g);
            return (
              <label key={g} className="panel stat-card mig-count" data-on={on ? 'true' : 'false'}>
                <span className="mig-count-check">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => setGroups((prev) => (on ? prev.filter((x) => x !== g) : [...prev, g]))}
                  />
                  <span className="stat-label">{t(`groups.${g}`)}</span>
                </span>
                <span className="stat-num" data-testid={`migrate-count-${g}`}>
                  {n === null ? t('unknownCount') : n.toLocaleString()}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {p.unavailable.length > 0 && <p className="muted mig-note">{t('unavailable', { phases: p.unavailable.join(', ') })}</p>}
      <p className="muted mig-note">{t('dedupeNote')}</p>
      {p.previouslyImported > 0 && (
        <p className="mig-note" role="status">
          {t('previouslyImported', { count: p.previouslyImported })}
        </p>
      )}

      <div className="mig-samples">
        <SampleTable
          title={t('groups.contacts')}
          rows={p.samples.contacts.map((c) => [c.name || '-', c.email || '-'])}
          heads={[t('col.name'), t('col.email')]}
          empty={t('noSample')}
        />
        <SampleTable
          title={t('groups.companies')}
          rows={p.samples.companies.map((c) => [c.name || '-', c.domain || '-'])}
          heads={[t('col.name'), t('col.domain')]}
          empty={t('noSample')}
        />
        <SampleTable
          title={t('groups.deals')}
          rows={p.samples.deals.map((d) => [d.name || '-', d.amount === null ? '-' : `${d.amount.toLocaleString()} ${d.currency}`])}
          heads={[t('col.name'), t('col.amount')]}
          empty={t('noSample')}
        />
      </div>

      <div className="mig-section">
        <p className="label">{t('ownersTitle')}</p>
        <p className="muted mig-note">
          {unmatched > 0 ? t('ownersUnmatched', { count: unmatched }) : t('ownersAllMatched')}
        </p>
        {p.owners.length > 0 && (
          <div className="table-wrap">
            <table className="table mig-table" data-testid="migrate-owners">
              <thead>
                <tr>
                  <th>{t('col.owner', { provider: NAMES[job.provider] })}</th>
                  <th>{t('col.assignTo')}</th>
                </tr>
              </thead>
              <tbody>
                {p.owners.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <span>{o.name || o.email}</span>
                      {o.name && o.email && <span className="muted mig-sub"> {o.email}</span>}
                    </td>
                    <td>
                      <select
                        className="filter-select"
                        aria-label={t('assignFor', { name: o.name || o.email })}
                        value={ownerMap[o.id] ?? ''}
                        onChange={(e) => setOwnerMap((prev) => ({ ...prev, [o.id]: e.target.value }))}
                      >
                        <option value="">{t('defaultOwnerOption')}</option>
                        {people.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.label}
                          </option>
                        ))}
                      </select>
                      <span className="muted mig-sub"> {o.matchId && ownerMap[o.id] === o.matchId ? t('matchedByEmail') : ''}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <label className="mig-inline">
          <span className="label">{t('defaultOwner')}</span>
          <select className="filter-select" value={defaultOwner} onChange={(e) => setDefaultOwner(e.target.value)}>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {p.fields.length > 0 && (
        <div className="mig-section">
          <p className="label">{t('fieldsTitle', { count: p.fields.length })}</p>
          <div className="table-wrap">
            <table className="table mig-table" data-testid="migrate-fields">
              <thead>
                <tr>
                  <th>{t('col.field')}</th>
                  <th>{t('col.object')}</th>
                  <th>{t('col.type')}</th>
                  <th>{t('col.action')}</th>
                </tr>
              </thead>
              <tbody>
                {p.fields.map((f) => (
                  <tr key={`${f.entity}:${f.key}`}>
                    <td>{f.label}</td>
                    <td className="muted">{t(`groups.${f.entity}`)}</td>
                    <td className="mono">{f.type}</td>
                    <td>{f.existing ? t('useExisting') : t('createNew')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {p.pipelines.length > 0 && (
        <div className="mig-section">
          <p className="label">{t('pipelinesTitle')}</p>
          <ul className="mig-pipelines">
            {p.pipelines.map((pl) => (
              <li key={pl.id}>
                <span className="mig-pipeline-name">{pl.name}</span>{' '}
                <span className="muted">({pl.existing ? t('useExisting') : t('createNew')})</span>
                <span className="muted mig-stages">
                  {pl.stages
                    .map((s) => `${s.name} ${s.probability}%${s.isWon ? ` · ${t('won')}` : s.isLost ? ` · ${t('lost')}` : ''}`)
                    .join(' / ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="btn btn-small" onClick={() => void cancel()} disabled={busy}>
          {t('cancel')}
        </button>
        <button
          type="button"
          className="btn btn-solid btn-small"
          onClick={() => void start()}
          disabled={busy || !groups.length || !defaultOwner}
          aria-busy={busy}
        >
          {t('start')}
        </button>
      </div>
    </div>
  );
}

function SampleTable({ title, heads, rows, empty }: { title: string; heads: string[]; rows: string[][]; empty: string }) {
  return (
    <div className="mig-sample">
      <p className="label">{title}</p>
      {rows.length === 0 ? (
        <p className="muted mig-note">{empty}</p>
      ) : (
        <table className="table mig-table">
          <thead>
            <tr>
              {heads.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------- Paso 3: progreso y resumen ----------

function ProgressStep({
  job,
  locale,
  onChange,
  onDone,
}: {
  job: ImportJobView;
  locale: string;
  onChange: (job: ImportJobView) => void;
  onDone: (rerun: ImportProvider | null) => void;
}) {
  const t = useTranslations('crm.migrate');
  const [cancelling, setCancelling] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const active = ACTIVE.has(job.status);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Mientras está activo: empuja un tramo, actualiza y repite. Si falla la red, espera y reintenta.
  useEffect(() => {
    if (!active) return;
    let stop = false;
    (async () => {
      while (!stop) {
        const res = await fetch(`/api/crm/import/jobs/${job.id}/run`, { method: 'POST' }).catch(() => null);
        if (stop) return;
        if (res && res.ok) {
          const next = (await res.json()) as ImportJobView;
          if (stop) return;
          onChangeRef.current(next);
          if (!ACTIVE.has(next.status)) return;
          await new Promise((r) => setTimeout(r, 800));
        } else {
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, [active, job.id]);

  async function cancel() {
    setCancelling(true);
    const res = await fetch(`/api/crm/import/jobs/${job.id}`, { method: 'DELETE' }).catch(() => null);
    setCancelling(false);
    setConfirm(false);
    if (res && res.ok) onChange((await res.json()) as ImportJobView);
  }

  const pct = job.progress === null ? null : Math.round(job.progress * 100);
  const groups = GROUPS.filter((g) => job.options.groups.includes(g));

  return (
    <div className="mig-body" data-testid="migrate-progress" data-status={job.status}>
      <h3 className="mig-title">
        {active ? t('importingTitle', { provider: NAMES[job.provider] }) : t(`doneTitle.${job.status}`, { provider: NAMES[job.provider] })}
      </h3>
      {active && (
        <>
          <div
            className="mig-bar"
            role="progressbar"
            aria-label={t('progressLabel')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct ?? undefined}
            data-indeterminate={pct === null ? 'true' : undefined}
          >
            <span style={pct === null ? undefined : { width: `${pct}%` }} />
          </div>
          <p className="muted mig-note" role="status">
            {job.phase ? t('phaseNow', { phase: t(`phases.${job.phase}`) }) : t('queued')}
            {pct !== null ? ` · ${pct}%` : ''}
          </p>
          <p className="muted mig-note">{t('backgroundNote')}</p>
        </>
      )}
      {job.status === 'failed' && (
        <p className="form-error" role="alert">
          {t.has(`failure.${job.failure.replace(/_\d+$/, '')}`) ? t(`failure.${job.failure.replace(/_\d+$/, '')}`) : t('failure.generic')}
        </p>
      )}
      {job.status === 'cancelled' && <p className="muted">{t('cancelledNote')}</p>}

      <div className="table-wrap">
        <table className="table mig-table" data-testid="migrate-counts">
          <thead>
            <tr>
              <th>{t('col.object')}</th>
              <th>{t('col.processed')}</th>
              <th>{t('col.created')}</th>
              <th>{t('col.updated')}</th>
              <th>{t('col.skipped')}</th>
              <th>{t('col.failed')}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const c = job.counts[g];
              return (
                <tr key={g} data-group={g}>
                  <td>{t(`groups.${g}`)}</td>
                  <td className="mono">
                    {c.processed.toLocaleString(locale)}
                    {c.total !== null ? ` / ${c.total.toLocaleString(locale)}` : ''}
                  </td>
                  <td className="mono" data-col="created">{c.created.toLocaleString(locale)}</td>
                  <td className="mono" data-col="updated">{c.updated.toLocaleString(locale)}</td>
                  <td className="mono">{c.skipped.toLocaleString(locale)}</td>
                  <td className="mono">{c.failed.toLocaleString(locale)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {job.errorCount > 0 && (
        <div className="imp-errors">
          <p className="label">
            {t('warnings')} ({job.errorCount})
          </p>
          <ul className="imp-error-list">
            {job.errors.map((e, i) => (
              <li key={i} className="mono">
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="form-actions">
        {active ? (
          confirm ? (
            <>
              <span className="muted">{t('cancelConfirm')}</span>
              <button type="button" className="btn btn-small" onClick={() => setConfirm(false)} disabled={cancelling}>
                {t('keepGoing')}
              </button>
              <button type="button" className="btn btn-danger btn-small" onClick={() => void cancel()} disabled={cancelling}>
                {t('cancelImport')}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-small" onClick={() => setConfirm(true)}>
              {t('cancelImport')}
            </button>
          )
        ) : (
          <>
            <button type="button" className="btn btn-small" onClick={() => onDone(null)}>
              {t('backToImport')}
            </button>
            <button type="button" className="btn btn-small" onClick={() => onDone(job.provider)}>
              {t('rerun')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

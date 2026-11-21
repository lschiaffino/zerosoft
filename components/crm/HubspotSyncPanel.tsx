'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import LocalText from '@/components/ui/LocalText';
import HubspotInboundSync from './HubspotInboundSync';
import HubspotOutboundSync from './HubspotOutboundSync';
import { HubspotKeyHelp, HubspotKeySummary, HubspotMissingScopes, HubspotScopeList } from '@/components/hubspot/HubspotKeyHelp';
import type { HubspotSyncStatus } from '@/lib/crm-hubspot-sync/connection';
import {
  PREVIEW_ACTIVE,
  PREVIEW_OBJECTS,
  PREVIEW_SAMPLE_SIZE,
  reviewTotal,
  type ObjectReport,
  type PreviewBucket,
  type PreviewObject,
  type PreviewReport,
  type PreviewSample,
  type PreviewView,
} from '@/lib/crm-hubspot-sync/types';

/**
 * CRM › Ajustes › Integraciones › Sync con HubSpot: conectar la cuenta (S1),
 * traer HubSpot al CRM y mantenerlo al día (S2, HubspotInboundSync), escribir
 * lo de acá en HubSpot (S3, HubspotOutboundSync, apagado por defecto) y ver qué
 * haría un sync antes de escribir nada (la vista previa). Solo admins: el
 * informe muestra registros de todo el workspace.
 */

const API = '/api/crm/hubspot-sync';
type T = ReturnType<typeof useTranslations>;

/** Grupos del informe en el orden en que se leen: lo que pasaría y después lo que hay que mirar. */
const BUCKET_ORDER: PreviewBucket[] = [
  'matched',
  'create_zerosoft',
  'create_hubspot',
  'update',
  'linked',
  'multi_hubspot',
  'multi_zerosoft',
  'duplicate_zerosoft',
  'conflict',
  'no_key_hubspot',
  'no_key_zerosoft',
  'gone_hubspot',
];
const RECORD_PATH: Record<PreviewObject, string> = { contacts: 'contacts', companies: 'companies', deals: 'deals' };
const HUBSPOT_TYPE: Record<PreviewObject, string> = { contacts: '0-1', companies: '0-2', deals: '0-3' };

function formatDate(raw: string | null, locale: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

async function readJson<X>(res: Response | null): Promise<X | null> {
  if (!res) return null;
  return (await res.json().catch(() => null)) as X | null;
}

export default function HubspotSyncPanel({ canAdmin, locale }: { canAdmin: boolean; locale: string }) {
  const t = useTranslations('crm.hubspotSync');
  const tc = useTranslations('crm');
  const [status, setStatus] = useState<HubspotSyncStatus | null>(null);
  const [preview, setPreview] = useState<PreviewView | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    const [s, p] = await Promise.all([fetch(API).catch(() => null), fetch(`${API}/preview`).catch(() => null)]);
    if (!s || !s.ok || !p || !p.ok) {
      setFailed(true);
      return;
    }
    setStatus((await s.json()) as HubspotSyncStatus);
    setPreview(((await p.json()) as { preview: PreviewView | null }).preview);
  }, []);

  useEffect(() => {
    if (canAdmin) void load();
  }, [canAdmin, load]);

  if (!canAdmin) return <p className="ui-help">{tc('common.adminOnly')}</p>;
  if (failed) {
    return (
      <div className="hsync">
        <p className="form-error" role="alert">
          {t('loadError')}
        </p>
        <div className="form-actions">
          <button type="button" className="btn btn-small" onClick={() => void load()}>
            {t('retry')}
          </button>
        </div>
      </div>
    );
  }
  if (!status) {
    return (
      <p className="muted" role="status">
        {t('loading')}
      </p>
    );
  }

  return (
    <div className="hsync" data-testid="hubspot-sync" data-connected={status.connected}>
      <ConnectCard
        status={status}
        locale={locale}
        onChange={(next) => {
          setStatus(next);
          // Otra cuenta o sin conexión: la vista previa anterior ya no vale.
          void fetch(`${API}/preview`)
            .then((r) => (r.ok ? (r.json() as Promise<{ preview: PreviewView | null }>) : null))
            .then((d) => d && setPreview(d.preview))
            .catch(() => null);
        }}
      />
      {status.connected ? (
        <>
          <HubspotInboundSync key={`${status.portalId}:${status.checkedAt ?? ''}`} locale={locale} />
          <HubspotOutboundSync key={`out:${status.portalId}:${status.checkedAt ?? ''}`} locale={locale} />
        </>
      ) : (
        <div className="hsync-state" data-testid="hubspot-sync-off">
          <p className="hsync-state-title">{t('off.title')}</p>
          <p className="ui-help">{t('off.body')}</p>
        </div>
      )}
      {status.connected && <PreviewSection status={status} preview={preview} locale={locale} onChange={setPreview} />}
    </div>
  );
}

// ---------- Conexión ----------

function errorText(t: T, code: string | undefined): string {
  return code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.provider_error');
}

function ConnectCard({ status, locale, onChange }: { status: HubspotSyncStatus; locale: string; onChange: (s: HubspotSyncStatus) => void }) {
  const t = useTranslations('crm.hubspotSync');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<'' | 'connect' | 'lines' | 'recheck' | 'disconnect'>('');
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [replacing, setReplacing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);

  // La confirmación de desconectar se cierra con Esc y al hacer clic afuera.
  useEffect(() => {
    if (!confirm) return;
    confirmRef.current?.querySelector('button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setConfirm(false);
    const onDown = (e: MouseEvent) => {
      if (confirmRef.current && !confirmRef.current.contains(e.target as Node)) setConfirm(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [confirm]);

  async function post(kind: 'connect' | 'lines' | 'recheck', body: Record<string, unknown>) {
    if (busy) return;
    setBusy(kind);
    setError(null);
    setMissing([]);
    const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    setBusy('');
    if (res && res.ok) {
      setToken('');
      setReplacing(false);
      onChange((await res.json()) as HubspotSyncStatus);
      return;
    }
    const data = await readJson<{ error?: string; missing?: unknown }>(res);
    const lacks = Array.isArray(data?.missing) ? data.missing.filter((x): x is string => typeof x === 'string').slice(0, 30) : [];
    if (data?.error === 'missing_scope' && lacks.length) setMissing(lacks);
    else setError(errorText(t, data?.error));
  }

  async function disconnect() {
    setBusy('disconnect');
    setError(null);
    const res = await fetch(API, { method: 'DELETE' }).catch(() => null);
    setBusy('');
    setConfirm(false);
    if (!res || !res.ok) {
      setError(errorText(t, undefined));
      return;
    }
    const next = await fetch(API).catch(() => null);
    if (next && next.ok) onChange((await next.json()) as HubspotSyncStatus);
  }

  const showForm = !status.connected || replacing;

  return (
    <div role="group" className="hsync-card" data-testid="hubspot-sync-connect" aria-label={t('connect.title')}>
      <h3 className="hsync-title">{t('connect.title')}</h3>
      {status.connected && (
        <>
          <HubspotKeySummary portalId={status.portalId} kind={status.tokenKind} scopes={status.scopes} missing={status.missingWrite} />
          {status.missingWrite.length > 0 && (
            <p className="ui-help" data-testid="hubspot-sync-write-later">
              {t('connect.writeLater')}
            </p>
          )}
          {status.unknownWrite.length > 0 && (
            <p className="ui-help" data-testid="hubspot-sync-write-unknown">
              {t('connect.writeUnknown')}
            </p>
          )}
          <p className="ui-help hsync-meta">
            {status.keySource === 'lines' && <span data-testid="hubspot-sync-from-lines">{t('connect.fromLines')}</span>}
            {status.checkedAt && (
              <span>
                {t('connect.checked')} <LocalText>{formatDate(status.checkedAt, locale)}</LocalText>
              </span>
            )}
          </p>
          {status.lastError && (
            <p className="form-error" role="alert" data-testid="hubspot-sync-key-problem">
              {t.has(`keyProblems.${status.lastError}`) ? t(`keyProblems.${status.lastError}`) : t('keyProblems.provider_error')}
            </p>
          )}
          <div className="form-actions hsync-actions">
            <button type="button" className="btn btn-small" onClick={() => void post('recheck', { recheck: true })} disabled={Boolean(busy)} aria-busy={busy === 'recheck'}>
              {busy === 'recheck' ? t('connect.checking') : t('connect.recheck')}
            </button>
            <button type="button" className="btn btn-small" onClick={() => setReplacing((v) => !v)} disabled={Boolean(busy)} aria-expanded={replacing}>
              {t('connect.replace')}
            </button>
            <button type="button" className="btn btn-small" onClick={() => setConfirm(true)} disabled={Boolean(busy)} aria-expanded={confirm}>
              {t('connect.disconnect')}
            </button>
          </div>
          {confirm && (
            <div className="hsync-confirm" ref={confirmRef} role="alertdialog" aria-label={t('connect.disconnectTitle')} data-testid="hubspot-sync-disconnect-confirm">
              <p>{t('connect.disconnectBody')}</p>
              <div className="form-actions hsync-actions">
                <button type="button" className="btn btn-small" onClick={() => setConfirm(false)} disabled={busy === 'disconnect'}>
                  {t('connect.keep')}
                </button>
                <button type="button" className="btn btn-solid btn-small" onClick={() => void disconnect()} disabled={busy === 'disconnect'} aria-busy={busy === 'disconnect'}>
                  {t('connect.disconnectConfirm')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {showForm && (
        <form
          className="hsync-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (token.trim()) void post('connect', { token: token.trim() });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && replacing) setReplacing(false);
          }}
        >
          {!status.connected && <p className="ui-help">{t('connect.intro')}</p>}
          {status.linesKeyAvailable && !status.connected && (
            <div className="hsync-lines" data-testid="hubspot-sync-lines">
              <p>{t('connect.linesBody')}</p>
              <button type="button" className="btn btn-solid btn-small" onClick={() => void post('lines', { useLinesKey: true })} disabled={Boolean(busy)} aria-busy={busy === 'lines'}>
                {busy === 'lines' ? t('connect.checking') : t('connect.linesCta')}
              </button>
            </div>
          )}
          <HubspotKeyHelp />
          <div className="hsync-scopes">
            <div>
              <p className="label">{t('connect.scopesNow')}</p>
              <HubspotScopeList scopes={status.requiredScopes.read} testId="hubspot-sync-scopes-read" />
            </div>
            <div>
              <p className="label">{t('connect.scopesLater')}</p>
              <HubspotScopeList scopes={status.requiredScopes.write} testId="hubspot-sync-scopes-write" />
            </div>
          </div>
          <label className="mig-field">
            <span className="label">{t('connect.keyLabel')}</span>
            <input className="input mono" type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} aria-describedby="hsync-key-help" />
          </label>
          <p id="hsync-key-help" className="ui-help">
            {t('connect.keyHelp')}
          </p>
          <div className="form-actions hsync-actions">
            {replacing && (
              <button type="button" className="btn btn-small" onClick={() => setReplacing(false)} disabled={Boolean(busy)}>
                {t('connect.cancelReplace')}
              </button>
            )}
            <button type="submit" className="btn btn-solid btn-small" disabled={!token.trim() || Boolean(busy)} aria-busy={busy === 'connect'}>
              {busy === 'connect' ? t('connect.checking') : t('connect.cta')}
            </button>
          </div>
        </form>
      )}
      {missing.length > 0 && <HubspotMissingScopes scopes={missing} />}
      {error && (
        <p className="form-error" role="alert" data-testid="hubspot-sync-error">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------- Vista previa ----------

const isActive = (p: PreviewView | null) => Boolean(p && PREVIEW_ACTIVE.includes(p.status));

function PreviewSection({ status, preview, locale, onChange }: { status: HubspotSyncStatus; preview: PreviewView | null; locale: string; onChange: (p: PreviewView | null) => void }) {
  const t = useTranslations('crm.hubspotSync');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = isActive(preview);
  const previewId = preview?.id ?? '';
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Mientras corre: empuja un tramo, muestra cómo quedó y repite. En espera (límite diario) solo mira cada tanto.
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      while (!stop) {
        const res = await fetch(`${API}/preview/run`, { method: 'POST' }).catch(() => null);
        if (stop) return;
        const data = res && res.ok ? await readJson<{ preview: PreviewView | null }>(res) : null;
        if (stop) return;
        if (!data) {
          await wait(5000);
          continue;
        }
        onChangeRef.current(data.preview);
        if (!isActive(data.preview)) return;
        await wait(data.preview?.status === 'waiting' ? 30_000 : data.preview?.failure ? 3000 : 300);
      }
    })();
    return () => {
      stop = true;
    };
  }, [active, previewId]);

  async function start() {
    setBusy(true);
    setError(null);
    const res = await fetch(`${API}/preview`, { method: 'POST' }).catch(() => null);
    setBusy(false);
    const data = await readJson<{ preview?: PreviewView; error?: string }>(res);
    if (res && res.ok && data?.preview) onChange(data.preview);
    else setError(errorText(t, data?.error));
  }

  async function cancel() {
    setBusy(true);
    const res = await fetch(`${API}/preview`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    const data = await readJson<{ preview?: PreviewView | null }>(res);
    if (res && res.ok) onChange(data?.preview ?? null);
  }

  const done = preview?.status === 'done' && preview.report;

  return (
    <div role="group" className="hsync-card" data-testid="hubspot-sync-preview" data-status={preview?.status ?? 'none'} aria-label={t('preview.title')}>
      <h3 className="hsync-title">{t('preview.title')}</h3>
      <p className="ui-help">{t('preview.desc')}</p>
      {active && preview && <Progress preview={preview} locale={locale} />}
      {preview?.status === 'failed' && (
        <p className="form-error" role="alert" data-testid="hubspot-sync-preview-failed">
          {t.has(`failures.${preview.failure}`) ? t(`failures.${preview.failure}`) : t('failures.provider_error')}
        </p>
      )}
      {preview?.status === 'cancelled' && (
        <p className="ui-help" role="status" data-testid="hubspot-sync-preview-cancelled">
          {t('preview.cancelled')}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions hsync-actions">
        {active ? (
          <button type="button" className="btn btn-small" onClick={() => void cancel()} disabled={busy} aria-busy={busy}>
            {t('preview.cancel')}
          </button>
        ) : (
          <button type="button" className="btn btn-solid btn-small" onClick={() => void start()} disabled={busy} aria-busy={busy} data-testid="hubspot-sync-preview-run">
            {busy ? t('preview.starting') : done ? t('preview.again') : t('preview.run')}
          </button>
        )}
      </div>
      {done && preview.report && <Report report={preview.report} preview={preview} status={status} locale={locale} />}
    </div>
  );
}

function Progress({ preview, locale }: { preview: PreviewView; locale: string }) {
  const t = useTranslations('crm.hubspotSync');
  const nf = new Intl.NumberFormat(locale);
  const waiting = preview.status === 'waiting';
  return (
    <div className="hsync-progress" data-testid="hubspot-sync-progress" data-stage={preview.progress.stage}>
      <p role="status" className="hsync-progress-title">
        {waiting ? t('progress.waiting') : t(`progress.stage.${preview.progress.stage}`)}
      </p>
      {waiting && preview.resumeAfter && (
        <p className="ui-help">
          {t('progress.resume')} <LocalText>{formatDate(preview.resumeAfter, locale)}</LocalText>
        </p>
      )}
      {!waiting && (
        <div className="mig-bar" role="progressbar" aria-label={t('progress.label')} data-indeterminate="true">
          <span />
        </div>
      )}
      <ul className="hsync-progress-list">
        {PREVIEW_OBJECTS.map((o) => {
          const p = preview.progress.objects[o];
          if (!p) return null;
          return (
            <li key={o}>
              <span>{t(`objects.${o}`)}</span>
              <span className="mono">{p.total === null ? t('progress.read', { n: nf.format(p.read) }) : t('progress.readOf', { n: nf.format(p.read), total: nf.format(p.total) })}</span>
            </li>
          );
        })}
      </ul>
      <p className="ui-help">{t('progress.leave')}</p>
    </div>
  );
}

// ---------- Informe ----------

function Report({ report, preview, status, locale }: { report: PreviewReport; preview: PreviewView; status: HubspotSyncStatus; locale: string }) {
  const t = useTranslations('crm.hubspotSync');
  return (
    <div className="hsync-report" data-testid="hubspot-sync-report">
      <div className="hsync-state" data-testid="hubspot-sync-nothing-written">
        <p className="hsync-state-title">{t('report.nothingWritten')}</p>
        <p className="ui-help">
          {t('report.ranAt')} <LocalText>{formatDate(preview.finishedAt, locale)}</LocalText>
        </p>
      </div>
      {PREVIEW_OBJECTS.some((o) => report.objects[o]?.incomplete) && (
        <p className="form-error" role="status" data-testid="hubspot-sync-report-incomplete">
          {t('report.incomplete', {
            objects: PREVIEW_OBJECTS.filter((o) => report.objects[o]?.incomplete)
              .map((o) => t(`objects.${o}`))
              .join(', '),
          })}
        </p>
      )}
      {PREVIEW_OBJECTS.map((o) => {
        const r = report.objects[o];
        return r ? <ObjectCard key={o} object={o} report={r} status={status} locale={locale} /> : null;
      })}
      <SchemaSections report={report} locale={locale} />
      <details className="hsync-bucket" data-testid="hubspot-sync-limits">
        <summary>{t('limits.title')}</summary>
        <ul className="hsync-list">
          {(['custom', 'activities', 'associations', 'archived', 'moment'] as const).map((k) => (
            <li key={k}>{t(`limits.${k}`)}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function ObjectCard({ object, report, status, locale }: { object: PreviewObject; report: ObjectReport; status: HubspotSyncStatus; locale: string }) {
  const t = useTranslations('crm.hubspotSync');
  const nf = new Intl.NumberFormat(locale);
  const review = reviewTotal(report);
  const stats: Array<{ key: string; value: number }> = [
    { key: 'hubspot', value: report.hubspot },
    { key: 'zerosoft', value: report.zerosoft },
    { key: 'linked', value: report.counts.linked },
    { key: 'matched', value: report.counts.matched },
    { key: 'create_zerosoft', value: report.counts.create_zerosoft },
    { key: 'create_hubspot', value: report.counts.create_hubspot },
    { key: 'update', value: report.counts.update },
    { key: 'review', value: review },
  ];
  return (
    <div role="group" className="hsync-object" data-testid={`hubspot-sync-object-${object}`} aria-label={t(`objects.${object}`)}>
      <h4 className="hsync-object-title">{t(`objects.${object}`)}</h4>
      <dl className="hsync-stats">
        {stats.map((s) => (
          <div key={s.key} className="hsync-stat" data-warn={s.key === 'review' && s.value > 0}>
            <dt>{t(`stats.${s.key}`)}</dt>
            <dd className="mono" data-testid={`hubspot-sync-${object}-${s.key}`}>
              {nf.format(s.value)}
            </dd>
          </div>
        ))}
      </dl>
      {object === 'deals' && <p className="ui-help">{t('report.dealsNote')}</p>}
      {BUCKET_ORDER.filter((b) => report.counts[b] > 0).map((b) => (
        <details key={b} className="hsync-bucket" data-testid={`hubspot-sync-${object}-bucket-${b}`}>
          <summary>
            <span>{t(`buckets.${b}.title`)}</span>
            <span className="mono hsync-count">{nf.format(report.counts[b])}</span>
          </summary>
          <p className="ui-help">{t(`buckets.${b}.${object}`)}</p>
          {b === 'update' && (
            <p className="ui-help" data-testid={`hubspot-sync-${object}-update-detail`}>
              {t('report.updateDetail', { conflicting: nf.format(report.update.conflicting), hubspot: nf.format(report.update.hubspotNewer), zerosoft: nf.format(report.update.zerosoftNewer) })}
            </p>
          )}
          <Samples object={object} bucket={b} rows={report.samples[b] ?? []} total={report.counts[b]} status={status} />
        </details>
      ))}
    </div>
  );
}

function Samples({ object, bucket, rows, total, status }: { object: PreviewObject; bucket: PreviewBucket; rows: PreviewSample[]; total: number; status: HubspotSyncStatus }) {
  const t = useTranslations('crm.hubspotSync');
  if (!rows.length) return null;
  const fieldNames = (list: string[] | undefined) => (list ?? []).map((f) => (t.has(`fields.${f}`) ? t(`fields.${f}`) : f)).join(', ');
  const hubspotUrl = (id: string) => `https://${status.uiDomain || 'app.hubspot.com'}/contacts/${status.portalId}/record/${HUBSPOT_TYPE[object]}/${encodeURIComponent(id)}`;
  return (
    <div className="hsync-samples">
      <ul className="hsync-sample-list">
        {rows.map((r, i) => (
          <li key={`${r.hubspotId ?? ''}:${r.zerosoftId ?? ''}:${i}`} className="hsync-sample">
            <div className="hsync-sample-main">
              <span className="hsync-sample-label">{r.label || t('report.unnamed')}</span>
              {r.detail && <span className="muted hsync-sample-detail">{r.detail}</span>}
            </div>
            {bucket === 'update' && (
              <div className="hsync-sample-diff ui-help">
                {r.conflicting && r.conflicting.length > 0 && <span>{t('report.differs', { fields: fieldNames(r.conflicting) })}</span>}
                {r.filling && r.filling.length > 0 && <span>{t('report.fills', { fields: fieldNames(r.filling) })}</span>}
                {r.newer && <span>{t(`report.newer.${r.newer}`)}</span>}
              </div>
            )}
            <div className="hsync-sample-links">
              {r.zerosoftId && <Link href={`/app/crm/${RECORD_PATH[object]}/${r.zerosoftId}`}>{t('report.openHere')}</Link>}
              {r.hubspotId && (
                <a href={hubspotUrl(r.hubspotId)} target="_blank" rel="noopener noreferrer">
                  {t('report.openHubspot')}
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
      {total > rows.length && <p className="ui-help">{t('report.sampleNote', { shown: rows.length, max: PREVIEW_SAMPLE_SIZE })}</p>}
    </div>
  );
}

function SchemaSections({ report, locale }: { report: PreviewReport; locale: string }) {
  const t = useTranslations('crm.hubspotSync');
  const nf = new Intl.NumberFormat(locale);
  const { owners, pipelines, properties } = report;
  const more = (shown: number, total: number) => (total > shown ? <p className="ui-help">{t('report.more', { n: nf.format(total - shown) })}</p> : null);
  return (
    <div role="group" className="hsync-object" data-testid="hubspot-sync-schema" aria-label={t('schema.title')}>
      <h4 className="hsync-object-title">{t('schema.title')}</h4>
      <p className="ui-help">{t('schema.desc')}</p>
      {owners && (
        <details className="hsync-bucket" data-testid="hubspot-sync-owners">
          <summary>
            <span>{t('schema.owners.title')}</span>
            <span className="mono hsync-count">{t('schema.owners.count', { matched: nf.format(owners.matched), total: nf.format(owners.hubspot) })}</span>
          </summary>
          <p className="ui-help">{t('schema.owners.desc')}</p>
          {owners.hubspotOnlyTotal > 0 && (
            <>
              <p className="label">{t('schema.owners.hubspotOnly', { n: nf.format(owners.hubspotOnlyTotal) })}</p>
              <ul className="hsync-list" data-testid="hubspot-sync-owners-hubspot-only">
                {owners.hubspotOnly.map((p, i) => (
                  <li key={`${p.email}:${i}`}>
                    <span>{p.name || p.email}</span> {p.name && p.email && <span className="muted">{p.email}</span>}
                  </li>
                ))}
              </ul>
              {more(owners.hubspotOnly.length, owners.hubspotOnlyTotal)}
            </>
          )}
          {owners.zerosoftOnlyTotal > 0 && (
            <>
              <p className="label">{t('schema.owners.zerosoftOnly', { n: nf.format(owners.zerosoftOnlyTotal) })}</p>
              <ul className="hsync-list">
                {owners.zerosoftOnly.map((p, i) => (
                  <li key={`${p.email}:${i}`}>
                    <span>{p.name || p.email}</span> {p.name && p.email && <span className="muted">{p.email}</span>}
                  </li>
                ))}
              </ul>
              {more(owners.zerosoftOnly.length, owners.zerosoftOnlyTotal)}
            </>
          )}
          {owners.archived > 0 && <p className="ui-help">{t('schema.owners.archived', { n: nf.format(owners.archived) })}</p>}
        </details>
      )}
      {pipelines && (
        <details className="hsync-bucket" data-testid="hubspot-sync-pipelines">
          <summary>
            <span>{t('schema.pipelines.title')}</span>
            <span className="mono hsync-count">
              {t('schema.pipelines.count', { matched: nf.format(pipelines.hubspot.filter((p) => p.match).length), total: nf.format(pipelines.hubspot.length) })}
            </span>
          </summary>
          <p className="ui-help">{t('schema.pipelines.desc')}</p>
          <ul className="hsync-list">
            {pipelines.hubspot.map((p, i) => (
              <li key={`${p.name}:${i}`} data-matched={Boolean(p.match)}>
                <span className="hsync-sample-label">{p.name}</span>{' '}
                <span className="muted">{p.match ? t('schema.pipelines.matched', { name: p.match }) : t('schema.pipelines.unmatched')}</span>
                {p.match && p.stages.some((s) => !s.matched) && (
                  <span className="hsync-sub">
                    {t('schema.pipelines.stagesMissing', {
                      stages: p.stages
                        .filter((s) => !s.matched)
                        .map((s) => s.name)
                        .join(', '),
                    })}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {pipelines.zerosoftOnly.length > 0 && (
            <>
              <p className="label">{t('schema.pipelines.zerosoftOnly')}</p>
              <ul className="hsync-list">
                {pipelines.zerosoftOnly.map((p, i) => (
                  <li key={`${p.name}:${i}`}>{p.name}</li>
                ))}
              </ul>
            </>
          )}
          {pipelines.zerosoftOnlyStages.length > 0 && (
            <>
              <p className="label">{t('schema.pipelines.zerosoftOnlyStages')}</p>
              <ul className="hsync-list">
                {pipelines.zerosoftOnlyStages.map((s, i) => (
                  <li key={`${s.pipeline}:${s.stage}:${i}`}>
                    {s.stage} <span className="muted">{s.pipeline}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </details>
      )}
      {properties &&
        PREVIEW_OBJECTS.map((o) => {
          const p = properties[o];
          if (!p) return null;
          return (
            <details key={o} className="hsync-bucket" data-testid={`hubspot-sync-properties-${o}`}>
              <summary>
                <span>{t(`schema.properties.title.${o}`)}</span>
                <span className="mono hsync-count">{t('schema.properties.count', { n: nf.format(p.hubspotOnlyTotal + p.zerosoftOnlyTotal) })}</span>
              </summary>
              <p className="ui-help">
                {t('schema.properties.standard', {
                  n: nf.format(p.standard.length),
                  fields: p.standard.map((f) => (t.has(`fields.${f}`) ? t(`fields.${f}`) : f)).join(', '),
                })}
              </p>
              {p.readOnlyInHubspot.length > 0 && (
                <p className="ui-help">{t('schema.properties.readOnly', { fields: p.readOnlyInHubspot.map((f) => (t.has(`fields.${f}`) ? t(`fields.${f}`) : f)).join(', ') })}</p>
              )}
              {p.customMatched > 0 && <p className="ui-help">{t('schema.properties.customMatched', { n: nf.format(p.customMatched) })}</p>}
              {p.hubspotOnlyTotal > 0 && (
                <>
                  <p className="label">{t('schema.properties.hubspotOnly', { n: nf.format(p.hubspotOnlyTotal) })}</p>
                  <ul className="hsync-list" data-testid={`hubspot-sync-properties-${o}-hubspot-only`}>
                    {p.hubspotOnly.map((x) => (
                      <li key={x.name}>
                        {x.label} <code>{x.name}</code>
                      </li>
                    ))}
                  </ul>
                  {more(p.hubspotOnly.length, p.hubspotOnlyTotal)}
                </>
              )}
              {p.zerosoftOnlyTotal > 0 && (
                <>
                  <p className="label">{t('schema.properties.zerosoftOnly', { n: nf.format(p.zerosoftOnlyTotal) })}</p>
                  <ul className="hsync-list">
                    {p.zerosoftOnly.map((x) => (
                      <li key={x.name}>{x.label}</li>
                    ))}
                  </ul>
                  {more(p.zerosoftOnly.length, p.zerosoftOnlyTotal)}
                </>
              )}
              {p.zerosoftStandardOnly.length > 0 && (
                <p className="ui-help">{t('schema.properties.standardOnly', { fields: p.zerosoftStandardOnly.map((f) => (t.has(`localFields.${f}`) ? t(`localFields.${f}`) : f)).join(', ') })}</p>
              )}
              {p.hubspotBuiltIn > 0 && <p className="ui-help">{t('schema.properties.builtIn', { n: nf.format(p.hubspotBuiltIn) })}</p>}
            </details>
          );
        })}
    </div>
  );
}

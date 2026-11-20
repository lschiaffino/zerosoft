'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PeriskopeKind, PeriskopeResult } from '@/lib/groups-periskope';
import type { PeriskopeApiResult } from '@/lib/groups-periskope-api';
import { api, useErrorText } from './ui';

const MAX_BYTES = 4 * 1024 * 1024;

const KINDS: PeriskopeKind[] = ['chats', 'contacts', 'labels', 'quick_replies'];

/**
 * Ajustes › Migrar: traer de Periskope. Con la clave de su API (lo
 * recomendado): etiquetas, asignado y propiedades de los chats, etiquetas de
 * contactos, tickets y notas privadas. Con CSV: lo mismo de chats y contactos
 * más etiquetas y respuestas rápidas (que la API no expone). En los dos,
 * primero una vista previa (no escribe), después importar.
 */
export default function PeriskopeImport() {
  const t = useTranslations('groups');
  return (
    <div className="ui-fields" data-testid="periskope-import">
      <p className="ui-help">{t('migrate.intro')}</p>
      <section className="ui-section" aria-labelledby="psk-api-h">
        <div className="ui-section-body">
          <div className="ui-section-head">
            <h2 className="ui-section-title" id="psk-api-h">
              {t('migrate.api.title')}
            </h2>
          </div>
          <PeriskopeApiImport />
        </div>
      </section>
      <section className="ui-section" aria-labelledby="psk-csv-h">
        <div className="ui-section-body">
          <div className="ui-section-head">
            <h2 className="ui-section-title" id="psk-csv-h">
              {t('migrate.csvTitle')}
            </h2>
          </div>
          <PeriskopeCsvImport />
        </div>
      </section>
    </div>
  );
}

/** Por API: la clave se manda en cada pedido y no se guarda. */
function PeriskopeApiImport() {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PeriskopeApiResult | null>(null);

  async function run(preview: boolean) {
    setBusy(true);
    setError('');
    const res = await api<PeriskopeApiResult>('/api/groups/periskope', { body: { source: 'api', key, preview } });
    setBusy(false);
    if (!res.data) return setError(errText(res.error));
    setResult(res.data);
  }

  const total = result ? result.chats.applied + result.contacts.applied + result.tickets.applied + result.notes.applied : 0;
  // Los avisos por motivo, con cuántas veces (en la API no hay "fila N" que sirva).
  const reasons = new Map<string, number>();
  if (result) {
    for (const i of [...result.chats.issues, ...result.contacts.issues, ...result.tickets.issues, ...result.notes.issues]) {
      const [base, detail] = i.reason.split(':');
      const n = base === 'notes_chat_not_found' ? Number(detail) || 1 : 1;
      const k = base === 'notes_chat_not_found' ? 'chat_not_found' : base;
      reasons.set(k, (reasons.get(k) ?? 0) + n);
    }
  }
  const reasonText = (base: string) => (t.has(`migrate.issues.${base}`) ? t(`migrate.issues.${base}`, { detail: '' }) : base);

  return (
    <div className="ui-fields">
      <ol className="gr-steps">
        <li>{t('migrate.step1')}</li>
        <li>{t('migrate.api.step2')}</li>
        <li>{t('migrate.api.step3')}</li>
      </ol>
      <label className="ui-field">
        <span className="label">{t('migrate.api.key')}</span>
        <input
          className="input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          data-testid="periskope-api-key"
          onChange={(e) => {
            setKey(e.target.value);
            setResult(null);
          }}
        />
        <span className="ui-help">{t('migrate.api.keyHelp')}</span>
      </label>
      <div className="gr-inline-form">
        <button type="button" className="btn btn-secondary" data-testid="periskope-api-preview" disabled={!key.trim() || busy} onClick={() => void run(true)}>
          {t('migrate.preview')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="periskope-api-run"
          disabled={!key.trim() || busy || !result?.dryRun || total === 0}
          onClick={() => void run(false)}
          aria-busy={busy || undefined}
        >
          {t('migrate.import')}
        </button>
      </div>
      {busy && (
        <p className="ui-help" role="status">
          {t('migrate.api.working')}
        </p>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div
          className={`gr-banner gr-import-result${total ? ' is-ok' : ' is-warn'}`}
          role="status"
          data-testid="periskope-api-result"
          data-dry-run={result.dryRun ? '1' : '0'}
          data-applied={total}
          data-tickets={result.tickets.applied}
          data-notes={result.notes.applied}
        >
          <strong>{result.dryRun ? t('migrate.api.previewTitle') : t('migrate.api.doneTitle')}</strong>
          <ul>
            <li>{t('migrate.api.chats', { applied: result.chats.applied, rows: result.chats.rows })}</li>
            <li>{t('migrate.api.contacts', { applied: result.contacts.applied, rows: result.contacts.rows })}</li>
            <li>{t('migrate.api.tickets', { applied: result.tickets.applied, found: result.tickets.found, existing: result.tickets.existing })}</li>
            <li>{t('migrate.api.notes', { applied: result.notes.applied, found: result.notes.found, existing: result.notes.existing })}</li>
            <li>
              {t('migrate.api.created', {
                labels: result.chats.created.labels + result.contacts.created.labels,
                properties: result.properties.created,
              })}
            </li>
          </ul>
          {result.truncated && <span>{t('migrate.api.truncated')}</span>}
          {reasons.size > 0 && (
            <ul data-testid="periskope-api-issues">
              {[...reasons].map(([base, n]) => (
                <li key={base}>{t('migrate.api.issue', { n, reason: reasonText(base) })}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Por CSV: un archivo por tipo. */
function PeriskopeCsvImport() {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [kind, setKind] = useState<PeriskopeKind>('labels');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PeriskopeResult | null>(null);

  async function run(preview: boolean) {
    setBusy(true);
    setError('');
    const res = await api<PeriskopeResult>('/api/groups/periskope', { body: { kind, csv, preview } });
    setBusy(false);
    if (!res.data) return setError(errText(res.error));
    setResult(res.data);
  }

  const issueText = (reason: string) => {
    const [base, detail] = reason.split(':');
    return t.has(`migrate.issues.${base}`) ? t(`migrate.issues.${base}`, { detail: detail ?? '' }) : reason;
  };

  return (
    <div className="ui-fields">
      <ol className="gr-steps">
        <li>{t('migrate.step1')}</li>
        <li>{t('migrate.step2')}</li>
        <li>{t('migrate.step3')}</li>
      </ol>
      <label className="ui-field">
        <span className="label">{t('migrate.kind')}</span>
        <select
          className="select"
          value={kind}
          data-testid="periskope-kind"
          onChange={(e) => {
            setKind(e.target.value as PeriskopeKind);
            setResult(null);
          }}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`migrate.kinds.${k}`)}
            </option>
          ))}
        </select>
        <span className="ui-help">{t(`migrate.columns.${kind}`)}</span>
      </label>
      <label className="ui-field">
        <span className="label">{t('migrate.file')}</span>
        <input
          className="input"
          type="file"
          accept=".csv,text/csv"
          data-testid="periskope-file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            setResult(null);
            if (!f) return;
            setError('');
            if (f.size > MAX_BYTES) return setError(t('migrate.tooBig'));
            setFileName(f.name);
            setCsv(await f.text());
          }}
        />
        {fileName && <span className="ui-help">{fileName}</span>}
      </label>
      <details>
        <summary>{t('migrate.paste')}</summary>
        <textarea
          className="input gr-mono"
          rows={6}
          value={csv}
          data-testid="periskope-csv"
          onChange={(e) => {
            setCsv(e.target.value);
            setResult(null);
          }}
          aria-label={t('migrate.paste')}
        />
      </details>
      <div className="gr-inline-form">
        <button type="button" className="btn btn-secondary" data-testid="periskope-preview" disabled={!csv.trim() || busy} onClick={() => void run(true)}>
          {t('migrate.preview')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="periskope-import-run"
          disabled={!csv.trim() || busy || !result?.dryRun || result.applied === 0} onClick={() => void run(false)} aria-busy={busy || undefined}>
          {t('migrate.import')}
        </button>
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div
          className={`gr-banner gr-import-result${result.applied ? ' is-ok' : ' is-warn'}`}
          role="status"
          data-testid="periskope-result"
          data-dry-run={result.dryRun ? '1' : '0'}
          data-applied={result.applied}
          data-rows={result.rows}
        >
          <strong>
            {result.dryRun ? t('migrate.previewResult', { applied: result.applied, rows: result.rows }) : t('migrate.done', { applied: result.applied, rows: result.rows })}
          </strong>
          {(result.created.labels > 0 || result.created.quickReplies > 0) && (
            <span>{t('migrate.created', { labels: result.created.labels, replies: result.created.quickReplies })}</span>
          )}
          {result.ignoredColumns.length > 0 && <span>{t('migrate.ignored', { cols: result.ignoredColumns.join(', ') })}</span>}
          {result.issues.length > 0 && (
            <ul>
              {result.issues.slice(0, 20).map((i) => (
                <li key={`${i.line}-${i.reason}`}>{t('migrate.issueLine', { line: i.line, reason: issueText(i.reason) })}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import { useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { AccountDto } from '@/lib/social';
import { NETWORK_SPECS } from '@/lib/social-networks';
import { BULK_CHUNK, BULK_MAX_ROWS, bulkExampleCsv, bulkPostText, bulkRowIssues, parseBulkCsv, type BulkRow } from '@/lib/social-bulk';
import { api, fmtDateTime, NetworkTag, useErrorText, useIssueText } from './shared';

type Phase = { kind: 'edit' } | { kind: 'sending'; done: number; total: number } | { kind: 'done'; created: number; total: number; error: string | null };

/**
 * Programación masiva desde un CSV: se eligen las cuentas, se carga el
 * archivo (o se pegan las filas), se ve cada fila con su fecha y sus
 * problemas, y se programan en tandas con el avance a la vista. Las filas con
 * problemas quedan afuera y se dice cuántas.
 */
export default function BulkImport({ accounts, tz, drafter, dayFirstDefault }: { accounts: AccountDto[]; tz: string; drafter: boolean; dayFirstDefault: boolean }) {
  const t = useTranslations('social.bulk');
  const locale = useLocale();
  const router = useRouter();
  const errorText = useErrorText();
  const issueText = useIssueText();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string[]>(() => (accounts.length === 1 ? [accounts[0].id] : []));
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [dayFirst, setDayFirst] = useState(dayFirstDefault);
  const [asDrafts, setAsDrafts] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'edit' });
  const [fileError, setFileError] = useState<string | null>(null);

  const chosen = useMemo(() => accounts.filter((a) => selected.includes(a.id)), [accounts, selected]);
  const parsed = useMemo(() => (csv.trim() ? parseBulkCsv(csv, { tz, dayFirst }) : null), [csv, tz, dayFirst]);
  const checked = useMemo(
    () =>
      (parsed?.rows ?? []).map((row) => {
        const network = asDrafts ? [] : bulkRowIssues(row, chosen.map((a) => ({ id: a.id, network: a.network })));
        // Un borrador puede tener fecha pasada: se corrige después.
        const errors = asDrafts ? row.errors.filter((e) => e !== 'date_in_past') : row.errors;
        return { row, errors, network, ok: errors.length === 0 && network.length === 0 };
      }),
    [parsed, chosen, asDrafts],
  );
  const good = checked.filter((c) => c.ok);
  // Redes que no publican solo texto (Instagram, TikTok, YouTube): se avisa antes de la vista previa.
  const needMedia = [...new Set(chosen.filter((a) => NETWORK_SPECS[a.network].requiresMedia).map((a) => a.networkName))];
  const bad = checked.length - good.length;

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function loadFile(files: FileList | null) {
    const file = files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setFileError(null);
    if (file.size > 2 * 1024 * 1024) {
      setFileError(t('fileTooBig'));
      return;
    }
    setCsv(await file.text());
    setFileName(file.name);
  }

  function downloadExample() {
    const blob = new Blob([bulkExampleCsv(dayFirst)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'social-bulk-example.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function submit() {
    const rows = good.map((c) => c.row);
    if (!rows.length || !chosen.length) return;
    setPhase({ kind: 'sending', done: 0, total: rows.length });
    let created = 0;
    for (let i = 0; i < rows.length; i += BULK_CHUNK) {
      const chunk = rows.slice(i, i + BULK_CHUNK);
      try {
        const res = await api<{ ids: string[] }>('/posts/bulk', {
          method: 'POST',
          json: { accountIds: selected, action: asDrafts ? 'draft' : 'schedule', rows: chunk.map((r) => ({ text: r.text, linkUrl: r.linkUrl, scheduledAt: r.scheduledAt })) },
        });
        created += res.ids.length;
        setPhase({ kind: 'sending', done: created, total: rows.length });
      } catch (err) {
        setPhase({ kind: 'done', created, total: rows.length, error: errorText(err) });
        router.refresh();
        return;
      }
    }
    setPhase({ kind: 'done', created, total: rows.length, error: null });
    router.refresh();
  }

  if (!accounts.length) {
    return (
      <div className="ui-empty" data-testid="bulk-no-accounts">
        <p className="ui-empty-title">{t('noAccountsTitle')}</p>
        <p className="ui-empty-body">{t('noAccountsBody')}</p>
        <Link className="btn btn-primary" href="/app/social/accounts">
          {t('connect')}
        </Link>
      </div>
    );
  }

  if (phase.kind === 'done') {
    return (
      <section className="sc-panel" aria-labelledby="sc-bulk-done" data-testid="bulk-done">
        <h2 id="sc-bulk-done">{phase.error ? t('doneWithError', { created: phase.created, total: phase.total }) : asDrafts ? t('doneDrafts', { n: phase.created }) : drafter ? t('doneApproval', { n: phase.created }) : t('doneScheduled', { n: phase.created })}</h2>
        {phase.error && (
          <p className="sc-error" role="alert">
            {phase.error}
          </p>
        )}
        <div className="sc-actions">
          <button
            type="button"
            className="btn"
            data-testid="bulk-again"
            onClick={() => {
              setPhase({ kind: 'edit' });
              setCsv('');
              setFileName(null);
            }}
          >
            {t('importAnother')}
          </button>
          <Link className="btn" href="/app/social">
            {t('openCalendar')}
          </Link>
          <Link className="btn btn-primary" href={asDrafts ? '/app/social/posts?status=draft' : '/app/social/posts?status=scheduled_any'}>
            {t('openPosts')}
          </Link>
        </div>
      </section>
    );
  }

  const sending = phase.kind === 'sending';
  const verb = asDrafts ? 'drafts' : drafter ? 'approval' : 'schedule';

  return (
    <form
      className="sc-page"
      onSubmit={(e) => {
        e.preventDefault();
        if (!sending) void submit();
      }}
      aria-busy={sending}
    >
      <section className="sc-panel" aria-labelledby="sc-bulk-accounts">
        <h2 id="sc-bulk-accounts">{t('accounts')}</h2>
        <div className="sc-accounts" role="group" aria-label={t('accounts')} data-testid="bulk-accounts">
          {accounts.map((a) => (
            <button key={a.id} type="button" className="sc-account" aria-pressed={selected.includes(a.id)} data-expired={a.status !== 'connected'} onClick={() => toggle(a.id)} disabled={sending}>
              <NetworkTag network={a.network} name={a.networkName} />
              <span className="sc-account-name">{a.name}</span>
            </button>
          ))}
        </div>
        <p className="sc-muted sc-small">{t('accountsHint')}</p>
        {needMedia.length > 0 && !asDrafts && (
          <p className="sc-small" role="note" data-testid="bulk-needs-media">
            {t('needsMedia', { networks: needMedia.join(', ') })}{' '}
            <button type="button" className="btn btn-sm" onClick={() => setAsDrafts(true)}>
              {t('useDrafts')}
            </button>
          </p>
        )}
      </section>

      <section className="sc-panel" aria-labelledby="sc-bulk-file">
        <h2 id="sc-bulk-file">{t('file')}</h2>
        <p className="sc-muted sc-small">{t('fileHint', { max: BULK_MAX_ROWS, tz })}</p>
        <div className="sc-row">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={sending} data-testid="bulk-choose">
            {fileName ? t('chooseOther') : t('choose')}
          </button>
          <input ref={fileRef} type="file" hidden accept=".csv,text/csv" onChange={(e) => void loadFile(e.target.files)} data-testid="bulk-file" />
          {fileName && <span className="sc-small">{fileName}</span>}
          <span className="sc-grow" />
          <button type="button" className="btn btn-sm" onClick={downloadExample}>
            {t('example')}
          </button>
        </div>
        {fileError && (
          <p className="sc-error" role="alert">
            {fileError}
          </p>
        )}
        <label className="ui-field">
          <span className="label">{t('paste')}</span>
          <textarea
            className="textarea"
            rows={5}
            value={csv}
            spellCheck={false}
            disabled={sending}
            placeholder={'date,time,text,link'}
            data-testid="bulk-csv"
            onChange={(e) => {
              setCsv(e.target.value);
              setFileName(null);
            }}
          />
        </label>
        <div className="ui-fields ui-fields-2">
          <label className="ui-field">
            <span className="label">{t('dateFormat')}</span>
            <select className="select" value={dayFirst ? 'dmy' : 'mdy'} onChange={(e) => setDayFirst(e.target.value === 'dmy')} disabled={sending} data-testid="bulk-date-format">
              <option value="dmy">{t('dayFirst')}</option>
              <option value="mdy">{t('monthFirst')}</option>
            </select>
          </label>
          <label className="ui-field">
            <span className="label">{t('as')}</span>
            <select className="select" value={asDrafts ? 'draft' : 'schedule'} onChange={(e) => setAsDrafts(e.target.value === 'draft')} disabled={sending} data-testid="bulk-action">
              <option value="schedule">{drafter ? t('asApproval') : t('asScheduled')}</option>
              <option value="draft">{t('asDrafts')}</option>
            </select>
          </label>
        </div>
      </section>

      {parsed && (
        <section className="sc-panel" aria-labelledby="sc-bulk-preview" data-testid="bulk-preview">
          <h2 id="sc-bulk-preview">{t('preview')}</h2>
          {parsed.rows.length === 0 ? (
            <p className="sc-muted">{t('noRows')}</p>
          ) : (
            <>
              <p className="sc-small" data-testid="bulk-summary" aria-live="polite">
                {bad ? t('summaryWithErrors', { ok: good.length, bad }) : t('summary', { ok: good.length })}
                {parsed.skipped > 0 && ` ${t('skipped', { n: parsed.skipped, max: BULK_MAX_ROWS })}`}
              </p>
              <ol className="sc-list sc-bulk-rows" aria-label={t('preview')}>
                {checked.map(({ row, errors, network, ok }) => (
                  <li key={row.line} className="sc-item" data-ok={ok} data-testid="bulk-row">
                    <div className="sc-item-main">
                      <span className="sc-muted sc-small">
                        {t('line', { n: row.line })}
                        {row.scheduledAt && ` · ${fmtDateTime(row.scheduledAt, locale, tz)}`}
                      </span>
                      <span className="sc-item-text">{bulkPostText(row) || t('empty')}</span>
                      {errors.map((e) => (
                        <span key={e} className="sc-error sc-small">
                          {t(`error_${e}`)}
                        </span>
                      ))}
                      {network.map((n) => (
                        <span key={n.accountId} className="sc-error sc-small">
                          {chosen.find((a) => a.id === n.accountId)?.networkName}: {n.issues.map(issueText).join(' ')}
                        </span>
                      ))}
                    </div>
                    <div className="sc-item-side">
                      <span className="sc-status" data-s={ok ? 'scheduled' : 'failed'}>
                        {ok ? t('rowOk') : t('rowSkip')}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}

      <div className="sc-actions">
        {sending && (
          <span className="sc-row sc-small" role="status" data-testid="bulk-progress">
            <progress max={phase.total} value={phase.done} />
            {t('progress', { done: phase.done, total: phase.total })}
          </span>
        )}
        {!chosen.length && parsed && good.length > 0 && <span className="sc-muted sc-small">{t('pickAccounts')}</span>}
        <button type="submit" className="btn btn-primary" disabled={sending || !chosen.length || !good.length} aria-busy={sending} data-testid="bulk-submit">
          {bad && good.length ? t(`submitSkip_${verb}`, { n: good.length, bad }) : t(`submit_${verb}`, { n: good.length })}
        </button>
      </div>
    </form>
  );
}

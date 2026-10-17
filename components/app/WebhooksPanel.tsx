'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { WebhookDto } from '@/lib/webhooks';
import { WEBHOOK_EVENTS, type WebhookEvent } from '@/lib/webhooks-events';
import { groupState, toggleGroup, webhookEventGroups } from '@/lib/settings-nav';
import CopyButton from '@/components/link/CopyButton';
import AdvancedSection from '@/components/ui/AdvancedSection';
import DataTable from '@/components/ui/DataTable';
import EmptyState from '@/components/ui/EmptyState';
import FormSection from '@/components/ui/FormSection';

const GROUPS = webhookEventGroups(WEBHOOK_EVENTS);
const eventKey = (ev: string) => ev.replace(/\./g, '_');

/** Checkbox de grupo con estado indeterminado (algunos eventos del grupo). */
function GroupCheck({ state, label, onToggle }: { state: 'all' | 'none' | 'some'; label: string; onToggle: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return (
    <label className="ui-check st-group-check">
      <input ref={ref} type="checkbox" checked={state === 'all'} onChange={onToggle} />
      <span>{label}</span>
    </label>
  );
}

/** Webhooks del workspace: alta con los 14 eventos agrupados por recurso, secret visible una vez, prueba y baja. */
export default function WebhooksPanel({ initial }: { initial: WebhookDto[] }) {
  const t = useTranslations('settings.webhooks');
  const [rows, setRows] = useState(initial);
  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState<WebhookEvent[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch('/api/webhooks').catch(() => null);
    if (res?.ok) setRows(((await res.json()) as { rows: WebhookDto[] }).rows);
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy('create');
    setError(null);
    const res = await fetch('/api/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: url.trim(), events: selected }),
    }).catch(() => null);
    if (res?.status === 201) {
      setSecret(((await res.json()) as { secret: string }).secret);
      setUrl('');
      setSelected([]);
      await refresh();
    } else {
      const code = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : null;
      setError(code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
    }
    setBusy(null);
  }

  async function test(id: string) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/webhooks/${id}/test`, { method: 'POST' }).catch(() => null);
    if (!res?.ok) setError(t('errors.action'));
    await refresh();
    setBusy(null);
  }

  async function remove(row: WebhookDto) {
    if (!window.confirm(t('removeConfirm', { url: row.url }))) return;
    setBusy(row.id);
    setError(null);
    const res = await fetch(`/api/webhooks/${row.id}`, { method: 'DELETE' }).catch(() => null);
    if (res?.status === 204) setRows((prev) => prev.filter((r) => r.id !== row.id));
    else setError(t('errors.action'));
    setBusy(null);
  }

  function toggle(ev: WebhookEvent) {
    setSelected((prev) => (prev.includes(ev) ? prev.filter((e) => e !== ev) : WEBHOOK_EVENTS.filter((e) => e === ev || prev.includes(e))));
  }

  function delivery(row: WebhookDto) {
    const d = row.lastDelivery;
    if (!d) return <span className="st-muted">{t('delivery.none')}</span>;
    const tone = d.status === 'delivered' ? 'badge-ok' : d.status === 'failed' ? 'badge-bad' : 'badge-warn';
    const label = t.has(`delivery.${d.status}`) ? t(`delivery.${d.status}`) : d.status;
    return (
      <span className="st-delivery">
        <span className={`badge ${tone}`}>{label}</span>
        {d.responseCode ? <span className="data st-muted">{d.responseCode}</span> : null}
      </span>
    );
  }

  return (
    <FormSection id="webhooks" title={t('title')} description={t('desc')}>
      <form className="st-webhook-form" onSubmit={create}>
        <div className="ui-field">
          <label className="label" htmlFor="st-hook-url">
            {t('url')}
          </label>
          <input
            id="st-hook-url"
            className="input data"
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('urlPlaceholder')}
            autoComplete="off"
            spellCheck={false}
            required
          />
        </div>

        <fieldset className="st-fieldset">
          <legend className="label st-legend">
            {t('events')} <span className="st-count">{t('eventsCount', { count: selected.length })}</span>
          </legend>
          <div className="st-event-groups">
            {GROUPS.map((g) => (
              <div key={g.key} className="st-event-group" role="group" aria-label={t(`groups.${g.key}`)}>
                <GroupCheck
                  state={groupState(g.events, selected)}
                  label={t(`groups.${g.key}`)}
                  onToggle={() => setSelected((prev) => toggleGroup(g.events, prev))}
                />
                <ul className="st-event-list">
                  {g.events.map((ev) => (
                    <li key={ev}>
                      <label className="ui-check" title={ev}>
                        <input type="checkbox" checked={selected.includes(ev)} onChange={() => toggle(ev)} value={ev} />
                        <span>{t(`eventLabels.${eventKey(ev)}`)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </fieldset>

        <div className="st-form-foot">
          {error ? (
            <p className="ui-error" role="alert">
              {error}
            </p>
          ) : (
            <span />
          )}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!url.trim() || selected.length === 0}
            aria-busy={busy === 'create' || undefined}
          >
            {t('add')}
          </button>
        </div>
      </form>

      {secret && (
        <div className="st-reveal" role="status">
          <p className="label">{t('secretTitle')}</p>
          <div className="st-reveal-row">
            <code className="data st-secret">{secret}</code>
            <CopyButton text={secret} className="btn btn-secondary btn-sm" />
          </div>
          <p className="ui-help">{t('secretWarning')}</p>
        </div>
      )}

      <DataTable
        caption={t('title')}
        rows={rows}
        rowKey={(r) => r.id}
        compact
        className="st-table-stack"
        empty={<EmptyState quiet title={t('emptyTitle')} body={t('emptyBody')} />}
        columns={[
          { key: 'url', header: t('colUrl'), cell: (r) => <span className="st-url">{r.url}</span>, data: true },
          {
            key: 'events',
            header: t('colEvents'),
            cell: (r) => (
              <span title={r.events.join(', ')}>
                {r.events.length === WEBHOOK_EVENTS.length || r.events.length > 2
                  ? t('eventsTotal', { count: r.events.length })
                  : r.events.map((ev) => t(`eventLabels.${eventKey(ev)}`)).join(', ')}
              </span>
            ),
          },
          { key: 'last', header: t('colLast'), cell: delivery },
          {
            key: 'actions',
            header: <span className="sr-only">{t('colActions')}</span>,
            cell: (r) => (
              <div className="st-row-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => test(r.id)}
                  disabled={busy !== null && busy !== r.id}
                  aria-busy={busy === r.id || undefined}
                >
                  {t('test')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-danger btn-sm"
                  onClick={() => remove(r)}
                  disabled={busy !== null}
                  aria-label={`${t('remove')} ${r.url}`}
                >
                  {t('remove')}
                </button>
              </div>
            ),
          },
        ]}
      />

      <AdvancedSection storageKey="settings.webhooks.signature" label={t('signature')} hint={t('signatureHint')}>
        <p className="ui-help st-prose">{t('signatureHelp')}</p>
      </AdvancedSection>
    </FormSection>
  );
}

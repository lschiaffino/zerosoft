'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';
import EmptyState from '@/components/ui/EmptyState';
import { formatNumber } from '@/lib/utils';
import ChatIcon from './icons';

interface Outbound {
  id: string;
  name: string;
  kind: 'chat' | 'survey';
  body: string;
  url_match: 'any' | 'contains' | 'equals';
  url_value: string;
  delay_seconds: number;
  audience: 'all' | 'new' | 'returning' | 'identified';
  active: 0 | 1;
  shown_count: number;
  reply_count: number;
  responses: number;
  average: number | null;
}

interface Form {
  name: string;
  kind: Outbound['kind'];
  body: string;
  urlMatch: Outbound['url_match'];
  urlValue: string;
  delaySeconds: string;
  audience: Outbound['audience'];
  active: boolean;
}

const EMPTY: Form = { name: '', kind: 'chat', body: '', urlMatch: 'any', urlValue: '', delaySeconds: '0', audience: 'all', active: false };

/**
 * Mensajes salientes del widget: un mensaje proactivo (si el visitante
 * responde, la conversación arranca con él) o una encuesta de 1 a 5, por
 * página, segundos en la página y audiencia. Cada visitante lo ve una vez.
 */
export default function OutboundClient({ widgetId, canManage = true }: { widgetId: string; canManage?: boolean }) {
  const t = useTranslations('chat');
  const locale = useLocale();
  const params = useSearchParams();
  const [rows, setRows] = useState<Outbound[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Outbound | null>(null);

  async function load() {
    setError(false);
    try {
      const res = await fetch(`/api/chat/widgets/${widgetId}/outbound`);
      if (!res.ok) throw new Error('load_failed');
      setRows(((await res.json()) as { messages: Outbound[] }).messages);
    } catch {
      setError(true);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetId]);

  useEffect(() => {
    const id = params.get('open');
    const row = id ? rows.find((r) => r.id === id) : null;
    if (row && canManage) startEdit(row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, rows.length]);

  useKeyShortcut('c', () => startCreate(), canManage && editing === null);

  function startCreate() {
    setFormError(null);
    setEditing('new');
    setForm(EMPTY);
  }

  function startEdit(r: Outbound) {
    setFormError(null);
    setEditing(r.id);
    setForm({
      name: r.name,
      kind: r.kind,
      body: r.body,
      urlMatch: r.url_match,
      urlValue: r.url_value,
      delaySeconds: String(r.delay_seconds),
      audience: r.audience,
      active: r.active === 1,
    });
  }

  async function save() {
    if (!form.name.trim() || busy) return;
    if (form.active && !form.body.trim()) {
      setFormError(t('outbound.needsBody'));
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const isNew = editing === 'new';
      const res = await fetch(isNew ? `/api/chat/widgets/${widgetId}/outbound` : `/api/chat/outbound/${editing}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          kind: form.kind,
          body: form.body,
          urlMatch: form.urlMatch,
          urlValue: form.urlValue,
          delaySeconds: Math.max(0, Math.min(3600, Math.round(Number(form.delaySeconds) || 0))),
          audience: form.audience,
          active: form.active,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(data.error === 'missing_body' ? t('outbound.needsBody') : t('errors.generic'));
        return;
      }
      setEditing(null);
      await load();
    } catch {
      setFormError(t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(r: Outbound) {
    if (r.active !== 1 && !r.body) {
      startEdit(r);
      setFormError(t('outbound.needsBody'));
      return;
    }
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, active: x.active === 1 ? 0 : 1 } : x)));
    await fetch(`/api/chat/outbound/${r.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: r.active !== 1 }),
    }).catch(() => null);
    await load();
  }

  async function remove(r: Outbound) {
    setBusy(true);
    try {
      const res = await fetch(`/api/chat/outbound/${r.id}`, { method: 'DELETE' });
      if (res.ok) setRows((prev) => prev.filter((x) => x.id !== r.id));
    } finally {
      setBusy(false);
      setConfirmDelete(null);
    }
  }

  const where = (r: Outbound) =>
    r.url_match === 'any' ? t('outbound.anyPage') : `${t(`outbound.match.${r.url_match}`)} ${r.url_value}`;

  return (
    <section className="chat-pane" aria-labelledby="chat-outbound-title">
      <div className="chat-pane-head">
        <div>
          <h2 id="chat-outbound-title" className="ui-section-title">
            {t('outbound.title')}
          </h2>
          <p className="ui-section-desc">{t('outbound.sub')}</p>
        </div>
        {rows.length > 0 && canManage && (
          <button type="button" className="btn btn-primary btn-sm" onClick={startCreate} aria-keyshortcuts="c">
            {t('outbound.add')}
            <kbd className="kbd">C</kbd>
          </button>
        )}
      </div>
      {error ? (
        <div className="chat-load-error" role="alert">
          <p>{t('errors.loadFailed')}</p>
          <button type="button" className="btn btn-sm" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </div>
      ) : !loaded ? (
        <div className="ui-loading-stack" aria-label={t('common.loading')}>
          {Array.from({ length: 3 }, (_, i) => (
            <span key={i} className="ui-skeleton ui-skeleton-row" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('outbound.empty')}
          body={canManage ? t('outbound.emptySub') : t('outbound.adminOnly')}
          action={
            canManage ? (
              <button type="button" className="btn btn-primary" onClick={startCreate}>
                {t('outbound.add')}
              </button>
            ) : undefined
          }
          product="chat"
        />
      ) : (
        <div className="table-wrap chat-stack">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('outbound.name')}</th>
                <th scope="col">{t('outbound.kind')}</th>
                <th scope="col">{t('outbound.where')}</th>
                <th scope="col" className="num">
                  {t('outbound.shown')}
                </th>
                <th scope="col" className="num">
                  {t('outbound.results')}
                </th>
                <th scope="col">{t('rules.state')}</th>
                <th scope="col">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-inactive={r.active === 1 ? undefined : true}>
                  <td>
                    {canManage ? (
                      <button type="button" className="chat-row-button" onClick={() => startEdit(r)}>
                        {r.name}
                      </button>
                    ) : (
                      <span className="chat-row-button">{r.name}</span>
                    )}
                  </td>
                  <td data-label={t('outbound.kind')}>{t(`outbound.kinds.${r.kind}`)}</td>
                  <td data-label={t('outbound.where')}>
                    <span>
                      {where(r)}
                      {r.delay_seconds > 0 && <span className="chat-quiet"> · {t('outbound.afterSeconds', { s: r.delay_seconds })}</span>}
                      <span className="chat-quiet"> · {t(`outbound.audiences.${r.audience}`)}</span>
                    </span>
                  </td>
                  <td className="num data" data-label={t('outbound.shown')}>
                    {formatNumber(r.shown_count, locale)}
                  </td>
                  <td className="num data" data-label={t('outbound.results')}>
                    {r.kind === 'survey'
                      ? r.average != null
                        ? t('outbound.surveyResult', { avg: formatNumber(Math.round(r.average * 10) / 10, locale), n: r.responses })
                        : '–'
                      : t('outbound.replies', { n: r.reply_count })}
                  </td>
                  <td data-label={t('rules.state')}>
                    <label className="ui-switch">
                      <input type="checkbox" role="switch" checked={r.active === 1} disabled={!canManage} onChange={() => void toggle(r)} aria-label={t('outbound.toggle', { name: r.name })} />
                      <span aria-hidden="true">{r.active === 1 ? t('rules.active') : t('rules.inactive')}</span>
                    </label>
                  </td>
                  <td className="chat-row-actions">
                    {canManage && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={() => setConfirmDelete(r)}
                      aria-label={t('outbound.deleteNamed', { name: r.name })}
                      title={t('common.delete')}
                    >
                      <ChatIcon name="trash" size={14} />
                    </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <QuickModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? t('outbound.newTitle') : t('outbound.editTitle')}
        onSubmit={() => void save()}
        submitLabel={editing === 'new' ? t('outbound.create') : t('common.save')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!form.name.trim()}
        busy={busy}
        error={formError}
        width={560}
      >
        <div className="ui-fields">
          <div className="ui-fields-2">
            <div className="ui-field">
              <label className="label" htmlFor="ob-name">
                {t('outbound.name')}
              </label>
              <input
                id="ob-name"
                className="input"
                data-autofocus
                maxLength={80}
                value={form.name}
                placeholder={t('outbound.namePlaceholder')}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="ob-kind">
                {t('outbound.kind')}
              </label>
              <select id="ob-kind" className="select" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as Form['kind'] }))}>
                <option value="chat">{t('outbound.kinds.chat')}</option>
                <option value="survey">{t('outbound.kinds.survey')}</option>
              </select>
            </div>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="ob-body">
              {form.kind === 'survey' ? t('outbound.question') : t('outbound.message')}
            </label>
            <textarea
              id="ob-body"
              className="textarea"
              rows={3}
              maxLength={1000}
              value={form.body}
              placeholder={form.kind === 'survey' ? t('outbound.questionPlaceholder') : t('outbound.messagePlaceholder')}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            />
            <p className="ui-help">{form.kind === 'survey' ? t('outbound.surveyHint') : t('outbound.chatHint')}</p>
          </div>
          <div className="ui-fields-2">
            <div className="ui-field">
              <label className="label" htmlFor="ob-match">
                {t('outbound.where')}
              </label>
              <select
                id="ob-match"
                className="select"
                value={form.urlMatch}
                onChange={(e) => setForm((f) => ({ ...f, urlMatch: e.target.value as Form['urlMatch'] }))}
              >
                <option value="any">{t('outbound.anyPage')}</option>
                <option value="contains">{t('outbound.match.contains')}</option>
                <option value="equals">{t('outbound.match.equals')}</option>
              </select>
            </div>
            {form.urlMatch !== 'any' && (
              <div className="ui-field">
                <label className="label" htmlFor="ob-url">
                  {t('outbound.url')}
                </label>
                <input
                  id="ob-url"
                  className="input data"
                  value={form.urlValue}
                  placeholder={form.urlMatch === 'equals' ? 'https://example.com/pricing' : '/pricing'}
                  onChange={(e) => setForm((f) => ({ ...f, urlValue: e.target.value }))}
                />
              </div>
            )}
          </div>
          <div className="ui-fields-2">
            <div className="ui-field">
              <label className="label" htmlFor="ob-delay">
                {t('outbound.delay')}
              </label>
              <input
                id="ob-delay"
                className="input data"
                type="number"
                min={0}
                max={3600}
                value={form.delaySeconds}
                onChange={(e) => setForm((f) => ({ ...f, delaySeconds: e.target.value }))}
              />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="ob-audience">
                {t('outbound.audience')}
              </label>
              <select
                id="ob-audience"
                className="select"
                value={form.audience}
                onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value as Form['audience'] }))}
              >
                {(['all', 'new', 'returning', 'identified'] as const).map((a) => (
                  <option key={a} value={a}>
                    {t(`outbound.audiences.${a}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="ui-switch">
            <input type="checkbox" role="switch" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
            {t('outbound.live')}
          </label>
        </div>
      </QuickModal>

      <QuickModal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={t('outbound.deleteTitle')}
        onSubmit={() => confirmDelete && void remove(confirmDelete)}
        submitLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        busy={busy}
        centered
      >
        <p>{t('outbound.deleteBody', { name: confirmDelete?.name ?? '' })}</p>
      </QuickModal>
    </section>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ChatAgent, ChatCannedResponseRow } from '@/lib/chat-data';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';
import AdvancedSection from '@/components/ui/AdvancedSection';
import EmptyState from '@/components/ui/EmptyState';
import ChatIcon from './icons';
import {
  cannedPayload,
  countCannedActions,
  emptyCannedForm,
  joinSummary,
  normalizeShortcut,
  parseCannedActions,
  type CannedActions,
  type CannedForm,
} from './canned-model';

interface CannedClientProps {
  widgetId: string;
  agents?: ChatAgent[];
}

/**
 * Respuestas guardadas del widget. Crear pide título y texto; el atajo
 * (/algo) se deriva del título y se puede cambiar. Las acciones automáticas
 * (macro: estado, asignación, tags, posponer) quedan en Avanzado.
 */
export default function CannedClient({ widgetId, agents = [] }: CannedClientProps) {
  const t = useTranslations('chat');
  const locale = useLocale();
  const [responses, setResponses] = useState<ChatCannedResponseRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CannedForm>(emptyCannedForm());

  async function fetchResponses() {
    setError(false);
    try {
      const res = await fetch(`/api/chat/widgets/${widgetId}/canned`);
      if (!res.ok) throw new Error('fetch_failed');
      const data = (await res.json()) as { responses: ChatCannedResponseRow[] };
      setResponses(data.responses);
    } catch {
      setError(true);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void fetchResponses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetId]);

  useKeyShortcut('c', () => startCreate(), editingId === null);

  function startEdit(r: ChatCannedResponseRow) {
    const a = parseCannedActions(r.actions);
    setFormError(null);
    setEditingId(r.id);
    setForm({
      shortcut: r.shortcut,
      shortcutTouched: true,
      title: r.title,
      body: r.body,
      status: a.status ?? '',
      assignTo: a.assignTo === undefined ? '' : a.assignTo === '' ? '__none' : a.assignTo,
      tags: (a.addTags ?? []).join(' '),
      snoozeHours: a.snoozeHours ? String(a.snoozeHours) : '',
    });
  }

  function startCreate() {
    setFormError(null);
    setEditingId('new');
    setForm(emptyCannedForm());
  }

  function close() {
    setEditingId(null);
    setForm(emptyCannedForm());
  }

  const payload = cannedPayload(form);
  const canSave = !!payload.shortcut && !!payload.body;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setFormError(null);
    try {
      const isNew = editingId === 'new';
      const res = await fetch(isNew ? `/api/chat/widgets/${widgetId}/canned` : `/api/chat/canned/${editingId}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('save_failed');
      await fetchResponses();
      close();
    } catch {
      setFormError(
        responses.some((r) => r.shortcut === payload.shortcut && r.id !== editingId)
          ? t('canned.shortcutTaken', { shortcut: payload.shortcut })
          : t('errors.generic'),
      );
    } finally {
      setSaving(false);
    }
  }

  function describe(a: CannedActions): string {
    const parts: string[] = [];
    if (a.snoozeHours) parts.push(t('macros.summary.snooze', { hours: a.snoozeHours }));
    else if (a.status) parts.push(t('macros.summary.status', { status: t(`conversation.${a.status}`).toLocaleLowerCase(locale) }));
    if (a.assignTo !== undefined) {
      const agent = agents.find((x) => x.id === a.assignTo);
      parts.push(
        a.assignTo === ''
          ? t('macros.summary.unassign')
          : a.assignTo === 'me'
            ? t('macros.summary.assignMe')
            : t('macros.summary.assign', { name: agent?.name || agent?.email || '?' }),
      );
    }
    if (a.addTags?.length) parts.push(a.addTags.map((x) => `#${x}`).join(' '));
    return joinSummary(parts, locale);
  }

  async function remove(r: ChatCannedResponseRow) {
    if (!window.confirm(t('canned.deleteConfirm', { shortcut: r.shortcut }))) return;
    setResponses((prev) => prev.filter((x) => x.id !== r.id));
    await fetch(`/api/chat/canned/${r.id}`, { method: 'DELETE' }).catch(() => null);
    await fetchResponses();
  }

  const actionCount = countCannedActions(cannedPayload(form).actions);
  const createButton = (
    <button type="button" className="btn btn-primary" onClick={startCreate}>
      {t('canned.add')}
    </button>
  );

  return (
    <section className="chat-pane" aria-labelledby="chat-canned-title">
      <div className="chat-pane-head">
        <div>
          <h2 id="chat-canned-title" className="ui-section-title">
            {t('canned.title')}
          </h2>
          <p className="ui-section-desc">{t('canned.sub')}</p>
        </div>
        {responses.length > 0 && (
          <button type="button" className="btn btn-primary btn-sm" onClick={startCreate} aria-keyshortcuts="c">
            {t('canned.add')}
            <kbd className="kbd">C</kbd>
          </button>
        )}
      </div>

      {error ? (
        <div className="chat-load-error" role="alert">
          <p>{t('errors.loadFailed')}</p>
          <button type="button" className="btn btn-sm" onClick={() => fetchResponses()}>
            {t('common.retry')}
          </button>
        </div>
      ) : !loaded ? (
        <div className="ui-loading-stack" aria-label={t('common.loading')}>
          {Array.from({ length: 3 }, (_, i) => (
            <span key={i} className="ui-skeleton ui-skeleton-row" />
          ))}
        </div>
      ) : responses.length === 0 ? (
        <EmptyState title={t('canned.empty')} body={t('canned.emptySub')} action={createButton} product="chat" />
      ) : (
        <div className="table-wrap chat-stack">
          <table className="table chat-canned-table">
            <thead>
              <tr>
                <th scope="col">{t('canned.shortcut')}</th>
                <th scope="col">{t('canned.body')}</th>
                <th scope="col">{t('canned.autoActions')}</th>
                <th scope="col">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {responses.map((r) => {
                const summary = describe(parseCannedActions(r.actions));
                return (
                  <tr key={r.id}>
                    <td className="chat-canned-key">
                      <button type="button" className="chat-row-button" onClick={() => startEdit(r)}>
                        <span className="data">{r.shortcut}</span>
                        {r.title !== r.shortcut.replace(/^\//, '') && (
                          <span className="chat-canned-title">{r.title}</span>
                        )}
                      </button>
                    </td>
                    <td className="chat-canned-body" data-label={t('canned.body')}>
                      <span className="chat-clamp">{r.body}</span>
                    </td>
                    <td className="chat-canned-macro" data-label={t('canned.autoActions')}>{summary || <span className="chat-quiet">{t('macros.none')}</span>}</td>
                    <td className="chat-row-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => remove(r)}
                        aria-label={t('canned.delete', { shortcut: r.shortcut })}
                        title={t('common.delete')}
                      >
                        <ChatIcon name="trash" size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <QuickModal
        open={editingId !== null}
        onClose={close}
        title={editingId === 'new' ? t('canned.newTitle') : t('canned.editTitle')}
        onSubmit={save}
        submitLabel={editingId === 'new' ? t('canned.create') : t('common.save')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!canSave}
        busy={saving}
        error={formError}
        hint={t('quick.saveHint')}
      >
        <div className="ui-fields">
          <div className="ui-fields-2">
            <div className="ui-field">
              <label className="label" htmlFor="canned-title">
                {t('canned.titleLabel')}
              </label>
              <input
                id="canned-title"
                className="input"
                data-autofocus
                value={form.title}
                maxLength={120}
                placeholder={t('canned.titlePlaceholder')}
                onChange={(e) => {
                  const title = e.target.value;
                  setForm((f) => ({ ...f, title, shortcut: f.shortcutTouched ? f.shortcut : normalizeShortcut(title) }));
                }}
              />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="canned-shortcut">
                {t('canned.shortcut')}
              </label>
              <input
                id="canned-shortcut"
                className="input data"
                value={form.shortcut}
                maxLength={60}
                placeholder="/saludo"
                aria-describedby="canned-shortcut-help"
                onChange={(e) => setForm((f) => ({ ...f, shortcut: e.target.value, shortcutTouched: e.target.value !== '' }))}
                onBlur={() => setForm((f) => ({ ...f, shortcut: normalizeShortcut(f.shortcut) }))}
              />
              <p id="canned-shortcut-help" className="ui-help">
                {t('canned.shortcutHelp')}
              </p>
            </div>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="canned-body">
              {t('canned.body')}
            </label>
            <textarea
              id="canned-body"
              className="textarea"
              rows={5}
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              placeholder={t('canned.placeholder')}
            />
          </div>
          <AdvancedSection
            storageKey="chat.canned.actions"
            label={t('canned.autoActionsAdvanced')}
            hint={actionCount > 0 ? t('canned.actionsCount', { count: actionCount }) : undefined}
          >
            <p className="ui-help">{t('macros.title')}</p>
            <div className="ui-fields-2">
              <div className="ui-field">
                <label className="label" htmlFor="canned-status">
                  {t('macros.status')}
                </label>
                <select
                  id="canned-status"
                  className="select"
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as CannedForm['status'] }))}
                >
                  <option value="">{t('macros.none')}</option>
                  <option value="open">{t('conversation.open')}</option>
                  <option value="pending">{t('conversation.pending')}</option>
                  <option value="resolved">{t('conversation.resolved')}</option>
                </select>
              </div>
              <div className="ui-field">
                <label className="label" htmlFor="canned-assign">
                  {t('macros.assign')}
                </label>
                <select
                  id="canned-assign"
                  className="select"
                  value={form.assignTo}
                  onChange={(e) => setForm((f) => ({ ...f, assignTo: e.target.value }))}
                >
                  <option value="">{t('macros.none')}</option>
                  <option value="me">{t('macros.me')}</option>
                  <option value="__none">{t('conversation.unassigned')}</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name || a.email}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ui-field">
                <label className="label" htmlFor="canned-tags">
                  {t('macros.tags')}
                </label>
                <input
                  id="canned-tags"
                  className="input"
                  value={form.tags}
                  onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                  placeholder={t('canned.tagsPlaceholder')}
                  maxLength={200}
                />
              </div>
              <div className="ui-field">
                <label className="label" htmlFor="canned-snooze">
                  {t('macros.snooze')}
                </label>
                <select
                  id="canned-snooze"
                  className="select"
                  value={form.snoozeHours}
                  onChange={(e) => setForm((f) => ({ ...f, snoozeHours: e.target.value }))}
                >
                  <option value="">{t('macros.none')}</option>
                  <option value="1">{t('conversation.snooze.1h')}</option>
                  <option value="4">{t('conversation.snooze.4h')}</option>
                  <option value="24">{t('conversation.snooze.24h')}</option>
                  <option value="72">{t('conversation.snooze.3d')}</option>
                  <option value="168">{t('conversation.snooze.7d')}</option>
                </select>
              </div>
            </div>
          </AdvancedSection>
        </div>
      </QuickModal>
    </section>
  );
}

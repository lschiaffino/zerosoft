'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatAgent, ChatCannedResponseRow } from '@/lib/chat-data';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';

interface CannedClientProps {
  widgetId: string;
  agents?: ChatAgent[];
}

/** Acciones de la macro (lib/chat-inbox.ts → CannedActions). '' = sin acción. */
interface CannedForm {
  shortcut: string;
  title: string;
  body: string;
  status: '' | 'open' | 'pending' | 'resolved';
  /** '' sin acción · 'me' · '__none' desasignar · id de agente. */
  assignTo: string;
  tags: string;
  snoozeHours: string;
}

function emptyForm(): CannedForm {
  return { shortcut: '', title: '', body: '', status: '', assignTo: '', tags: '', snoozeHours: '' };
}

interface ParsedActions {
  status?: 'open' | 'pending' | 'resolved';
  assignTo?: string;
  addTags?: string[];
  snoozeHours?: number;
}

function parseActions(raw: string | undefined): ParsedActions {
  try {
    return JSON.parse(raw || '{}') as ParsedActions;
  } catch {
    return {};
  }
}

function formActions(form: CannedForm): ParsedActions {
  const out: ParsedActions = {};
  if (form.status) out.status = form.status;
  if (form.assignTo) out.assignTo = form.assignTo === '__none' ? '' : form.assignTo;
  const tags = form.tags
    .split(/[\s,]+/)
    .map((x) => x.replace(/^#/, '').trim())
    .filter(Boolean);
  if (tags.length) out.addTags = tags;
  if (form.snoozeHours) out.snoozeHours = Number(form.snoozeHours);
  return out;
}

/** "/Saludo inicial" → "/saludo-inicial": el atajo siempre arranca con "/". */
function normalizeShortcut(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/^\/+/, '')
    .replace(/\s+/g, '-');
  return slug ? `/${slug}` : '';
}

export default function CannedClient({ widgetId, agents = [] }: CannedClientProps) {
  const t = useTranslations('chat');
  const [responses, setResponses] = useState<ChatCannedResponseRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CannedForm>(emptyForm());

  async function fetchResponses() {
    setError(null);
    try {
      const res = await fetch(`/api/chat/widgets/${widgetId}/canned`);
      if (!res.ok) throw new Error('fetch_failed');
      const data = (await res.json()) as { responses: ChatCannedResponseRow[] };
      setResponses(data.responses);
    } catch {
      setError(t('errors.generic'));
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    fetchResponses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetId]);

  useKeyShortcut('c', () => startCreate(), editingId === null);

  function startEdit(response: ChatCannedResponseRow) {
    setFormError(null);
    setEditingId(response.id);
    const a = parseActions(response.actions);
    setForm({
      shortcut: response.shortcut,
      title: response.title,
      body: response.body,
      status: a.status ?? '',
      assignTo: a.assignTo === undefined ? '' : a.assignTo === '' ? '__none' : a.assignTo,
      tags: (a.addTags ?? []).join(' '),
      snoozeHours: a.snoozeHours ? String(a.snoozeHours) : '',
    });
  }

  function startCreate() {
    setFormError(null);
    setEditingId('new');
    setForm(emptyForm());
  }

  function close() {
    setEditingId(null);
    setForm(emptyForm());
  }

  // El título es opcional en la UI: si falta, usamos el atajo.
  const shortcut = normalizeShortcut(form.shortcut);
  const title = form.title.trim() || shortcut.replace(/^\//, '');
  const body = form.body.trim();
  const canSave = !!shortcut && !!body;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setFormError(null);
    try {
      const isNew = editingId === 'new';
      const res = await fetch(isNew ? `/api/chat/widgets/${widgetId}/canned` : `/api/chat/canned/${editingId}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortcut, title, body, actions: formActions(form) }),
      });
      if (!res.ok) throw new Error('save_failed');
      await fetchResponses();
      close();
    } catch {
      setFormError(t('errors.generic'));
    } finally {
      setSaving(false);
    }
  }

  function describe(a: ParsedActions): string {
    const parts: string[] = [];
    if (a.snoozeHours) parts.push(t('macros.summary.snooze', { hours: a.snoozeHours }));
    else if (a.status) parts.push(t('macros.summary.status', { status: t(`conversation.${a.status}`) }));
    if (a.assignTo !== undefined) {
      const agent = agents.find((x) => x.id === a.assignTo);
      parts.push(
        a.assignTo === ''
          ? t('macros.summary.unassign')
          : t('macros.summary.assign', { name: a.assignTo === 'me' ? t('macros.me') : agent?.name || agent?.email || '?' }),
      );
    }
    if (a.addTags?.length) parts.push(a.addTags.map((x) => `#${x}`).join(' '));
    return parts.join(' · ');
  }

  async function remove(r: ChatCannedResponseRow) {
    if (!window.confirm(t('canned.deleteConfirm', { shortcut: r.shortcut }))) return;
    setResponses((prev) => prev.filter((x) => x.id !== r.id));
    await fetch(`/api/chat/canned/${r.id}`, { method: 'DELETE' }).catch(() => null);
    await fetchResponses();
  }

  return (
    <section className="chat-section">
      <div className="chat-section-head">
        <p className="muted chat-section-sub">{t('canned.sub')}</p>
        {responses.length > 0 && (
          <button type="button" className="btn btn-solid btn-small" onClick={startCreate}>
            {t('canned.add')}
            <span className="kbd-hint">C</span>
          </button>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}

      {loaded && responses.length === 0 ? (
        <div className="empty-state chat-empty">
          <p className="empty-zeros mono" aria-hidden>
            0 0 0
          </p>
          <h2>{t('canned.empty')}</h2>
          <p className="muted">{t('canned.emptySub')}</p>
          <button type="button" className="btn btn-solid btn-small" onClick={startCreate}>
            {t('canned.add')}
          </button>
        </div>
      ) : (
        <ul className="chat-canned-list">
          {responses.map((r) => (
            <li key={r.id} className="chat-canned-row">
              <button type="button" className="chat-canned-open" onClick={() => startEdit(r)}>
                <span className="chat-canned-main">
                  <span className="chat-canned-shortcut mono">{r.shortcut}</span>
                  {r.title !== r.shortcut.replace(/^\//, '') && (
                    <span className="chat-canned-title">{r.title}</span>
                  )}
                </span>
                <span className="chat-canned-body">{r.body}</span>
                {describe(parseActions(r.actions)) && (
                  <span className="chat-canned-actions-summary mono muted">{describe(parseActions(r.actions))}</span>
                )}
              </button>
              <div className="chat-canned-actions">
                <button
                  type="button"
                  className="chat-widget-action chat-widget-action-danger mono"
                  onClick={() => remove(r)}
                >
                  {t('common.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <QuickModal
        open={editingId !== null}
        onClose={close}
        crumb={`${t('canned.title')} › ${editingId === 'new' ? t('canned.add') : t('common.edit')}`}
        onSubmit={save}
        submitLabel={editingId === 'new' ? t('quick.create') : t('common.save')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!canSave}
        busy={saving}
        error={formError}
        hint={t('quick.saveHint')}
      >
        <div className="qm-row">
          <label className="qm-field">
            <span>{t('canned.shortcut')}</span>
            <input
              data-autofocus
              value={form.shortcut}
              onChange={(e) => setForm((f) => ({ ...f, shortcut: e.target.value }))}
              placeholder="/greeting"
              maxLength={60}
            />
          </label>
          <label className="qm-field">
            <span>{t('canned.titleLabel')}</span>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder={t('canned.titlePlaceholder')}
              maxLength={120}
            />
          </label>
        </div>
        <label className="qm-field">
          <span>{t('canned.body')}</span>
          <textarea
            rows={5}
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            placeholder={t('canned.placeholder')}
          />
        </label>
        <p className="qm-section-label mono muted">{t('macros.title')}</p>
        <div className="qm-row">
          <label className="qm-field">
            <span>{t('macros.status')}</span>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as CannedForm['status'] }))}
            >
              <option value="">{t('macros.none')}</option>
              <option value="open">{t('conversation.open')}</option>
              <option value="pending">{t('conversation.pending')}</option>
              <option value="resolved">{t('conversation.resolved')}</option>
            </select>
          </label>
          <label className="qm-field">
            <span>{t('macros.assign')}</span>
            <select value={form.assignTo} onChange={(e) => setForm((f) => ({ ...f, assignTo: e.target.value }))}>
              <option value="">{t('macros.none')}</option>
              <option value="me">{t('macros.me')}</option>
              <option value="__none">{t('conversation.unassigned')}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.email}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="qm-row">
          <label className="qm-field">
            <span>{t('macros.tags')}</span>
            <input
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              placeholder="billing urgent"
              maxLength={200}
            />
          </label>
          <label className="qm-field">
            <span>{t('macros.snooze')}</span>
            <select value={form.snoozeHours} onChange={(e) => setForm((f) => ({ ...f, snoozeHours: e.target.value }))}>
              <option value="">{t('macros.none')}</option>
              <option value="1">{t('conversation.snooze.1h')}</option>
              <option value="4">{t('conversation.snooze.4h')}</option>
              <option value="24">{t('conversation.snooze.24h')}</option>
              <option value="72">{t('conversation.snooze.3d')}</option>
              <option value="168">{t('conversation.snooze.7d')}</option>
            </select>
          </label>
        </div>
      </QuickModal>
    </section>
  );
}

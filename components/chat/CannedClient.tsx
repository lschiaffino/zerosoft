'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatCannedResponseRow } from '@/lib/chat-data';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';

interface CannedClientProps {
  widgetId: string;
}

interface CannedForm {
  shortcut: string;
  title: string;
  body: string;
}

function emptyForm(): CannedForm {
  return { shortcut: '', title: '', body: '' };
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

export default function CannedClient({ widgetId }: CannedClientProps) {
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
    setForm({ shortcut: response.shortcut, title: response.title, body: response.body });
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
        body: JSON.stringify({ shortcut, title, body }),
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
      </QuickModal>
    </section>
  );
}

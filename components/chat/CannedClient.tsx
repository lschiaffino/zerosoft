'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatCannedResponseRow } from '@/lib/chat-data';

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

export default function CannedClient({ widgetId }: CannedClientProps) {
  const t = useTranslations('chat');
  const [responses, setResponses] = useState<ChatCannedResponseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CannedForm>(emptyForm());

  async function fetchResponses() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/chat/widgets/${widgetId}/canned`);
      if (!res.ok) throw new Error('fetch_failed');
      const data = (await res.json()) as { responses: ChatCannedResponseRow[] };
      setResponses(data.responses);
    } catch {
      setError(t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchResponses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetId]);

  function startEdit(response: ChatCannedResponseRow) {
    setEditingId(response.id);
    setForm({
      shortcut: response.shortcut,
      title: response.title,
      body: response.body,
    });
  }

  function startCreate() {
    setEditingId('new');
    setForm(emptyForm());
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm());
  }

  async function save() {
    const shortcut = form.shortcut.trim();
    const title = form.title.trim();
    const body = form.body.trim();
    if (!shortcut || !title || !body) return;
    setSaving(true);
    setError(null);
    try {
      const url =
        editingId === 'new'
          ? `/api/chat/widgets/${widgetId}/canned`
          : `/api/chat/canned/${editingId}`;
      const method = editingId === 'new' ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortcut, title, body }),
      });
      if (!res.ok) throw new Error('save_failed');
      await fetchResponses();
      setEditingId(null);
      setForm(emptyForm());
    } catch {
      setError(t('errors.generic'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t('common.delete'))) return;
    await fetch(`/api/chat/canned/${id}`, { method: 'DELETE' });
    await fetchResponses();
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <p className="section-label">{t('canned.title')}</p>
        <button type="button" className="btn btn-small" onClick={startCreate}>
          {t('canned.add')}
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}

      {editingId && (
        <div className="chat-canned-form panel">
          <label className="field">
            <span className="prop-label">{t('canned.shortcut')}</span>
            <input
              className="input"
              value={form.shortcut}
              onChange={(e) => setForm((f) => ({ ...f, shortcut: e.target.value }))}
              placeholder="/greeting"
            />
          </label>
          <label className="field">
            <span className="prop-label">{t('widgetForm.name')}</span>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </label>
          <label className="field">
            <span className="prop-label">{t('canned.body')}</span>
            <textarea
              className="textarea"
              rows={5}
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              placeholder={t('canned.placeholder')}
            />
          </label>
          <div className="form-actions">
            <button type="button" className="btn btn-small" onClick={cancelEdit} disabled={saving}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-solid btn-small"
              onClick={save}
              disabled={saving || !form.shortcut.trim() || !form.title.trim() || !form.body.trim()}
            >
              {saving ? t('common.loading') : t('common.save')}
            </button>
          </div>
        </div>
      )}

      {responses.length === 0 && !loading ? (
        <div className="chat-list-empty">
          <p className="empty-zeros mono" aria-hidden>0 0 0</p>
          <p className="muted">{t('canned.empty')}</p>
        </div>
      ) : (
        <ul className="chat-canned-list">
          {responses.map((r) => (
            <li key={r.id} className="chat-canned-row">
              <div className="chat-canned-main">
                <span className="chat-canned-shortcut mono">{r.shortcut}</span>
                <span className="chat-canned-title">{r.title}</span>
              </div>
              <p className="chat-canned-body">{r.body}</p>
              <div className="chat-canned-actions">
                <button type="button" className="btn btn-small" onClick={() => startEdit(r)}>
                  {t('common.edit')}
                </button>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => remove(r.id)}>
                  {t('common.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

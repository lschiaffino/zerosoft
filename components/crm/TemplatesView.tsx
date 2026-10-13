'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';

export interface TemplateRowView {
  id: string;
  kind: 'template' | 'snippet';
  name: string;
  subject: string;
  body: string;
  updated: string;
  canManage: boolean;
}

interface Draft {
  id: string | null;
  kind: 'template' | 'snippet';
  name: string;
  subject: string;
  body: string;
  canManage: boolean;
}

/** Variables disponibles (lib/crm-email.ts TEMPLATE_VARIABLES + custom). */
const VARIABLES = [
  'contact.first_name',
  'contact.last_name',
  'contact.company',
  'contact.job_title',
  'deal.name',
  'owner.first_name',
  'contact.custom.x',
];

/**
 * Templates y snippets: lista con tabs, alta/edición en QuickModal (tecla C),
 * variables insertables y preview con un contacto (avisa variables vacías).
 */
export default function TemplatesView({
  rows,
  contacts,
  title,
}: {
  rows: TemplateRowView[];
  contacts: Array<{ id: string; label: string }>;
  title: string;
}) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [tab, setTab] = useState<'template' | 'snippet'>('template');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewContact, setPreviewContact] = useState('');
  const [preview, setPreview] = useState<{ subject: string; body: string; missing: string[] } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const visible = rows.filter((r) => r.kind === tab);

  function openNew(kind: 'template' | 'snippet' = tab) {
    setDraft({ id: null, kind, name: '', subject: '', body: '', canManage: true });
    setPreview(null);
    setError(null);
  }
  useKeyShortcut('c', () => openNew(), draft === null);

  function openEdit(r: TemplateRowView) {
    setDraft({ id: r.id, kind: r.kind, name: r.name, subject: r.subject, body: r.body, canManage: r.canManage });
    setPreview(null);
    setError(null);
  }

  function insertVar(v: string) {
    if (!draft) return;
    const token = `{{${v}}}`;
    const el = bodyRef.current;
    if (!el) {
      setDraft({ ...draft, body: draft.body + token });
      return;
    }
    const start = el.selectionStart ?? draft.body.length;
    const end = el.selectionEnd ?? start;
    const next = draft.body.slice(0, start) + token + draft.body.slice(end);
    setDraft({ ...draft, body: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function runPreview(contactId: string) {
    setPreviewContact(contactId);
    if (!draft || !contactId) {
      setPreview(null);
      return;
    }
    const res = await fetch('/api/crm/email-templates/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: draft.subject, body: draft.body, contactId }),
    }).catch(() => null);
    setPreview(res?.ok ? await res.json() : null);
  }

  async function save() {
    if (!draft || !draft.name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const payload = { name: draft.name.trim(), subject: draft.subject, body: draft.body };
    const res = await fetch(draft.id ? `/api/crm/email-templates/${draft.id}` : '/api/crm/email-templates', {
      method: draft.id ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft.id ? payload : { ...payload, kind: draft.kind }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error && t.has(`errors.${data.error}`) ? t(`errors.${data.error}` as 'errors.generic') : t('errors.generic'));
      return;
    }
    setDraft(null);
    router.refresh();
  }

  async function remove(id: string) {
    await fetch(`/api/crm/email-templates/${id}`, { method: 'DELETE' }).catch(() => null);
    setConfirmId(null);
    router.refresh();
  }

  const readOnly = draft !== null && !draft.canManage;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="app-title">{title}</h1>
          <p className="muted app-sub">{t('templates.sub')}</p>
        </div>
        <button type="button" className="btn btn-solid btn-small" onClick={() => openNew()}>
          {tab === 'template' ? t('templates.newCta') : t('templates.newSnippet')}
          <span className="kbd-hint" aria-hidden>
            C
          </span>
        </button>
      </div>

      <div className="filter-chips" role="tablist">
        {(['template', 'snippet'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={`chip${tab === k ? ' active' : ''}`}
            onClick={() => setTab(k)}
          >
            {k === 'template' ? t('templates.tabTemplates') : t('templates.tabSnippets')}
            <span className="tl-count">{rows.filter((r) => r.kind === k).length}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="empty-state">
          <p className="empty-zeros mono" aria-hidden>
            0 0 0 0 0 0 0
          </p>
          <h2>{tab === 'template' ? t('templates.emptyTitle') : t('templates.snippetsEmptyTitle')}</h2>
          <p className="muted">{tab === 'template' ? t('templates.emptySub') : t('templates.snippetsEmptySub')}</p>
          <button type="button" className="btn btn-solid btn-small" onClick={() => openNew()}>
            {tab === 'template' ? t('templates.emptyCta') : t('templates.newSnippet')}
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table crm-table">
            <thead>
              <tr>
                <th>{t('templates.name')}</th>
                <th>{tab === 'template' ? t('templates.subject') : t('templates.body')}</th>
                <th>{t('templates.updated')}</th>
                <th aria-label={t('common.actions')} />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button type="button" className="cell-name link-btn" onClick={() => openEdit(r)}>
                      {r.name}
                    </button>
                  </td>
                  <td className="muted tpl-snip">{tab === 'template' ? r.subject || '—' : r.body.slice(0, 120)}</td>
                  <td className="mono muted cell-date">{r.updated}</td>
                  <td>
                    {r.canManage &&
                      (confirmId === r.id ? (
                        <div className="cell-actions confirm">
                          <span className="confirm-label">{t('templates.deleteConfirm')}</span>
                          <button type="button" className="icon-btn danger" onClick={() => remove(r.id)}>
                            {t('common.yes')}
                          </button>
                          <button type="button" className="icon-btn" onClick={() => setConfirmId(null)}>
                            {t('common.no')}
                          </button>
                        </div>
                      ) : (
                        <div className="cell-actions">
                          <button
                            type="button"
                            className="icon-btn danger"
                            title={t('common.delete')}
                            aria-label={t('common.delete')}
                            onClick={() => setConfirmId(r.id)}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <QuickModal
        open={draft !== null}
        onClose={() => setDraft(null)}
        crumb={`CRM › ${
          draft?.id
            ? `${t('templates.crumbEdit')} · ${draft.name}`
            : draft?.kind === 'snippet'
              ? t('templates.crumbNewSnippet')
              : t('templates.crumbNew')
        }`}
        onSubmit={save}
        submitLabel={draft?.id ? t('templates.save') : t('templates.create')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!draft?.name.trim() || readOnly}
        busy={busy}
        error={error ?? (readOnly ? t('templates.readOnly') : null)}
        hint={t('quick.hint')}
        width={640}
      >
        {draft && (
          <>
            <input
              className="qm-title"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder={t('templates.name')}
              maxLength={200}
              readOnly={readOnly}
              data-autofocus
            />
            {draft.kind === 'template' && (
              <input
                className="qm-input"
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                placeholder={t('templates.subject')}
                maxLength={500}
                readOnly={readOnly}
              />
            )}
            <textarea
              ref={bodyRef}
              className="qm-input tpl-body"
              rows={9}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              placeholder={t('templates.body')}
              maxLength={20000}
              readOnly={readOnly}
            />
            {!readOnly && (
              <div className="tpl-vars">
                <span className="tpl-vars-label mono">{t('templates.variables')}</span>
                {VARIABLES.map((v) => (
                  <button key={v} type="button" className="tpl-var mono" onClick={() => insertVar(v)}>
                    {v}
                  </button>
                ))}
                <span className="muted tpl-vars-hint">
                  {t('templates.variablesHint', { example: '{{contact.first_name | there}}' })}
                </span>
              </div>
            )}
            {contacts.length > 0 && (
              <div className="tpl-preview">
                <select
                  className="filter-select"
                  value={previewContact}
                  onChange={(e) => runPreview(e.target.value)}
                  aria-label={t('templates.preview')}
                >
                  <option value="">{t('templates.pickContact')}</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                {preview && (
                  <div className="tpl-preview-box">
                    {draft.kind === 'template' && <p className="tpl-preview-subject">{preview.subject || '—'}</p>}
                    <p className="tpl-preview-body">{preview.body || '—'}</p>
                    <p className={`mono ${preview.missing.length ? 'em-warn' : 'muted'}`}>
                      {preview.missing.length
                        ? t('templates.missing', { vars: preview.missing.join(', ') })
                        : t('templates.missingNone')}
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </QuickModal>
    </>
  );
}

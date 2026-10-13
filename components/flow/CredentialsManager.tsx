'use client';

import { useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { CredentialDto } from '@/lib/flow-credentials';
import { CREDENTIAL_TYPE_KEYS, credentialFields, type CredentialType } from '@/lib/flow-credentials-schema';

interface Props {
  credentials: CredentialDto[];
  canEdit: boolean;
}

type Draft = { id: string | null; name: string; type: CredentialType; data: Record<string, string> };

const EMPTY: Draft = { id: null, name: '', type: 'api_key', data: {} };

/** Credenciales del workspace (/app/flow/credentials): alta, edición y baja. Los secretos no se muestran nunca. */
export default function CredentialsManager({ credentials: initial, canEdit }: Props) {
  const t = useTranslations('flow.credentials');
  const tf = useTranslations('flow');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [list, setList] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editing = draft?.id ? list.find((c) => c.id === draft.id) ?? null : null;

  function openNew() {
    setDraft({ ...EMPTY, data: {} });
    setError(null);
  }

  function openEdit(c: CredentialDto) {
    setDraft({ id: c.id, name: c.name, type: c.type, data: { ...c.fields } });
    setError(null);
  }

  function errorText(code: string | undefined, field?: string) {
    if (code === 'missing_field' && field) return t('errors.missing_field', { field: t(`fields.${field}`) });
    return code && t.has(`errors.${code}`) ? t(`errors.${code}`) : tf('errors.generic');
  }

  async function submit() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    const res = await fetch(draft.id ? `/api/flow/credentials/${draft.id}` : '/api/flow/credentials', {
      method: draft.id ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft.id ? { name: draft.name, data: draft.data } : draft),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { credential?: CredentialDto; error?: string; field?: string } | null;
    setBusy(false);
    if (!res?.ok || !data?.credential) {
      setError(errorText(data?.error, data?.field));
      return;
    }
    const saved = data.credential;
    setList((l) => (draft.id ? l.map((c) => (c.id === saved.id ? saved : c)) : [...l, saved].sort((a, b) => a.name.localeCompare(b.name))));
    setDraft(null);
  }

  async function remove(c: CredentialDto) {
    if (!window.confirm(t('confirmDelete', { name: c.name }))) return;
    const res = await fetch(`/api/flow/credentials/${c.id}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      setError(tf('errors.generic'));
      return;
    }
    setList((l) => l.filter((x) => x.id !== c.id));
    if (draft?.id === c.id) setDraft(null);
  }

  return (
    <div className="app-page flow-home flow-creds">
      <div className="page-header">
        <div>
          <p className="flow-crumb">
            <Link href="/app/flow">{tf('title')}</Link>
          </p>
          <h1 className="page-title">{t('title')}</h1>
          <p className="muted flow-sub">{t('subtitle')}</p>
        </div>
        {canEdit && !draft && (
          <button type="button" className="btn btn-solid" onClick={openNew}>
            {t('new')}
          </button>
        )}
      </div>
      {!canEdit && <p className="muted flow-note">{t('adminOnly')}</p>}
      {error && !draft && (
        <p className="flow-error" role="alert">
          {error}
        </p>
      )}

      {draft && (
        <form
          className="flow-cred-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h2 className="flow-section-title">{draft.id ? t('editTitle', { name: editing?.name ?? draft.name }) : t('newTitle')}</h2>
          <div className="flow-cred-grid">
            <label className="flow-field">
              <span className="label">{t('name')}</span>
              <input
                className="input mono"
                value={draft.name}
                required
                maxLength={60}
                pattern="[A-Za-z0-9_\-]{1,60}"
                placeholder="stripe-live"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <span className="muted flow-hint">{t('nameHint', { example: `{{credentials.${draft.name || 'name'}.password}}` })}</span>
            </label>
            <label className="flow-field">
              <span className="label">{t('type')}</span>
              <select
                className="select"
                value={draft.type}
                disabled={!!draft.id}
                onChange={(e) => setDraft({ ...draft, type: e.target.value as CredentialType, data: {} })}
              >
                {CREDENTIAL_TYPE_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {t(`types.${k}`)}
                  </option>
                ))}
              </select>
              <span className="muted flow-hint">{t(`typeHints.${draft.type}`)}</span>
            </label>
          </div>
          {credentialFields(draft.type).map((f) => {
            const saved = !!editing?.secretsSet.includes(f.key);
            const value = draft.data[f.key] ?? '';
            const common = {
              id: `cred-${f.key}`,
              className: `${f.multiline ? 'textarea' : 'input'} mono`,
              value,
              autoComplete: 'off',
              spellCheck: false,
              placeholder: f.secret && saved ? t('savedPlaceholder') : f.placeholder ?? '',
              onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                setDraft({ ...draft, data: { ...draft.data, [f.key]: e.target.value } }),
            };
            return (
              <div className="flow-field" key={f.key}>
                <label className="label" htmlFor={`cred-${f.key}`}>
                  {t(`fields.${f.key}`)}
                  {f.optional ? <span className="muted"> · {t('optional')}</span> : null}
                </label>
                {f.multiline ? <textarea rows={6} {...common} /> : <input type={f.secret ? 'password' : 'text'} {...common} />}
                {f.secret && saved && <span className="muted flow-hint">{t('keepHint')}</span>}
              </div>
            );
          })}
          {error && (
            <p className="flow-error" role="alert">
              {error}
            </p>
          )}
          <div className="flow-modal-actions">
            <button type="button" className="btn btn-small btn-ghost" onClick={() => setDraft(null)}>
              {tf('editor.cancel')}
            </button>
            <button type="submit" className="btn btn-small btn-solid" disabled={busy}>
              {busy ? tf('editor.saving') : tf('editor.save')}
            </button>
          </div>
          <p className="muted flow-hint">{t('security')}</p>
        </form>
      )}

      <section className="flow-section" aria-labelledby="flow-creds-list">
        <h2 id="flow-creds-list" className="flow-section-title">
          {t('listTitle')}
        </h2>
        {list.length === 0 ? (
          <div className="flow-empty">
            <p>{t('empty')}</p>
            <p className="muted">{t('emptyHint')}</p>
          </div>
        ) : (
          <div className="flow-table" role="table">
            <div className="flow-row flow-row-head flow-cred-row" role="row">
              <span role="columnheader">{t('name')}</span>
              <span role="columnheader">{t('type')}</span>
              <span role="columnheader">{t('value')}</span>
              <span role="columnheader">{t('updated')}</span>
              <span role="columnheader" />
            </div>
            {list.map((c) => (
              <div className="flow-row flow-cred-row" role="row" key={c.id}>
                <span role="cell" className="mono">
                  {c.name}
                </span>
                <span role="cell">{t(`types.${c.type}`)}</span>
                <span role="cell" className="mono muted">
                  {[...Object.values(c.fields).filter(Boolean), c.hint].filter(Boolean).join(' · ') || '—'}
                </span>
                <span role="cell" className="muted" suppressHydrationWarning>
                  {format.relativeTime(new Date(c.updatedAt), now)}
                </span>
                <span role="cell" className="flow-cred-actions">
                  {canEdit && (
                    <>
                      <button type="button" className="btn btn-small btn-ghost" onClick={() => openEdit(c)}>
                        {t('edit')}
                      </button>
                      <button type="button" className="btn btn-small btn-ghost" onClick={() => void remove(c)}>
                        {t('delete')}
                      </button>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

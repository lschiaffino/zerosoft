'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import AdvancedSection from '@/components/ui/AdvancedSection';
import type { CredentialDto } from '@/lib/flow-credentials';
import { CREDENTIAL_ONE_OF, CREDENTIAL_TYPE_KEYS, credentialFields, type CredentialType } from '@/lib/flow-credentials-schema';
import { suggestCredentialName } from './flow-ui';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (credential: CredentialDto) => void;
  /** Credencial a editar; sin ella, alta. */
  editing?: CredentialDto | null;
  /** Tipos que se pueden elegir (el nodo que la pide). Por defecto todos. */
  types?: readonly CredentialType[];
  /** Nombres existentes, para derivar uno libre ("slack", "slack-2"…). */
  existingNames: readonly string[];
}

/**
 * Alta y edición de una credencial en un <dialog> modal. Lo usan la página de
 * credenciales y el editor (desde el campo Credencial de un nodo, sin salir
 * del flow). El nombre técnico se deriva del tipo y queda en Avanzado.
 */
export default function CredentialDialog({ open, onClose, onSaved, editing = null, types, existingNames }: Props) {
  const t = useTranslations('flow.credentials');
  const tf = useTranslations('flow');
  const ref = useRef<HTMLDialogElement>(null);
  const allowed = types && types.length > 0 ? types : CREDENTIAL_TYPE_KEYS;
  const [type, setType] = useState<CredentialType>(editing?.type ?? allowed[0]);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [data, setData] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);

  // Al abrir: estado limpio (o el de la credencial a editar).
  useEffect(() => {
    if (!open) return;
    const first = editing?.type ?? allowed[0];
    setType(first);
    setName(editing?.name ?? suggestCredentialName(first, existingNames));
    setNameTouched(!!editing);
    setData(editing ? { ...editing.fields } : {});
    setError(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  function changeType(next: CredentialType) {
    setType(next);
    setData({});
    if (!nameTouched) setName(suggestCredentialName(next, existingNames));
  }

  const oneOf = CREDENTIAL_ONE_OF[type];

  async function submit() {
    // Slack y Google piden uno de dos campos: se avisa antes de mandar (al editar, vale el guardado).
    if (oneOf && !oneOf.some((k) => (data[k] ?? '').trim() || editing?.secretsSet.includes(k))) {
      setError({ text: t(`oneOf.${type}`), field: oneOf[0] });
      document.getElementById(`cred-${oneOf[0]}`)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(editing ? `/api/flow/credentials/${editing.id}` : '/api/flow/credentials', {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(editing ? { name, data } : { name, type, data }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { credential?: CredentialDto; error?: string; field?: string } | null;
    setBusy(false);
    if (!res?.ok || !body?.credential) {
      const code = body?.error;
      const text =
        code === 'missing_field' && body?.field
          ? t('errors.missing_field', { field: t(`fields.${body.field}`) })
          : code && t.has(`errors.${code}`)
            ? t(`errors.${code}`)
            : tf('errors.generic');
      setError({ text, field: code === 'invalid_name' || code === 'duplicate_name' ? 'name' : body?.field });
      return;
    }
    onSaved(body.credential);
  }

  const titleId = 'flow-cred-dialog-title';
  const nameError = error?.field === 'name';

  return (
    <dialog
      ref={ref}
      className="ui-modal"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="ui-modal-head">
            <h2 id={titleId} className="ui-modal-title">
              {editing ? t('editTitle', { name: editing.name }) : t('newTitle')}
            </h2>
          </div>
          <div className="ui-modal-body ui-fields">
            <div className="ui-field">
              <label className="label" htmlFor="cred-type">
                {t('type')}
              </label>
              <select
                id="cred-type"
                className="select"
                value={type}
                disabled={!!editing || allowed.length === 1}
                onChange={(e) => changeType(e.target.value as CredentialType)}
              >
                {allowed.map((k) => (
                  <option key={k} value={k}>
                    {t(`types.${k}`)}
                  </option>
                ))}
              </select>
              <p className="ui-help">{t(`typeHints.${type}`)}</p>
            </div>
            {oneOf && (
              <p className="ui-help" id="cred-one-of">
                {t(`oneOf.${type}`)}
              </p>
            )}
            {credentialFields(type).map((f, i) => {
              const saved = !!editing?.secretsSet.includes(f.key);
              const id = `cred-${f.key}`;
              const invalid = error?.field === f.key;
              const inOneOf = !!oneOf?.includes(f.key);
              const common = {
                id,
                className: `${f.multiline ? 'textarea' : 'input'} data`,
                value: data[f.key] ?? '',
                autoComplete: 'off',
                spellCheck: false,
                autoFocus: i === 0,
                'aria-invalid': invalid || undefined,
                'aria-describedby': [inOneOf && 'cred-one-of', invalid && `${id}-error`].filter(Boolean).join(' ') || undefined,
                placeholder: f.secret && saved ? t('savedPlaceholder') : (f.placeholder ?? ''),
                onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setData({ ...data, [f.key]: e.target.value }),
              };
              return (
                <div className="ui-field" key={f.key}>
                  <label className="label" htmlFor={id}>
                    {t(`fields.${f.key}`)}
                    {f.optional && !inOneOf && <span className="ui-optional"> · {t('optional')}</span>}
                  </label>
                  {f.multiline ? <textarea rows={5} {...common} /> : <input type={f.secret ? 'password' : 'text'} {...common} />}
                  {f.secret && saved && <p className="ui-help">{t('keepHint')}</p>}
                  {f.key === 'totpSecret' && (
                    <p className="ui-help">{t('totpHint', { example: `{{credentials.${name || 'name'}.totp}}` })}</p>
                  )}
                  {invalid && (
                    <p className="ui-error" id={`${id}-error`}>
                      {error.text}
                    </p>
                  )}
                </div>
              );
            })}
            <AdvancedSection storageKey="flow.credential" hint={nameError ? undefined : name} defaultOpen={nameError}>
              <div className="ui-field">
                <label className="label" htmlFor="cred-name">
                  {t('name')}
                </label>
                <input
                  id="cred-name"
                  className="input data"
                  value={name}
                  maxLength={60}
                  aria-invalid={nameError || undefined}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameTouched(true);
                  }}
                />
                <p className="ui-help">{t('nameHint', { example: `{{credentials.${name || 'name'}.password}}` })}</p>
                {nameError && <p className="ui-error">{error.text}</p>}
              </div>
            </AdvancedSection>
            {error && !error.field && (
              <p className="ui-error" role="alert">
                {error.text}
              </p>
            )}
            {error?.field && (
              <p className="sr-only" role="alert">
                {error.text}
              </p>
            )}
            <p className="ui-help">{t('security')}</p>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              {tf('editor.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>
              {editing ? t('saveChanges') : t('create')}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

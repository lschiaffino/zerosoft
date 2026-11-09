'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import LocalDate from '@/components/ui/LocalDate';

export interface PendingErasure {
  kind: 'account' | 'workspace';
  dueAt: string;
}

/** Diálogo de borrado: se confirma tipeando el email o el nombre del workspace. */
function DeleteDialog({
  open,
  title,
  body,
  expected,
  inputLabel,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: string;
  expected: string;
  inputLabel: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (typed: string) => Promise<string | null>;
}) {
  const t = useTranslations('settings.privacy');
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setTyped('');
      setError(null);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);
  const matches = typed.trim().toLowerCase() === expected.trim().toLowerCase();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!matches || busy) return;
    setBusy(true);
    const err = await onConfirm(typed.trim());
    setBusy(false);
    if (err) setError(err);
  }
  return (
    <dialog ref={ref} className="ui-modal" aria-labelledby={`${id}-t`} onCancel={(e) => (e.preventDefault(), onClose())} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="ui-modal-head">
          <h2 id={`${id}-t`}>{title}</h2>
        </div>
        <div className="ui-modal-body">
          <p>{body}</p>
          <div className="ui-field">
            <label className="label" htmlFor={`${id}-i`}>
              {inputLabel}
            </label>
            <input id={`${id}-i`} className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} data-testid="delete-confirm-input" />
          </div>
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="ui-modal-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose} autoFocus>
            {t('cancel')}
          </button>
          <button type="submit" className="btn btn-danger" disabled={!matches || busy} aria-busy={busy || undefined} data-testid="delete-confirm">
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function PendingNotice({ pending, locale }: { pending: PendingErasure; locale: string }) {
  const t = useTranslations('settings.privacy');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="st-callout st-erasure" role="status" data-testid="erasure-pending">
      <p>
        {t(pending.kind === 'account' ? 'pendingAccount' : 'pendingWorkspace')} <LocalDate value={pending.dueAt} locale={locale} kind="date" />.
      </p>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy}
        aria-busy={busy || undefined}
        data-testid="erasure-cancel"
        onClick={async () => {
          setBusy(true);
          const res = await fetch('/api/account/delete', { method: 'DELETE' }).catch(() => null);
          setBusy(false);
          if (!res?.ok) return setError(t('error'));
          router.refresh();
        }}
      >
        {t('cancelDeletion')}
      </button>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

async function requestDeletion(kind: 'account' | 'workspace', confirm: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/account/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, confirm }),
  }).catch(() => null);
  const data = ((await res?.json().catch(() => null)) ?? {}) as { error?: string };
  return { ok: Boolean(res?.ok), error: data.error };
}

/** Ajustes › Perfil › Tus datos: descargar todo y borrar la cuenta (con 30 días para arrepentirse). */
export function AccountDataSection({ email, locale, pending, workspaceMembers }: { email: string; locale: string; pending: PendingErasure | null; workspaceMembers: number }) {
  const t = useTranslations('settings.privacy');
  const [open, setOpen] = useState(false);
  return (
    <FormSection title={t('title')} description={t('desc')} id="your-data">
      {pending && <PendingNotice pending={pending} locale={locale} />}
      <div className="ws-danger">
        <div>
          <p className="st-strong">{t('exportTitle')}</p>
          <p className="ui-help">{t('exportBody')}</p>
          <a className="btn btn-secondary" href="/api/account/export" download data-testid="account-export">
            {t('exportCta')}
          </a>
        </div>
        {pending?.kind !== 'account' && (
          <div>
            <p className="st-strong">{t('deleteTitle')}</p>
            <p className="ui-help">{workspaceMembers > 1 ? t('deleteBodyMembers', { count: workspaceMembers - 1 }) : t('deleteBody')}</p>
            <button type="button" className="btn btn-danger" onClick={() => setOpen(true)} data-testid="account-delete">
              {t('deleteCta')}
            </button>
          </div>
        )}
      </div>
      <DeleteDialog
        open={open}
        title={t('deleteTitle')}
        body={t('deleteDialogBody')}
        expected={email}
        inputLabel={t('typeEmail', { email })}
        confirmLabel={t('deleteCta')}
        onClose={() => setOpen(false)}
        onConfirm={async (typed) => {
          const res = await requestDeletion('account', typed);
          if (!res.ok) return res.error === 'confirm_mismatch' ? t('mismatch') : t('error');
          // Borrar la cuenta cierra todas las sesiones, también esta.
          await signOut({ callbackUrl: `/${locale}` });
          return null;
        }}
      />
    </FormSection>
  );
}

/** Ajustes › Workspace › zona de cierre (solo el owner): borrar el workspace, con 30 días para arrepentirse. */
export function DeleteWorkspaceBlock({ name, locale, pending }: { name: string; locale: string; pending: PendingErasure | null }) {
  const t = useTranslations('settings.privacy');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (pending) return <PendingNotice pending={pending} locale={locale} />;
  return (
    <div>
      <p className="st-strong">{t('workspaceTitle')}</p>
      <p className="ui-help">{t('workspaceBody')}</p>
      <button type="button" className="btn btn-danger" onClick={() => setOpen(true)} data-testid="workspace-delete">
        {t('workspaceCta')}
      </button>
      <DeleteDialog
        open={open}
        title={t('workspaceTitle')}
        body={t('workspaceDialogBody')}
        expected={name}
        inputLabel={t('typeWorkspace', { name })}
        confirmLabel={t('workspaceCta')}
        onClose={() => setOpen(false)}
        onConfirm={async (typed) => {
          const res = await requestDeletion('workspace', typed);
          if (!res.ok) return res.error === 'confirm_mismatch' ? t('mismatch') : t('error');
          setOpen(false);
          router.refresh();
          return null;
        }}
      />
    </div>
  );
}

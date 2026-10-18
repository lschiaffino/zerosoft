'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';

interface DangerZoneProps {
  id: string;
  slug: string;
  archived: boolean;
  /** Borrar es solo para admins (como el borrado masivo); el resto puede archivar. */
  canDelete: boolean;
}

/** Archivar o borrar. Borrar pide escribir el slug. */
export default function DangerZone({ id, slug, archived, canDelete }: DangerZoneProps) {
  const t = useTranslations('link');
  const router = useRouter();
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState<'archive' | 'delete' | null>(null);
  const [failed, setFailed] = useState(false);

  async function toggleArchive() {
    setBusy('archive');
    setFailed(false);
    const res = await fetch(`/api/links/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: !archived }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) setFailed(true);
    router.refresh();
  }

  async function onDelete(e: React.FormEvent) {
    e.preventDefault();
    if (confirmText !== slug) return;
    setBusy('delete');
    setFailed(false);
    const res = await fetch(`/api/links/${id}`, { method: 'DELETE' }).catch(() => null);
    if (res && res.status === 204) {
      router.push('/app/links');
      return;
    }
    setBusy(null);
    setFailed(true);
  }

  return (
    <FormSection
      title={t('detail.dangerZone')}
      tone="danger"
      footer={
        failed ? (
          <p className="ui-error" role="alert">
            {t('errors.generic')}
          </p>
        ) : undefined
      }
    >
      <div className="lk-danger-row">
        <div>
          <p className="lk-danger-title">{archived ? t('detail.unarchiveTitle') : t('detail.archiveTitle')}</p>
          <p className="ui-help">{archived ? t('detail.unarchiveDesc') : t('detail.archiveDesc')}</p>
        </div>
        <button type="button" className="btn" onClick={toggleArchive} disabled={busy !== null} aria-busy={busy === 'archive' || undefined}>
          {archived ? t('detail.unarchiveButton') : t('detail.archiveButton')}
        </button>
      </div>

      {canDelete && (
        <form className="lk-danger-row" onSubmit={onDelete}>
          <div>
            <p className="lk-danger-title">{t('detail.deleteTitle')}</p>
            <p className="ui-help">{t('detail.deleteDesc')}</p>
          </div>
          <div className="lk-danger-delete">
            <label className="label" htmlFor="lk-delete-confirm">
              {t('detail.deleteHint', { slug })}
            </label>
            <input
              id="lk-delete-confirm"
              className="input mono"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={slug}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="submit"
              className="btn btn-primary btn-danger"
              disabled={busy !== null || confirmText !== slug}
              aria-busy={busy === 'delete' || undefined}
            >
              {t('detail.deleteButton')}
            </button>
          </div>
        </form>
      )}
    </FormSection>
  );
}

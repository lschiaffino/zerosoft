'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

interface DangerZoneProps {
  id: string;
  slug: string;
  archived: boolean;
}

/** Archive/unarchive + delete with "type the slug to confirm". */
export default function DangerZone({ id, slug, archived }: DangerZoneProps) {
  const t = useTranslations('link');
  const router = useRouter();
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  async function toggleArchive() {
    setBusy(true);
    await fetch(`/api/links/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: !archived }),
    }).catch(() => null);
    setBusy(false);
    router.refresh();
  }

  async function onDelete() {
    if (confirmText !== slug) return;
    setBusy(true);
    const res = await fetch(`/api/links/${id}`, { method: 'DELETE' }).catch(() => null);
    if (res && res.status === 204) {
      router.push('/app/links');
      return;
    }
    setBusy(false);
  }

  return (
    <div className="danger-zone">
      <div className="danger-row">
        <div>
          <p className="danger-title">{archived ? t('common.unarchive') : t('common.archive')}</p>
          <p className="muted danger-desc">{t('detail.archiveDesc')}</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={toggleArchive}
          disabled={busy}
        >
          {archived ? t('common.unarchive') : t('common.archive')}
        </button>
      </div>

      <div className="danger-row">
        <div>
          <p className="danger-title">{t('detail.deleteTitle')}</p>
          <p className="muted danger-desc">{t('detail.deleteDesc')}</p>
        </div>
        <div className="danger-delete">
          <input
            className="input mono"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={t('detail.deleteHint', { slug })}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="btn btn-ghost btn-small btn-danger"
            onClick={onDelete}
            disabled={busy || confirmText !== slug}
          >
            {t('detail.deleteButton')}
          </button>
        </div>
      </div>
    </div>
  );
}

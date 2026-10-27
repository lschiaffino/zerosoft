'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

/** Confirmar "Duplicar a mi workspace" de una página publicada. */
export default function DocsDuplicatePublic({
  handle,
  slug,
  title,
  teamspaces,
  canWorkspace,
}: {
  handle: string;
  slug: string;
  title: string;
  teamspaces: Array<{ id: string; name: string }>;
  canWorkspace: boolean;
}) {
  const t = useTranslations('docs.duplicatePublic');
  const router = useRouter();
  const [dest, setDest] = useState(canWorkspace ? '' : (teamspaces[0]?.id ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/docs/help/duplicate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle, slug, teamspace_id: dest || null }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (!res?.ok || !data?.id) {
      setBusy(false);
      setError(data?.error === 'not_found' ? t('notFound') : data?.error === 'forbidden' ? t('forbidden') : t('failed'));
      return;
    }
    router.push(`/app/docs/${data.id}`);
  }

  return (
    <form
      className="ui-fields"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
      data-testid="docs-duplicate-public"
    >
      <p>{t('lead', { title: title || t('untitled') })}</p>
      {(teamspaces.length > 0 || !canWorkspace) && (
        <div className="ui-field">
          <label className="label" htmlFor="dup-dest">
            {t('destination')}
          </label>
          <select id="dup-dest" className="select" value={dest} onChange={(e) => setDest(e.target.value)}>
            {canWorkspace && <option value="">{t('workspace')}</option>}
            {teamspaces.map((ts) => (
              <option key={ts.id} value={ts.id}>
                {ts.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {error && (
        <p className="ximp-note" data-tone="bad" role="alert">
          {error}
        </p>
      )}
      <div className="ximp-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || (!canWorkspace && !dest)} aria-busy={busy || undefined}>
          {busy ? t('working') : t('confirm')}
        </button>
      </div>
    </form>
  );
}

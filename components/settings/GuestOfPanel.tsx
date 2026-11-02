'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import FormSection from '@/components/ui/FormSection';
import { Link, useRouter } from '@/i18n/navigation';

/**
 * Ajustes › Miembros: los workspaces donde soy guest. No aparecen en el
 * switcher porque un guest no entra: acá ve dónde lo es y se puede ir.
 */
export default function GuestOfPanel({ workspaces }: { workspaces: Array<{ id: string; name: string }> }) {
  const t = useTranslations('settings.members');
  const router = useRouter();
  const [rows, setRows] = useState(workspaces);
  const [leaving, setLeaving] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    if (!leaving) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/teams/guest-of', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: leaving.id }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setLeaving(null);
      setError(t('guestOf.error'));
      return;
    }
    setRows((r) => r.filter((x) => x.id !== leaving.id));
    setLeaving(null);
    router.refresh();
  }

  if (!rows.length && !error) return null;
  return (
    <FormSection title={t('guestOf.title')} description={t('guestOf.desc')}>
      <div className="ws-danger" data-testid="guest-of">
        {rows.map((w) => (
          <div key={w.id} className="ws-guest-row">
            <p className="st-strong ws-guest-name">{w.name}</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLeaving(w)}>
              {t('guestOf.leave')}
            </button>
          </div>
        ))}
        <Link href="/app/docs" className="btn btn-secondary btn-sm">
          {t('guestOf.openDocs')}
        </Link>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <ConfirmDialog
        open={leaving !== null}
        danger
        busy={busy}
        title={t('guestOf.confirmTitle', { workspace: leaving?.name ?? '' })}
        body={t('guestOf.confirmBody')}
        confirmLabel={t('guestOf.leave')}
        cancelLabel={t('cancel')}
        onConfirm={() => void leave()}
        onCancel={() => setLeaving(null)}
      />
    </FormSection>
  );
}

'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import NameDialog from './NameDialog';
import { ApiError, apiErrorText, notifyChanged } from './client';

export interface RecordItem {
  id: string;
  name: string;
  meta?: ReactNode;
  href: string;
}

/**
 * Lista de lo que la persona crea en Analytics (insights, tableros,
 * cohortes, flags, proyectos): abrir, renombrar y borrar con modales, y los
 * cambios se ven al instante (la página vuelve a pedir sus datos).
 */
export default function RecordList({
  items,
  labels,
  canEdit = true,
  onRename,
  onDelete,
  testId,
}: {
  items: RecordItem[];
  labels: { name: string; meta?: string; rename: string; delete: string; deleteTitle: (name: string) => string; deleteBody: string };
  canEdit?: boolean;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  testId?: string;
}) {
  const t = useTranslations('analytics.common');
  const router = useRouter();
  const [renaming, setRenaming] = useState<RecordItem | null>(null);
  const [deleting, setDeleting] = useState<RecordItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>, done: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      done();
      notifyChanged();
      router.refresh();
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="table-wrap">
        <table className="table an-list" data-testid={testId}>
          <thead>
            <tr>
              <th scope="col">{labels.name}</th>
              {labels.meta && <th scope="col">{labels.meta}</th>}
              {canEdit && (
                <th scope="col" className="an-actions-col">
                  <span className="sr-only">{t('actions')}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <Link href={item.href} className="an-row-link">
                    {item.name}
                  </Link>
                </td>
                {labels.meta && <td className="an-muted">{item.meta}</td>}
                {canEdit && (
                  <td className="an-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenaming(item)} aria-label={`${labels.rename}: ${item.name}`}>
                      {labels.rename}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(item)} aria-label={`${labels.delete}: ${item.name}`}>
                      {labels.delete}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <NameDialog
        open={renaming !== null}
        title={labels.rename}
        label={labels.name}
        initial={renaming?.name ?? ''}
        submitLabel={t('save')}
        busy={busy}
        error={error}
        onClose={() => {
          setRenaming(null);
          setError(null);
        }}
        onSubmit={(name) => renaming && run(() => onRename(renaming.id, name), () => setRenaming(null))}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? labels.deleteTitle(deleting.name) : ''}
        body={error ?? labels.deleteBody}
        confirmLabel={labels.delete}
        cancelLabel={t('cancel')}
        danger
        busy={busy}
        onCancel={() => {
          setDeleting(null);
          setError(null);
        }}
        onConfirm={() => deleting && run(() => onDelete(deleting.id), () => setDeleting(null))}
      />
    </>
  );
}

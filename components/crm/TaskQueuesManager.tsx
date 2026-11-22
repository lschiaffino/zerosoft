'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import CrmIcon from './CrmIcon';

export interface QueueItem {
  id: string;
  name: string;
  shared: boolean;
  mine: boolean;
  canEdit: boolean;
  openCount?: number;
}

interface TaskQueuesManagerProps {
  queues: QueueItem[];
}

/**
 * Colas de tareas con nombre (como las de HubSpot): crear, renombrar,
 * compartir con el workspace, borrar y empezar a trabajarlas. Un panel lateral
 * (dialog): Esc y el clic afuera lo cierran y el foco vuelve al botón.
 */
export default function TaskQueuesManager({ queues }: TaskQueuesManagerProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
  }, [open]);

  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    const res = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    setBusy(false);
    if (res && res.ok) {
      router.refresh();
      return true;
    }
    const data = (await res?.json().catch(() => null)) as { error?: string } | null;
    setError(data?.error && t.has(`errors.${data.error}`) ? t(`errors.${data.error}` as 'errors.generic') : t('errors.generic'));
    return false;
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (await call('/api/crm/tasks/queues', 'POST', { name: name.trim(), shared })) {
      setName('');
      setShared(false);
    }
  }

  async function onRename(id: string) {
    if (!draft.trim()) return;
    if (await call(`/api/crm/tasks/queues/${id}`, 'PATCH', { name: draft.trim() })) setEditing(null);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-secondary btn-sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        data-testid="task-queues-manage"
      >
        {t('tasks.queues.manage')}
      </button>

      {open && (
        <dialog
          ref={dialogRef}
          className="ui-drawer"
          aria-label={t('tasks.queues.manage')}
          data-testid="task-queues-dialog"
          onClose={() => {
            setOpen(false);
            setEditing(null);
            setConfirming(null);
            buttonRef.current?.focus();
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) dialogRef.current?.close();
          }}
        >
          <div className="ui-drawer-head">
            <h2 className="ui-drawer-title">{t('tasks.queues.manage')}</h2>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => dialogRef.current?.close()} aria-label={t('common.close')}>
              <CrmIcon name="x" size={16} />
            </button>
          </div>
          <div className="ui-drawer-body task-projects-panel">
            <p className="muted task-queues-help">{t('tasks.queues.help')}</p>
            <form className="task-queue-form" onSubmit={onCreate}>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('tasks.queues.namePlaceholder')}
                aria-label={t('tasks.queues.namePlaceholder')}
                maxLength={100}
                data-testid="task-queue-name"
              />
              <label className="task-queue-shared">
                <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
                <span>{t('tasks.queues.shareWithAll')}</span>
              </label>
              <button type="submit" className="btn btn-small btn-solid" disabled={busy || !name.trim()} data-testid="task-queue-create">
                {busy ? t('common.creating') : t('common.add')}
              </button>
            </form>

            <ul className="task-project-list" data-testid="task-queue-list">
              {queues.map((q) => (
                <li key={q.id} className="task-project-item task-queue-item" data-testid="task-queue-item">
                  {editing === q.id ? (
                    <form
                      className="task-queue-rename"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void onRename(q.id);
                      }}
                    >
                      <input
                        className="input"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        aria-label={t('tasks.queues.rename')}
                        maxLength={100}
                        autoFocus
                        onKeyDown={(e) => {
                          // Esc cancela el renombre sin cerrar el panel.
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            e.stopPropagation();
                            setEditing(null);
                          }
                        }}
                      />
                      <button type="submit" className="btn btn-small btn-solid" disabled={busy}>
                        {t('common.save')}
                      </button>
                    </form>
                  ) : (
                    <>
                      <span className="task-project-name">
                        <span className="task-queue-name">{q.name}</span>
                        <span className="muted task-queue-meta">
                          {t('tasks.queues.openCount', { count: q.openCount ?? 0 })} · {q.shared ? t('tasks.queues.shared') : t('tasks.queues.private')}
                        </span>
                      </span>
                      <span className="task-queue-actions">
                        <Link
                          href={`/app/crm/tasks/queue?queue=${encodeURIComponent(q.id)}&scope=all&owner=all`}
                          className="btn btn-small btn-ghost"
                          data-testid="task-queue-start"
                        >
                          {t('tasks.queues.start')}
                        </Link>
                        {q.canEdit && confirming !== q.id && (
                          <>
                            <button
                              type="button"
                              className="btn btn-small btn-ghost"
                              onClick={() => {
                                setEditing(q.id);
                                setDraft(q.name);
                              }}
                            >
                              {t('tasks.queues.rename')}
                            </button>
                            <button
                              type="button"
                              className="btn btn-small btn-ghost"
                              onClick={() => call(`/api/crm/tasks/queues/${q.id}`, 'PATCH', { shared: !q.shared })}
                              disabled={busy}
                              data-testid="task-queue-share"
                            >
                              {q.shared ? t('tasks.queues.makePrivate') : t('tasks.queues.share')}
                            </button>
                            <button type="button" className="btn btn-small btn-ghost row-delete" onClick={() => setConfirming(q.id)}>
                              {t('common.delete')}
                            </button>
                          </>
                        )}
                        {confirming === q.id && (
                          <>
                            <span className="muted">{t('tasks.queues.deleteConfirm')}</span>
                            <button
                              type="button"
                              className="btn btn-small btn-ghost row-delete"
                              disabled={busy}
                              onClick={async () => {
                                if (await call(`/api/crm/tasks/queues/${q.id}`, 'DELETE')) setConfirming(null);
                              }}
                              data-testid="task-queue-delete-confirm"
                            >
                              {t('common.delete')}
                            </button>
                            <button type="button" className="btn btn-small btn-ghost" onClick={() => setConfirming(null)}>
                              {t('common.cancel')}
                            </button>
                          </>
                        )}
                      </span>
                    </>
                  )}
                </li>
              ))}
              {queues.length === 0 && <li className="muted">{t('tasks.queues.empty')}</li>}
            </ul>

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </dialog>
      )}
    </>
  );
}

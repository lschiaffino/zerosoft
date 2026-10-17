'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import CrmIcon from './CrmIcon';

interface ProjectOption {
  value: string;
  label: string;
  color: string;
  archived?: boolean;
}

interface TaskProjectsManagerProps {
  projects: ProjectOption[];
}

export default function TaskProjectsManager({ projects }: TaskProjectsManagerProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#666666');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (expanded && dialog && !dialog.open) dialog.showModal();
  }, [expanded]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/crm/tasks/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), color }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.ok) {
      setName('');
      setColor('#666666');
      router.refresh();
      return;
    }
    setError(t('errors.generic'));
  }

  async function toggleArchived(project: ProjectOption, currentArchived: boolean) {
    await fetch(`/api/crm/tasks/projects/${project.value}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: !currentArchived }),
    }).catch(() => null);
    router.refresh();
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-secondary btn-sm"
        aria-haspopup="dialog"
        aria-expanded={expanded}
        onClick={() => setExpanded(true)}
      >
        {t('tasks.projects.manage')}
      </button>

      {expanded && (
        <dialog
          ref={dialogRef}
          className="ui-drawer"
          aria-label={t('tasks.projects.manage')}
          onClose={() => {
            setExpanded(false);
            buttonRef.current?.focus();
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) dialogRef.current?.close();
          }}
        >
          <div className="ui-drawer-head">
            <h2 className="ui-drawer-title">{t('tasks.projects.manage')}</h2>
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm"
              onClick={() => dialogRef.current?.close()}
              aria-label={t('common.close')}
            >
              <CrmIcon name="x" size={16} />
            </button>
          </div>
          <div className="ui-drawer-body task-projects-panel">
            <form className="task-project-form" onSubmit={onSubmit}>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('tasks.projects.namePlaceholder')}
                maxLength={100}
              />
              <input
                className="input"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                title={t('tasks.projects.color')}
              />
              <button type="submit" className="btn btn-small btn-solid" disabled={busy}>
                {busy ? t('common.creating') : t('common.add')}
              </button>
            </form>

            <ul className="task-project-list">
              {projects.map((p) => (
                <li key={p.value} className="task-project-item">
                  <span
                    className="task-project-dot"
                    style={{ backgroundColor: p.color }}
                  />
                  <span className="task-project-name">{p.label}</span>
                  <button
                    type="button"
                    className="btn btn-small btn-ghost"
                    onClick={() => toggleArchived(p, p.archived ?? false)}
                  >
                    {p.archived ? t('tasks.projects.unarchive') : t('tasks.projects.archive')}
                  </button>
                </li>
              ))}
              {projects.length === 0 && <li className="muted">{t('tasks.projects.empty')}</li>}
            </ul>

            {error && <p className="form-error">{error}</p>}
          </div>
        </dialog>
      )}
    </>
  );
}

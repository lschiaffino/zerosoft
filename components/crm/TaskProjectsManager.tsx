'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

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
      setExpanded(false);
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
    <div className="task-projects-manager">
      <button type="button" className="btn btn-secondary btn-sm" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
        {expanded ? t('common.close') : t('tasks.projects.manage')}
      </button>

      {expanded && (
        <div className="task-projects-panel panel">
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
      )}
    </div>
  );
}

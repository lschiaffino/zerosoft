'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { Checklist } from '@/lib/people-onboarding';
import { api, Bar, useDay, useErrorText } from './people-ui';

/** Una checklist de onboarding u offboarding con sus tareas para marcar. */
export default function ChecklistView({ checklist: c, onChange, showPerson = false }: { checklist: Checklist; onChange: () => void; showPerson?: boolean }) {
  const t = useTranslations('people');
  const day = useDay();
  const errText = useErrorText();
  const [error, setError] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const toggle = async (id: string, done: boolean) => {
    setError('');
    const res = await api(`/api/people/tasks/${id}`, { method: 'PATCH', json: { done } });
    if (!res.ok) return setError(errText(res.data.error));
    onChange();
  };
  return (
    <section className="ppl-panel" data-testid="people-checklist" aria-label={c.name}>
      <div className="ppl-panel-head">
        <h2 className="ppl-panel-title">
          {showPerson ? (
            <>
              <Link href={`/app/people/${c.employeeId}?tab=onboarding`}>{c.employeeName}</Link>
              <span className="ppl-muted"> · {c.name}</span>
            </>
          ) : (
            c.name
          )}
          <span className={`badge ${c.kind === 'offboarding' ? 'badge-warn' : 'badge-info'}`}>{t(`onboarding.kinds.${c.kind}`)}</span>
        </h2>
        <span className="ppl-muted">{t('onboarding.progress', { done: c.done, total: c.total })}</span>
      </div>
      <Bar value={c.done} max={c.total} label={t('onboarding.progress', { done: c.done, total: c.total })} />
      <ul className="ppl-tasks">
        {c.tasks.map((task) => {
          const late = !task.done && task.dueDate != null && task.dueDate < today;
          return (
            <li key={task.id} className={`ppl-task${task.done ? ' is-done' : ''}`}>
              <label className="ppl-check">
                <input type="checkbox" checked={task.done} disabled={!task.canToggle} onChange={(e) => void toggle(task.id, e.target.checked)} />
                <span>
                  <span className="ppl-task-title">{task.title}</span>
                  <span className="ppl-rowmeta">
                    {t(`onboarding.assignees.${task.assignee}`)}
                    {task.assigneeName && ` (${task.assigneeName})`}
                    {task.dueDate && (
                      <span className={late ? 'ppl-warn' : undefined}>
                        {' · '}
                        {late ? t('onboarding.overdue', { date: day(task.dueDate) }) : t('onboarding.due', { date: day(task.dueDate) })}
                      </span>
                    )}
                  </span>
                  {task.description && <span className="ppl-rowmeta">{task.description}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="ppl-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

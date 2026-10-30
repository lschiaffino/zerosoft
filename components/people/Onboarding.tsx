'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { Checklist, Template, TemplateTask } from '@/lib/people-onboarding';
import { api, Dialog, Field, useErrorText, useToast } from './people-ui';
import ChecklistView from './ChecklistView';

export default function Onboarding({ checklists, templates, hr }: { checklists: Checklist[]; templates: Template[]; hr: boolean }) {
  const t = useTranslations('people');
  const router = useRouter();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const res = await api<{ template: { id: string } }>('/api/people/templates', { method: 'POST', json: { name: fd.get('name'), kind: fd.get('kind'), tasks: [] } });
    if (!res.ok) return setError(errText(res.data.error));
    setCreating(false);
    router.push(`/app/people/onboarding/templates/${res.data.template.id}`);
  };
  const open = checklists.filter((c) => c.done < c.total);
  const finished = checklists.filter((c) => c.done === c.total);
  return (
    <div className="app-page ui-page ppl-page">
      {toast}
      <PageHeader
        title={t('nav.onboarding')}
        description={t('onboarding.desc')}
        actions={
          hr ? (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              {t('onboarding.newTemplate')}
            </button>
          ) : undefined
        }
      />
      <h2 className="ppl-subtitle">{t('onboarding.inProgress')}</h2>
      {open.length === 0 ? (
        <EmptyState compact quiet body={t('onboarding.noneOpen')} />
      ) : (
        <div className="ppl-stack">
          {open.map((c) => (
            <ChecklistView
              key={c.id}
              checklist={c}
              showPerson
              onChange={() => {
                push(t('common.saved'));
                router.refresh();
              }}
            />
          ))}
        </div>
      )}
      {finished.length > 0 && (
        <details className="ppl-details">
          <summary>{t('onboarding.finished', { count: finished.length })}</summary>
          <ul className="ppl-list">
            {finished.map((c) => (
              <li key={c.id}>
                <Link href={`/app/people/${c.employeeId}?tab=onboarding`}>{c.employeeName}</Link>
                <span className="ppl-muted"> · {c.name}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {hr && (
        <>
          <h2 className="ppl-subtitle">{t('onboarding.templates')}</h2>
          {templates.length === 0 ? (
            <EmptyState compact quiet body={t('onboarding.noTemplates')} />
          ) : (
            <div className="table-wrap">
              <table className="table ppl-table" data-testid="people-templates">
                <thead>
                  <tr>
                    <th scope="col">{t('fields.name')}</th>
                    <th scope="col">{t('onboarding.kind')}</th>
                    <th scope="col" className="num">
                      {t('onboarding.tasks')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((tp) => (
                    <tr key={tp.id}>
                      <th scope="row">
                        <Link href={`/app/people/onboarding/templates/${tp.id}`} className="ppl-rowtitle">
                          {tp.name}
                        </Link>
                      </th>
                      <td>{t(`onboarding.kinds.${tp.kind}`)}</td>
                      <td className="num">{tp.tasks.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <Dialog open={creating} title={t('onboarding.newTemplate')} onClose={() => setCreating(false)}>
        <form onSubmit={create}>
          <div className="ui-modal-body ui-fields">
            <Field label={t('fields.name')} htmlFor="tpl-name">
              <input id="tpl-name" name="name" className="input" required maxLength={120} autoFocus />
            </Field>
            <Field label={t('onboarding.kind')} htmlFor="tpl-kind">
              <select id="tpl-kind" name="kind" className="select" defaultValue="onboarding">
                <option value="onboarding">{t('onboarding.kinds.onboarding')}</option>
                <option value="offboarding">{t('onboarding.kinds.offboarding')}</option>
              </select>
            </Field>
            {error && (
              <p className="ppl-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('common.create')}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

const ASSIGNEES = ['new_hire', 'manager', 'it', 'hr'] as const;

/** Editor de plantilla: nombre y tareas (quién, cuándo respecto del ingreso o la salida). */
export function TemplateEditor({ template }: { template: Template }) {
  const t = useTranslations('people');
  const router = useRouter();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [name, setName] = useState(template.name);
  const [tasks, setTasks] = useState<TemplateTask[]>(template.tasks);
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const set = (i: number, patch: Partial<TemplateTask>) => {
    setTasks((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    setDirty(true);
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const res = await api(`/api/people/templates/${template.id}`, { method: 'PATCH', json: { name, tasks } });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setDirty(false);
    push(t('common.saved'));
    router.refresh();
  };
  const remove = async () => {
    const res = await api(`/api/people/templates/${template.id}`, { method: 'DELETE' });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.push('/app/people/onboarding');
    router.refresh();
  };
  const anchor = template.kind === 'offboarding' ? t('onboarding.relativeEnd') : t('onboarding.relativeStart');
  return (
    <div className="app-page ui-page ppl-page">
      {toast}
      <PageHeader
        back={{ href: '/app/people/onboarding', label: t('nav.onboarding') }}
        title={name || template.name}
        description={t(`onboarding.kinds.${template.kind}`)}
        actions={
          <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}>
            {t('common.delete')}
          </button>
        }
      />
      <form className="ppl-stack" onSubmit={save}>
        <Field label={t('fields.name')} htmlFor="te-name">
          <input
            id="te-name"
            className="input"
            value={name}
            required
            maxLength={120}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
          />
        </Field>
        <h2 className="ppl-subtitle">{t('onboarding.tasks')}</h2>
        {tasks.length === 0 && <EmptyState compact quiet body={t('onboarding.noTasks')} />}
        <ol className="ppl-task-edit">
          {tasks.map((task, i) => (
            <li key={i} className="ppl-panel">
              <div className="ui-fields-2 ppl-fields">
                <Field label={t('onboarding.taskTitle')} htmlFor={`tt-${i}`}>
                  <input id={`tt-${i}`} className="input" value={task.title} required maxLength={200} onChange={(e) => set(i, { title: e.target.value })} />
                </Field>
                <Field label={t('onboarding.assignee')} htmlFor={`ta-${i}`}>
                  <select id={`ta-${i}`} className="select" value={task.assignee} onChange={(e) => set(i, { assignee: e.target.value as TemplateTask['assignee'] })}>
                    {ASSIGNEES.map((a) => (
                      <option key={a} value={a}>
                        {t(`onboarding.assignees.${a}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('onboarding.offset', { anchor })} htmlFor={`to-${i}`} hint={t('onboarding.offsetHint')}>
                  <input id={`to-${i}`} className="input" type="number" min={-365} max={365} value={task.offsetDays} onChange={(e) => set(i, { offsetDays: Number(e.target.value) || 0 })} />
                </Field>
                <Field label={t('onboarding.taskDescription')} htmlFor={`td-${i}`}>
                  <input id={`td-${i}`} className="input" value={task.description} maxLength={1000} onChange={(e) => set(i, { description: e.target.value })} />
                </Field>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setTasks((xs) => xs.filter((_, j) => j !== i));
                  setDirty(true);
                }}
              >
                {t('onboarding.removeTask')}
              </button>
            </li>
          ))}
        </ol>
        <div className="ppl-panel-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setTasks((xs) => [...xs, { title: '', description: '', assignee: 'hr', offsetDays: 0 }]);
              setDirty(true);
            }}
          >
            {t('onboarding.addTask')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!dirty}>
            {t('common.save')}
          </button>
        </div>
      </form>
      <Dialog open={confirm} title={t('onboarding.deleteTemplate')} onClose={() => setConfirm(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void remove();
          }}
        >
          <div className="ui-modal-body">
            <p>{t('onboarding.deleteBody', { name: template.name })}</p>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setConfirm(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary btn-danger" autoFocus>
              {t('common.delete')}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

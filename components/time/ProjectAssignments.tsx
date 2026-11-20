'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ProjectDto, TaskDto } from '@/lib/time/core';
import type { ProjectTask } from '@/lib/time/types';
import { api, useErrorText } from './ui';

export interface TeamPerson {
  id: string;
  name: string | null;
  email: string;
}

type Push = (text: string, tone?: 'ok' | 'bad') => void;

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Quién carga horas en el proyecto: todas las personas con Time o solo las elegidas. */
function TeamCard({ project, people, me, onSaved, push }: { project: ProjectDto; people: TeamPerson[]; me: string; onSaved: (p: ProjectDto) => void; push: Push }) {
  const t = useTranslations('time.assign');
  const errorText = useErrorText();
  const [everyone, setEveryone] = useState(project.everyone);
  // Al pasar a "solo estas personas" arranca con quien lo está editando.
  const [chosen, setChosen] = useState<string[]>(project.everyone ? [me] : project.people);
  const [busy, setBusy] = useState(false);
  const known = useMemo(() => new Set(people.map((p) => p.id)), [people]);
  const picked = chosen.filter((id) => known.has(id));
  const dirty = everyone !== project.everyone || (!everyone && !sameSet(picked, project.people));
  const toggle = (id: string, on: boolean) => setChosen((cur) => (on ? [...cur.filter((x) => x !== id), id] : cur.filter((x) => x !== id)));

  const save = async () => {
    setBusy(true);
    const r = await api<{ project: ProjectDto }>(`/api/time/projects/${project.id}`, { method: 'PATCH', json: everyone ? { everyone: true } : { everyone: false, people: picked } });
    setBusy(false);
    if (!r.ok) return push(errorText(r.data.error), 'bad');
    onSaved(r.data.project);
    push(t('teamSaved'));
  };

  return (
    <section className="tm-card tm-assign" aria-labelledby="tm-team-title" data-testid="time-team-card">
      <h2 className="tm-card-title" id="tm-team-title">
        {t('team')}
      </h2>
      <fieldset className="tm-choice">
        <legend className="sr-only">{t('team')}</legend>
        <label className="ui-check">
          <input type="radio" name="tm-team" checked={everyone} onChange={() => setEveryone(true)} data-testid="time-team-everyone" />
          <span>
            {t('everyone')}
            <span className="ui-help tm-block">{t('everyoneHint')}</span>
          </span>
        </label>
        <label className="ui-check">
          <input type="radio" name="tm-team" checked={!everyone} onChange={() => setEveryone(false)} data-testid="time-team-only" />
          <span>
            {t('onlyPeople')}
            <span className="ui-help tm-block">{t('onlyPeopleHint')}</span>
          </span>
        </label>
      </fieldset>
      {!everyone && (
        <ul className="tm-list tm-assign-list" aria-label={t('team')}>
          {people.map((p) => (
            <li key={p.id} className="tm-list-row">
              <label className="ui-check tm-assign-name">
                <input type="checkbox" checked={picked.includes(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} data-testid="time-team-person" data-person={p.id} />
                <span>
                  {p.name || p.email}
                  {p.name && <span className="tm-muted tm-small tm-block">{p.email}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {!everyone && picked.length === 0 && (
        <p className="ui-help" role="status">
          {t('pickOnePerson')}
        </p>
      )}
      <div className="tm-actions">
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !dirty || (!everyone && picked.length === 0)} onClick={() => void save()} data-testid="time-team-save">
          {t('save')}
        </button>
      </div>
    </section>
  );
}

/** Con qué tareas se cargan horas en el proyecto, y cuáles son facturables en él. */
function TasksCard({ project, tasks, onSaved, push }: { project: ProjectDto; tasks: TaskDto[]; onSaved: (p: ProjectDto) => void; push: Push }) {
  const t = useTranslations('time.assign');
  const errorText = useErrorText();
  const active = useMemo(() => tasks.filter((x) => !x.archived), [tasks]);
  const [allTasks, setAllTasks] = useState(project.allTasks);
  // Al pasar a "solo estas tareas" arranca con todas, con su facturable de siempre.
  const [chosen, setChosen] = useState<ProjectTask[]>(project.allTasks ? active.map((x) => ({ taskId: x.id, billable: x.billable })) : project.tasks);
  const [busy, setBusy] = useState(false);
  const picked = chosen.filter((c) => active.some((x) => x.id === c.taskId));
  const key = (list: ProjectTask[]) =>
    list
      .map((c) => `${c.taskId}:${c.billable ? 1 : 0}`)
      .sort()
      .join(',');
  const dirty = allTasks !== project.allTasks || (!allTasks && key(picked) !== key(project.tasks));
  const find = (id: string) => picked.find((c) => c.taskId === id);
  const toggle = (task: TaskDto, on: boolean) => setChosen((cur) => (on ? [...cur.filter((c) => c.taskId !== task.id), { taskId: task.id, billable: task.billable }] : cur.filter((c) => c.taskId !== task.id)));
  const setBillable = (id: string, billable: boolean) => setChosen((cur) => cur.map((c) => (c.taskId === id ? { ...c, billable } : c)));

  const save = async () => {
    setBusy(true);
    const r = await api<{ project: ProjectDto }>(`/api/time/projects/${project.id}`, { method: 'PATCH', json: allTasks ? { allTasks: true } : { allTasks: false, tasks: picked } });
    setBusy(false);
    if (!r.ok) return push(errorText(r.data.error), 'bad');
    onSaved(r.data.project);
    push(t('tasksSaved'));
  };

  return (
    <section className="tm-card tm-assign" aria-labelledby="tm-tasks-title" data-testid="time-tasks-card">
      <h2 className="tm-card-title" id="tm-tasks-title">
        {t('tasks')}
      </h2>
      <fieldset className="tm-choice">
        <legend className="sr-only">{t('tasks')}</legend>
        <label className="ui-check">
          <input type="radio" name="tm-tasks" checked={allTasks} onChange={() => setAllTasks(true)} data-testid="time-tasks-all" />
          <span>
            {t('allTasks')}
            <span className="ui-help tm-block">{t('allTasksHint')}</span>
          </span>
        </label>
        <label className="ui-check">
          <input type="radio" name="tm-tasks" checked={!allTasks} onChange={() => setAllTasks(false)} data-testid="time-tasks-only" />
          <span>
            {t('onlyTasks')}
            <span className="ui-help tm-block">{t('onlyTasksHint')}</span>
          </span>
        </label>
      </fieldset>
      {!allTasks && (
        <ul className="tm-list tm-assign-list" aria-label={t('tasks')}>
          {active.map((x) => {
            const c = find(x.id);
            return (
              <li key={x.id} className="tm-list-row">
                <label className="ui-check tm-assign-name">
                  <input type="checkbox" checked={Boolean(c)} onChange={(e) => toggle(x, e.target.checked)} data-testid="time-tasks-task" data-task={x.id} />
                  <span>{x.name}</span>
                </label>
                <label className="ui-check tm-small">
                  <input type="checkbox" checked={c?.billable ?? false} disabled={!c} onChange={(e) => setBillable(x.id, e.target.checked)} data-testid="time-tasks-billable" data-task={x.id} />
                  <span>{t('billable')}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {!allTasks && picked.length === 0 && (
        <p className="ui-help" role="status">
          {t('pickOneTask')}
        </p>
      )}
      <div className="tm-actions">
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !dirty || (!allTasks && picked.length === 0)} onClick={() => void save()} data-testid="time-tasks-save">
          {t('save')}
        </button>
      </div>
    </section>
  );
}

/** Equipo y tareas del proyecto (solo quien administra). */
export default function ProjectAssignments(props: { project: ProjectDto; people: TeamPerson[]; tasks: TaskDto[]; me: string; onSaved: (p: ProjectDto) => void; push: Push }) {
  return (
    <div className="tm-grid tm-assign-grid">
      <TeamCard key={`team-${props.project.updatedAt}`} project={props.project} people={props.people} me={props.me} onSaved={props.onSaved} push={props.push} />
      <TasksCard key={`tasks-${props.project.updatedAt}`} project={props.project} tasks={props.tasks} onSaved={props.onSaved} push={props.push} />
    </div>
  );
}

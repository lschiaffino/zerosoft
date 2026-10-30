'use client';

import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { ChecklistTask } from '@/lib/people-onboarding';
import type { PeopleDocument } from '@/lib/people-docs';
import { api, Avatar, useDay, useErrorText, useToast } from './people-ui';
import { DocumentList } from './ProfileSections';

export interface WelcomeProps {
  name: string;
  workspace: string;
  welcome: string;
  startDate: string | null;
  manager: { id: string; name: string; jobTitle: string; photo: string } | null;
  team: Array<{ id: string; name: string; jobTitle: string; photo: string }>;
  tasks: Array<ChecklistTask & { employeeId: string; employeeName: string }>;
  documents: PeopleDocument[];
  handbookPageId: string | null;
  hasProfile: boolean;
}

/** La página de bienvenida de quien entra: mensaje de HR, su manager, su equipo, sus primeras tareas y lo que tiene que leer. */
export default function Welcome(p: WelcomeProps) {
  const t = useTranslations('people');
  const router = useRouter();
  const day = useDay();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const toggle = async (id: string) => {
    const res = await api(`/api/people/tasks/${id}`, { method: 'PATCH', json: { done: true } });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.refresh();
  };
  return (
    <div className="app-page ui-page ppl-page ppl-welcome">
      {toast}
      <PageHeader title={t('welcome.title', { name: p.name.split(' ')[0] || p.name })} description={t('welcome.desc', { workspace: p.workspace })} />
      {p.welcome ? <p className="ppl-pre ppl-welcome-text">{p.welcome}</p> : <p className="ppl-hint">{t('welcome.noMessage')}</p>}
      {!p.hasProfile && <EmptyState compact body={t('welcome.noProfile')} />}
      <div className="ppl-grid">
        <section className="ppl-panel">
          <h2 className="ppl-panel-title">{t('welcome.yourTeam')}</h2>
          {p.startDate && <p>{t('welcome.start', { date: day(p.startDate) })}</p>}
          {p.manager ? (
            <Link href={`/app/people/${p.manager.id}`} className="ppl-rowlink">
              <Avatar name={p.manager.name} photo={p.manager.photo} size={40} />
              <span className="ppl-rowtext">
                <span className="ppl-rowtitle">{p.manager.name}</span>
                <span className="ppl-rowmeta">{t('welcome.yourManager')}</span>
              </span>
            </Link>
          ) : (
            <p className="ppl-muted">{t('welcome.noManager')}</p>
          )}
          {p.team.length > 0 && (
            <ul className="ppl-list">
              {p.team.map((m) => (
                <li key={m.id}>
                  <Link href={`/app/people/${m.id}`}>{m.name}</Link>
                  {m.jobTitle && <span className="ppl-muted"> · {m.jobTitle}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="ppl-panel">
          <h2 className="ppl-panel-title">{t('welcome.firstTasks')}</h2>
          {p.tasks.length === 0 ? (
            <EmptyState compact quiet body={t('welcome.noTasks')} />
          ) : (
            <ul className="ppl-tasks">
              {p.tasks.map((task) => (
                <li key={task.id} className="ppl-task">
                  <label className="ppl-check">
                    <input type="checkbox" onChange={() => void toggle(task.id)} />
                    <span>
                      <span className="ppl-task-title">{task.title}</span>
                      <span className="ppl-rowmeta">
                        {task.employeeName}
                        {task.dueDate && ` · ${t('onboarding.due', { date: day(task.dueDate) })}`}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <section className="ppl-panel">
        <h2 className="ppl-panel-title">{t('welcome.toRead')}</h2>
        {p.handbookPageId && (
          <p>
            <Link href={`/app/docs/${p.handbookPageId}`}>{t('settings.openHandbook')}</Link>
          </p>
        )}
        <DocumentList
          docs={p.documents}
          hr={false}
          onChange={(m, tone) => {
            push(m, tone);
            router.refresh();
          }}
        />
      </section>
      <p>
        <Link href="/app/people/time-off" className="btn btn-secondary">
          {t('welcome.timeOff')}
        </Link>
      </p>
    </div>
  );
}

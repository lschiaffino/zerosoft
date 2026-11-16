import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { userCanUseApp } from '@/lib/workspace';
import { timeActorOf } from '@/lib/time/http';
import { ensureDefaultTasks, getCurrency, getProject, listClients, listProjects, listTasks, reportEntries } from '@/lib/time/core';
import { summarize } from '@/lib/time/types';
import Timesheet from '@/components/time/Timesheet';
import ProjectsList from '@/components/time/ProjectsList';
import ProjectDetail from '@/components/time/ProjectDetail';
import Reports from '@/components/time/Reports';
import TimeSettings from '@/components/time/TimeSettings';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; zs?: string[] }>; searchParams: Promise<Record<string, string | undefined>> };

const TITLES: Record<string, string> = { projects: 'nav.projects', reports: 'nav.reports', settings: 'nav.settings' };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, zs = [] } = await props.params;
  const t = await getTranslations({ locale, namespace: 'time' });
  return { title: `${t(TITLES[zs[0] ?? ''] ?? 'nav.timesheet')} · Time` };
}

/**
 * Time en una sola ruta (presupuesto de rutas): /app/time (?date, ?view=week, ?new=1),
 * /app/time/projects (?new=1), /app/time/projects/<id>, /app/time/reports
 * (?projectId) y /app/time/settings.
 */
export default async function TimePage(props: Props) {
  const { locale, zs = [] } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  if (!userCanUseApp(user, 'time') || user.role === 'guest') notFound();
  const actor = timeActorOf(user);
  const [section, id] = zs;
  await ensureDefaultTasks(actor.ws, locale);

  switch (section) {
    case undefined: {
      const [projects, tasks] = await Promise.all([listProjects(actor), listTasks(actor)]);
      return <Timesheet projects={projects} tasks={tasks} admin={actor.admin} initialDate={sp.date ?? null} initialView={sp.view === 'week' ? 'week' : 'day'} openNew={sp.new === '1'} />;
    }
    case 'projects': {
      const [clients, currency] = await Promise.all([listClients(actor), getCurrency(actor.ws)]);
      if (!id) return <ProjectsList projects={await listProjects(actor)} clients={clients} admin={actor.admin} currency={currency} openNew={sp.new === '1'} />;
      const project = await getProject(actor, id);
      if (!project) notFound();
      // Todas las horas del proyecto (un miembro, solo las suyas).
      const entries = await reportEntries(actor, { from: '2000-01-01', to: '2999-12-31', projectId: id });
      const byTask = summarize(entries, 'task');
      const byPerson = actor.admin ? summarize(entries, 'person').rows : [];
      return <ProjectDetail project={project} clients={clients} admin={actor.admin} currency={currency} totals={byTask.totals} byTask={byTask.rows} byPerson={byPerson} />;
    }
    case 'reports':
      return <Reports admin={actor.admin} projects={await listProjects(actor)} initialProjectId={sp.projectId ?? null} />;
    case 'settings': {
      const [tasks, clients, currency] = await Promise.all([listTasks(actor), listClients(actor), getCurrency(actor.ws)]);
      return <TimeSettings tasks={tasks} clients={clients} currency={currency} admin={actor.admin} />;
    }
    default:
      notFound();
  }
}

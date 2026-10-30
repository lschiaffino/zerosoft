import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { userCanUseApp } from '@/lib/workspace';
import { actorOf } from '@/lib/hiring/http';
import { appBase, canCreateJobs, ensureSettings, getJob, hiringPeople, listJobs, settingsDto } from '@/lib/hiring/core';
import { getCandidateProfile, listApplications, visibleTags } from '@/lib/hiring/candidates';
import { myPendingEvaluations } from '@/lib/hiring/evaluation';
import { listTemplates, repliesEnabled } from '@/lib/hiring/comms';
import { hiringReport } from '@/lib/hiring/reports';
import { jobTemplates } from '@/lib/hiring/builtin';
import HiringOverview from '@/components/hiring/HiringOverview';
import JobsList from '@/components/hiring/JobsList';
import JobNew from '@/components/hiring/JobNew';
import JobEditor from '@/components/hiring/JobEditor';
import JobPipeline from '@/components/hiring/JobPipeline';
import CandidatesList from '@/components/hiring/CandidatesList';
import CandidateProfile from '@/components/hiring/CandidateProfile';
import HiringReports from '@/components/hiring/HiringReports';
import HiringTemplates from '@/components/hiring/HiringTemplates';
import HiringSettings from '@/components/hiring/HiringSettings';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; zs?: string[] }>; searchParams: Promise<Record<string, string | undefined>> };

const SECTIONS = ['jobs', 'candidates', 'reports', 'templates', 'settings'] as const;

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, zs = [] } = await props.params;
  const t = await getTranslations({ locale, namespace: 'hiring' });
  const section = (SECTIONS as readonly string[]).includes(zs[0] ?? '') ? zs[0] : null;
  return { title: section ? `${t(`nav.${section}`)} · Hiring` : t('meta.title') };
}

/**
 * Hiring en una sola ruta (presupuesto de rutas): /app/hiring, /jobs,
 * /jobs/new, /jobs/<id> (pipeline), /jobs/<id>/edit, /candidates,
 * /candidates/<id>, /reports, /templates y /settings.
 */
export default async function HiringPage(props: Props) {
  const { locale, zs = [] } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  if (!userCanUseApp(user, 'hiring') || user.role === 'guest') notFound();
  const actor = actorOf(user);
  const settings = await ensureSettings(actor.ws, locale);
  const [section, id, sub] = zs;
  if (zs.length > 3) notFound();
  const careersUrl = `${appBase()}/careers/${settings.handle}`;

  if (!section) {
    if (sp.new === '1') redirect(`/${locale}/app/hiring/jobs/new`);
    const [jobs, pending, recent] = await Promise.all([listJobs(actor, { status: 'published' }), myPendingEvaluations(actor), listApplications(actor, { status: 'active', limit: 8 })]);
    return <HiringOverview jobs={jobs} pending={pending} recent={recent} careersUrl={careersUrl} published={settings.published === 1} canCreate={canCreateJobs(actor, settings)} />;
  }

  switch (section) {
    case 'jobs': {
      if (!id) {
        const status = ['draft', 'published', 'closed', 'archived', 'all'].includes(sp.status ?? '') ? sp.status : undefined;
        return <JobsList initial={await listJobs(actor, { status, q: sp.q })} q={sp.q ?? ''} status={status ?? ''} canCreate={canCreateJobs(actor, settings)} />;
      }
      if (id === 'new') {
        if (sub || !canCreateJobs(actor, settings)) notFound();
        const saved = await listTemplates(actor, 'job');
        return <JobNew builtin={jobTemplates(settings.locale)} saved={saved.map((s) => ({ id: s.id, name: s.name }))} />;
      }
      const detail = await getJob(actor, id);
      if (!detail) notFound();
      if (sub === 'edit') {
        if (!detail.canManage) notFound();
        return <JobEditor detail={detail} people={await hiringPeople(actor.ws)} careersUrl={careersUrl} tab={sp.tab ?? 'details'} />;
      }
      if (sub) notFound();
      const apps = detail.canManage ? await listApplications(actor, { jobId: id, status: sp.status ?? 'active' }) : [];
      return <JobPipeline detail={detail} initial={apps} view={sp.view === 'list' ? 'list' : 'board'} status={sp.status ?? 'active'} careersUrl={careersUrl} />;
    }
    case 'candidates': {
      if (!id) {
        const [apps, jobs, tags, templates] = await Promise.all([
          listApplications(actor, { q: sp.q, jobId: sp.job, status: sp.status ?? 'active', source: sp.source, tag: sp.tag, knockedOut: sp.knockout === '1' }),
          listJobs(actor, { status: 'all' }),
          visibleTags(actor),
          listTemplates(actor, 'rejection'),
        ]);
        return (
          <CandidatesList
            initial={apps}
            jobs={jobs.filter((j) => j.canManage).map((j) => ({ id: j.id, title: j.title }))}
            tags={tags}
            templates={templates.map((t) => ({ id: t.id, name: t.name }))}
            filters={{ q: sp.q ?? '', job: sp.job ?? '', status: sp.status ?? 'active', source: sp.source ?? '', tag: sp.tag ?? '', knockout: sp.knockout === '1' }}
          />
        );
      }
      if (sub) notFound();
      const profile = await getCandidateProfile(actor, id);
      if (!profile) notFound();
      const templates = await listTemplates(actor);
      return (
        <CandidateProfile
          initial={profile}
          focusApp={sp.app ?? null}
          me={actor.person}
          isAdmin={actor.admin}
          templates={templates.filter((t) => t.kind !== 'job').map((t) => ({ id: t.id, jobId: t.jobId, kind: t.kind, name: t.name, subject: t.subject, body: t.body }))}
          repliesEnabled={repliesEnabled()}
          signEnabled={userCanUseApp(user, 'sign')}
        />
      );
    }
    case 'reports': {
      if (id) notFound();
      const t = await getTranslations({ locale, namespace: 'hiring' });
      const kindLabels = Object.fromEntries((['applied', 'review', 'interview', 'offer', 'hired'] as const).map((k) => [k, t(`stageKinds.${k}`)]));
      const jobs = await listJobs(actor, { status: 'all' });
      return (
        <HiringReports
          report={await hiringReport(actor, { days: Number(sp.days ?? 90), jobId: sp.job || null, kindLabels })}
          jobs={jobs.filter((j) => j.canManage).map((j) => ({ id: j.id, title: j.title }))}
        />
      );
    }
    case 'templates': {
      if (id) notFound();
      const jobs = await listJobs(actor, { status: 'all' });
      return <HiringTemplates initial={await listTemplates(actor)} canAdmin={actor.admin} jobs={jobs.filter((j) => j.canManage).map((j) => ({ id: j.id, title: j.title }))} />;
    }
    case 'settings': {
      if (id) notFound();
      return <HiringSettings initial={settingsDto(settings)} canAdmin={actor.admin} careersUrl={careersUrl} repliesEnabled={repliesEnabled()} />;
    }
    default:
      notFound();
  }
}

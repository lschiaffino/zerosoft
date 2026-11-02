import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { userCanUseApp } from '@/lib/workspace';
import { sessionCtx } from '@/lib/people-http';
import PeopleSync from '@/components/people/PeopleSync';
import type { PeopleCtx } from '@/lib/people';
import type { SessionUser } from '@/lib/session';
import {
  directoryFacets,
  employeeIdForUser,
  getEmployee,
  getEmployeeRow,
  getSettings,
  listAudit,
  listEmployees,
  listFields,
  orgChart,
  peopleReport,
  photoUrl,
  workspacePeople,
} from '@/lib/people';
import { balancesUnchecked, listCustomHolidays, listPolicies, listRequests } from '@/lib/people-timeoff';
import { getTemplate, listChecklists, listTemplates, myOpenTasks } from '@/lib/people-onboarding';
import { getCycle, listCycles, listReviews } from '@/lib/people-perf';
import { pendingAcks } from '@/lib/people-docs';
import { HOLIDAY_COUNTRIES, seededHolidays } from '@/lib/people-time';
import EmptyState from '@/components/ui/EmptyState';
import Directory from '@/components/people/Directory';
import Profile from '@/components/people/Profile';
import OrgChart from '@/components/people/OrgChart';
import TimeOff from '@/components/people/TimeOff';
import Onboarding, { TemplateEditor } from '@/components/people/Onboarding';
import Reviews, { CycleDetail } from '@/components/people/Reviews';
import Reports from '@/components/people/Reports';
import PeopleSettings from '@/components/people/PeopleSettings';
import Welcome from '@/components/people/Welcome';
import PeopleHome, { type PeopleInbox } from '@/components/people/PeopleHome';
import Surveys from '@/components/people/Surveys';
import CustomReports from '@/components/people/CustomReports';
import { celebrations, countChangeRequests, listSavedReports, listSurveys } from '@/lib/people-extras';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; zs?: string[] }>; searchParams: Promise<Record<string, string | undefined>> };

const SECTIONS: Record<string, string> = {
  org: 'org',
  'time-off': 'timeOff',
  onboarding: 'onboarding',
  reviews: 'reviews',
  reports: 'reports',
  settings: 'settings',
  welcome: 'welcome',
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, zs = [] } = await props.params;
  const t = await getTranslations({ locale, namespace: 'people' });
  const key = SECTIONS[zs[0] ?? ''];
  return { title: key ? `${t(`nav.${key}`)} · People` : t('meta.title') };
}

/**
 * People en una sola ruta (presupuesto de rutas): /app/people (directorio),
 * /<ficha>, /org, /time-off, /onboarding, /onboarding/templates/<id>,
 * /reviews, /reviews/<ciclo>, /reports, /settings, /welcome y /me.
 */
export default async function PeoplePage(props: Props) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const ctx = await sessionCtx(user);
  const view = await peopleView(props, user, ctx);
  return (
    <>
      {ctx.needsSync && <PeopleSync />}
      {view}
    </>
  );
}

/** Lo que espera a esta persona (arriba del directorio). Solo cuenta: cada lista aplica sus permisos. */
async function homeInbox(ctx: PeopleCtx): Promise<PeopleInbox> {
  const [approvals, tasks, reviews, documents, surveys, changes] = await Promise.all([
    listRequests(ctx, { scope: 'approvals' }),
    myOpenTasks(ctx),
    listReviews(ctx, { mineToWrite: true }),
    pendingAcks(ctx),
    listSurveys(ctx),
    ctx.viewer.hr ? countChangeRequests(ctx) : Promise.resolve(0),
  ]);
  return { approvals: approvals.length, tasks: tasks.length, reviews: reviews.length, documents: documents.length, surveys: surveys.filter((s) => s.status === 'open' && !s.answered).length, changes };
}

async function peopleView(props: Props, user: SessionUser, ctx: PeopleCtx) {
  const { locale, zs = [] } = await props.params;
  const sp = await props.searchParams;
  const t = await getTranslations({ locale, namespace: 'people' });
  const [section, id, sub] = zs;
  if (zs.length > 3) notFound();
  const hrOnly = () => <EmptyState product="people" title={t('common.hrOnlyTitle')} body={t('common.hrOnlyBody')} />;

  if (!section) {
    const filters = { q: sp.q ?? '', department: sp.department ?? '', location: sp.location ?? '', type: sp.type ?? '', status: ctx.viewer.hr ? (sp.status ?? '') : '' };
    const [employees, facets, templates, inbox, coming] = await Promise.all([listEmployees(ctx, filters), directoryFacets(ctx), ctx.viewer.hr ? listTemplates(ctx.ws, 'onboarding') : Promise.resolve([]), homeInbox(ctx), celebrations(ctx)]);
    return (
      <Directory
        employees={employees}
        facets={facets}
        hr={ctx.viewer.hr}
        templates={templates.map((x) => ({ id: x.id, name: x.name }))}
        filters={filters}
        openNew={sp.new === '1'}
        home={Object.values(filters).some(Boolean) ? null : <PeopleHome inbox={inbox} celebrations={coming} />}
      />
    );
  }

  switch (section) {
    case 'me': {
      if (ctx.viewer.employeeId) redirect(`/${locale}/app/people/${ctx.viewer.employeeId}`);
      redirect(`/${locale}/app/people`);
    }
    case 'u': {
      // Desde Ajustes › Miembros: la ficha de una persona del workspace por su user id.
      if (!id || sub) notFound();
      const empId = await employeeIdForUser(ctx.ws, id);
      if (!empId) notFound();
      redirect(`/${locale}/app/people/${empId}`);
    }
    case 'org': {
      if (id) notFound();
      return <OrgChart nodes={await orgChart(ctx)} />;
    }
    case 'time-off': {
      if (id) notFound();
      const me = ctx.viewer.employeeId;
      const meRow = me ? await getEmployeeRow(ctx.ws, me) : null;
      const [balances, mine, approvals] = await Promise.all([
        me ? balancesUnchecked(ctx.ws, me) : Promise.resolve([]),
        me ? listRequests(ctx, { employeeId: me, scope: 'mine' }) : Promise.resolve([]),
        listRequests(ctx, { scope: 'approvals' }),
      ]);
      return (
        <TimeOff
          hr={ctx.viewer.hr}
          isManager={ctx.viewer.reports.size > 0}
          hasProfile={Boolean(me)}
          balances={balances}
          mine={mine}
          approvals={approvals}
          tab={sp.tab ?? ''}
          openNew={sp.new === '1'}
          country={meRow?.country ?? ''}
        />
      );
    }
    case 'onboarding': {
      if (id === 'templates' && sub) {
        if (!ctx.viewer.hr) return hrOnly();
        const template = await getTemplate(ctx.ws, sub);
        if (!template) notFound();
        return <TemplateEditor template={template} />;
      }
      if (id) notFound();
      const [checklists, templates] = await Promise.all([listChecklists(ctx), ctx.viewer.hr ? listTemplates(ctx.ws) : Promise.resolve([])]);
      return <Onboarding checklists={checklists} templates={templates} hr={ctx.viewer.hr} />;
    }
    case 'reviews': {
      if (sub) notFound();
      if (id) {
        const cycle = await getCycle(ctx, id);
        if (!cycle) notFound();
        const canPick = ctx.viewer.hr || ctx.viewer.reports.size > 0;
        const picks = canPick ? await listEmployees(ctx) : [];
        return <CycleDetail cycle={cycle} reviews={await listReviews(ctx, { cycleId: id })} hr={ctx.viewer.hr} focus={sp.review ?? null} reports={[...ctx.viewer.reports]} people={picks.map((p) => ({ id: p.id, name: p.name }))} />;
      }
      const [cycles, toWrite, surveys] = await Promise.all([listCycles(ctx), listReviews(ctx, { mineToWrite: true }), listSurveys(ctx)]);
      return (
        <>
          <Reviews cycles={cycles} toWrite={toWrite} hr={ctx.viewer.hr} />
          <div className="app-page ui-page ppl-page ppl-page-tail">
            <Surveys surveys={surveys} hr={ctx.viewer.hr} />
          </div>
        </>
      );
    }
    case 'reports': {
      if (id) notFound();
      if (!ctx.viewer.hr) return hrOnly();
      const [report, audit, saved, fields, facets] = await Promise.all([peopleReport(ctx), listAudit(ctx, 100), listSavedReports(ctx), listFields(ctx.ws), directoryFacets(ctx)]);
      return <Reports report={report} audit={audit} canExport={ctx.viewer.comp === true} custom={<CustomReports saved={saved} customFields={fields.map((f) => ({ id: f.id, label: f.label, sensitive: f.sensitive }))} departments={facets.departments} locations={facets.locations} openId={sp.report ?? null} />} />;
    }
    case 'settings': {
      if (id) notFound();
      if (!ctx.viewer.hr) return hrOnly();
      const year = new Date().getUTCFullYear();
      const [settings, policies, fields, holidays, members, changes] = await Promise.all([
        getSettings(ctx.ws),
        listPolicies(ctx.ws, { includeArchived: true }),
        listFields(ctx.ws),
        listCustomHolidays(ctx.ws),
        workspacePeople(ctx.ws),
        countChangeRequests(ctx),
      ]);
      const seeded = Object.fromEntries(HOLIDAY_COUNTRIES.map((c) => [c, [...seededHolidays(c, year), ...seededHolidays(c, year + 1)].map((h) => ({ date: h.date, name: h.name }))]));
      return (
        <PeopleSettings
          settings={settings}
          policies={policies}
          fields={fields}
          holidays={holidays}
          seeded={seeded}
          members={members.map((m) => ({ id: m.id, name: m.name ?? '', email: m.email, role: m.role }))}
          wsAdmin={ctx.wsAdmin}
          isOwner={ctx.viewer.wsOwner === true}
          tab={sp.tab ?? ''}
          changesCount={changes}
        />
      );
    }
    case 'welcome': {
      if (id) notFound();
      const me = ctx.viewer.employeeId;
      const row = me ? await getEmployeeRow(ctx.ws, me) : null;
      const [settings, mgr, tasks, documents] = await Promise.all([
        getSettings(ctx.ws),
        row?.manager_id ? getEmployeeRow(ctx.ws, row.manager_id) : Promise.resolve(null),
        myOpenTasks(ctx),
        pendingAcks(ctx),
      ]);
      const team = row?.manager_id ? (await orgChart(ctx)).filter((n) => n.managerId === row.manager_id && n.id !== me).slice(0, 8) : [];
      const person = user.actingUser ?? user;
      return (
        <Welcome
          name={row?.name ?? person.name ?? person.email}
          workspace={user.workspace?.name ?? ''}
          welcome={settings.welcome}
          startDate={row?.start_date ?? null}
          manager={mgr ? { id: mgr.id, name: mgr.name, jobTitle: mgr.job_title, photo: photoUrl(mgr) } : null}
          team={team.map((n) => ({ id: n.id, name: n.name, jobTitle: n.jobTitle, photo: n.photo }))}
          tasks={tasks.filter((x) => x.employeeId === me)}
          documents={documents}
          handbookPageId={settings.handbookPageId}
          hasProfile={Boolean(me)}
        />
      );
    }
    default: {
      if (id) notFound();
      const employee = await getEmployee(ctx, section);
      if (!employee) notFound();
      const [fields, people, templates] = await Promise.all([
        listFields(ctx.ws),
        ctx.viewer.hr ? listEmployees(ctx) : Promise.resolve([]),
        ctx.viewer.hr ? listTemplates(ctx.ws) : Promise.resolve([]),
      ]);
      return (
        <Profile
          employee={employee}
          fields={fields.filter((f) => !f.sensitive || ctx.viewer.hr || employee.can.isSelf)}
          people={people.map((p) => ({ id: p.id, name: p.name }))}
          hr={ctx.viewer.hr}
          myEmployeeId={ctx.viewer.employeeId}
          tab={sp.tab ?? 'overview'}
          templates={templates.map((x) => ({ id: x.id, name: x.name, kind: x.kind }))}
          wsAdmin={ctx.wsAdmin}
          signEnabled={ctx.viewer.hr && userCanUseApp(user, 'sign')}
        />
      );
    }
  }
}

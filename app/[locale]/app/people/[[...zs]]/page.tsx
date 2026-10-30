import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { sessionCtx } from '@/lib/people-http';
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
  const { locale, zs = [] } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const ctx = await sessionCtx(user);
  const t = await getTranslations({ locale, namespace: 'people' });
  const [section, id, sub] = zs;
  if (zs.length > 3) notFound();
  const hrOnly = () => <EmptyState product="people" title={t('common.hrOnlyTitle')} body={t('common.hrOnlyBody')} />;

  if (!section) {
    const filters = { q: sp.q ?? '', department: sp.department ?? '', location: sp.location ?? '', type: sp.type ?? '', status: ctx.viewer.hr ? (sp.status ?? '') : '' };
    const [employees, facets, templates] = await Promise.all([listEmployees(ctx, filters), directoryFacets(ctx), ctx.viewer.hr ? listTemplates(ctx.ws, 'onboarding') : Promise.resolve([])]);
    return <Directory employees={employees} facets={facets} hr={ctx.viewer.hr} templates={templates.map((x) => ({ id: x.id, name: x.name }))} filters={filters} openNew={sp.new === '1'} />;
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
        return <CycleDetail cycle={cycle} reviews={await listReviews(ctx, { cycleId: id })} hr={ctx.viewer.hr} focus={sp.review ?? null} />;
      }
      const [cycles, toWrite] = await Promise.all([listCycles(ctx), listReviews(ctx, { mineToWrite: true })]);
      return <Reviews cycles={cycles} toWrite={toWrite} hr={ctx.viewer.hr} />;
    }
    case 'reports': {
      if (id) notFound();
      if (!ctx.viewer.hr) return hrOnly();
      const [report, audit] = await Promise.all([peopleReport(ctx), listAudit(ctx, 100)]);
      return <Reports report={report} audit={audit} />;
    }
    case 'settings': {
      if (id) notFound();
      if (!ctx.viewer.hr) return hrOnly();
      const year = new Date().getUTCFullYear();
      const [settings, policies, fields, holidays, members] = await Promise.all([
        getSettings(ctx.ws),
        listPolicies(ctx.ws, { includeArchived: true }),
        listFields(ctx.ws),
        listCustomHolidays(ctx.ws),
        workspacePeople(ctx.ws),
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
          tab={sp.tab ?? ''}
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
        />
      );
    }
  }
}

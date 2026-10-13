import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { DEMO_MODE, requireUser } from '@/lib/session';
import { countDueTasks } from '@/lib/crm';
import AppSidebar from '@/components/app/AppSidebar';
import AppTopbar from '@/components/app/AppTopbar';
import CommandSearch from '@/components/app/CommandSearch';
import TimezoneCookie from '@/components/app/TimezoneCookie';
import { SupportIdentify } from '@/components/SupportWidget';
import { supportWidgetId } from '@/lib/support';
import '@/styles/link.css';
import '@/styles/crm.css';
import '@/styles/docs.css';
import '@/styles/calendar.css';
import '@/styles/track.css';
import '@/styles/track-quick.css';
import '@/styles/chat.css';
import '@xyflow/react/dist/style.css';
import '@/styles/flow.css';
import '@/styles/notes.css';
import '@/styles/board.css';
import '@/styles/agents.css';
import '@/styles/robots.css';
import '@/styles/app.css';
import '@/styles/color.css';

export const dynamic = 'force-dynamic';

export default async function AppLayout(
  props: {
    children: ReactNode;
    params: Promise<{ locale: string }>;
  }
) {
  const params = await props.params;

  const {
    locale
  } = params;

  const {
    children
  } = props;

  const user = await requireUser(locale);
  const tSide = await getTranslations({ locale, namespace: 'common.sidebar' });
  const tLink = await getTranslations({ locale, namespace: 'link' });
  const tCrm = await getTranslations({ locale, namespace: 'crm' });
  const tDocs = await getTranslations({ locale, namespace: 'docs' });
  const tCalendar = await getTranslations({ locale, namespace: 'calendar' });
  const tTrack = await getTranslations({ locale, namespace: 'track' });
  const tChat = await getTranslations({ locale, namespace: 'chat' });
  const tFlow = await getTranslations({ locale, namespace: 'flow' });
  const tNotes = await getTranslations({ locale, namespace: 'notes' });
  const tBoard = await getTranslations({ locale, namespace: 'board' });
  const tAgents = await getTranslations({ locale, namespace: 'agents' });
  const tRobots = await getTranslations({ locale, namespace: 'robots' });
  const tasksDue = await countDueTasks(user.id);

  return (
    <div className="app-frame">
      <AppSidebar
        demo={DEMO_MODE}
        tasksDue={tasksDue}
        user={{
          name: user.actingUser?.name ?? user.name,
          email: user.actingUser?.email ?? user.email,
          image: user.actingUser?.image ?? user.image,
        }}
        teamName={user.actingUser && user.team ? user.team.name : null}
        labels={{
          search: tSide('search'),
          new: tSide('new'),
          backToSite: tSide('backToSite'),
          docsSite: tSide('docs'),
          soon: tSide('soon'),
          signOut: tSide('signOut'),
          records: tSide('records'),
          activity: tSide('activity'),
          insights: tSide('insights'),
          linksSection: tSide('linksSection'),
          workspace: tSide('workspace'),
          newContact: tSide('newContact'),
          newCompany: tSide('newCompany'),
          newDeal: tSide('newDeal'),
          newTask: tSide('newTask'),
          newLink: tSide('newLink'),
          newDocPage: tSide('newDocPage'),
          newEventType: tSide('newEventType'),
          newProject: tSide('newProject'),
          newWidget: tSide('newWidget'),
          newFlow: tSide('newFlow'),
          newAgent: tSide('newAgent'),
          newRobot: tSide('newRobot'),
          team: tSide('team'),
          link: {
            overview: tLink('tabs.overview'),
            links: tLink('tabs.links'),
            new: tLink('tabs.new'),
            bio: tLink('tabs.bio'),
            settings: tLink('tabs.settings'),
          },
          crm: {
            overview: tCrm('tabs.overview'),
            contacts: tCrm('tabs.contacts'),
            companies: tCrm('tabs.companies'),
            deals: tCrm('tabs.deals'),
            tasks: tCrm('tabs.tasks'),
            lists: tCrm('tabs.lists'),
            reports: tCrm('tabs.reports'),
            dashboards: tCrm('tabs.dashboards'),
            workflows: tCrm('tabs.workflows'),
            settings: tCrm('tabs.settings'),
            sequences: tCrm('tabs.sequences'),
            templates: tCrm('tabs.templates'),
            products: tCrm('tabs.products'),
            quotes: tCrm('tabs.quotes'),
            forms: tCrm('tabs.forms'),
          },
          docs: {
            overview: tDocs('sidebar.overview'),
            pages: tDocs('sidebar.pages'),
            new: tDocs('sidebar.new'),
          },
          calendar: {
            overview: tCalendar('sidebar.overview'),
            eventTypes: tCalendar('sidebar.eventTypes'),
            bookings: tCalendar('sidebar.bookings'),
            routing: tCalendar('sidebar.routing'),
            availability: tCalendar('sidebar.availability'),
            settings: tCalendar('sidebar.settings'),
          },
          track: {
            overview: tTrack('sidebar.overview'),
            myTasks: tTrack('sidebar.myTasks'),
            projects: tTrack('sidebar.projects'),
            issues: tTrack('sidebar.issues'),
            cycles: tTrack('sidebar.cycles'),
            settings: tTrack('sidebar.settings'),
            inbox: tTrack('sidebar.inbox'),
          },
          chat: {
            overview: tChat('sidebar.overview'),
            inbox: tChat('sidebar.inbox'),
            people: tChat('sidebar.people'),
            settings: tChat('sidebar.settings'),
          },
          flow: {
            flows: tFlow('sidebar.flows'),
          },
          notes: { all: tNotes('sidebar.all'), newNote: tNotes('actions.newNote') },
          board: { boards: tBoard('sidebar.boards'), newBoard: tBoard('list.new') },
          agents: {
            agents: tAgents('sidebar.agents'),
          },
          robots: {
            robots: tRobots('sidebar.robots'),
          },
          notifications: {
            title: tTrack('notifications.title'),
            markRead: tTrack('notifications.markRead'),
            markAllRead: tTrack('notifications.markAllRead'),
            empty: tTrack('notifications.empty'),
          },
        }}
      />
      <div className="app-main-scroll">
        <AppTopbar
          sections={[
            { href: '/app', label: tLink('tabs.overview') },
            { href: '/app/links', label: tLink('tabs.links') },
            { href: '/app/links/new', label: tLink('tabs.new') },
            { href: '/app/links/bio', label: tLink('tabs.bio') },
            { href: '/app/settings', label: tLink('tabs.settings') },
            { href: '/app/crm', label: tCrm('tabs.overview') },
            { href: '/app/crm/contacts', label: tCrm('tabs.contacts') },
            { href: '/app/crm/companies', label: tCrm('tabs.companies') },
            { href: '/app/crm/deals', label: tCrm('tabs.deals') },
            { href: '/app/crm/lists', label: tCrm('tabs.lists') },
            { href: '/app/crm/products', label: tCrm('tabs.products') },
            { href: '/app/crm/quotes', label: tCrm('tabs.quotes') },
            { href: '/app/crm/forms', label: tCrm('tabs.forms') },
            { href: '/app/crm/tasks', label: tCrm('tabs.tasks') },
            { href: '/app/crm/sequences', label: tCrm('tabs.sequences') },
            { href: '/app/crm/templates', label: tCrm('tabs.templates') },
            { href: '/app/crm/dashboards', label: tCrm('tabs.dashboards') },
            { href: '/app/crm/reports', label: tCrm('tabs.reports') },
            { href: '/app/crm/workflows', label: tCrm('tabs.workflows') },
            { href: '/app/crm/settings', label: tCrm('tabs.settings') },
            { href: '/app/docs', label: tDocs('sidebar.overview') },
            { href: '/app/calendar', label: tCalendar('sidebar.overview') },
            { href: '/app/calendar/event-types', label: tCalendar('sidebar.eventTypes') },
            { href: '/app/calendar/routing', label: tCalendar('sidebar.routing') },
            { href: '/app/calendar/bookings', label: tCalendar('sidebar.bookings') },
            { href: '/app/calendar/settings', label: tCalendar('sidebar.settings') },
            { href: '/app/track', label: tTrack('sidebar.overview') },
            { href: '/app/track/my-tasks', label: tTrack('sidebar.myTasks') },
            { href: '/app/track/projects', label: tTrack('sidebar.projects') },
            { href: '/app/track/issues', label: tTrack('sidebar.issues') },
            { href: '/app/track/inbox', label: tTrack('sidebar.inbox') },
            { href: '/app/chat', label: tChat('sidebar.overview') },
            { href: '/app/chat/inbox', label: tChat('sidebar.inbox') },
            { href: '/app/chat/people', label: tChat('sidebar.people') },
            { href: '/app/chat/settings', label: tChat('sidebar.settings') },
            { href: '/app/flow', label: tFlow('sidebar.flows') },
            { href: '/app/notes', label: tNotes('sidebar.all') },
            { href: '/app/notes/clip', label: tNotes('clip.title') },
            { href: '/app/board', label: tBoard('sidebar.boards') },
            { href: '/app/agents', label: tAgents('sidebar.agents') },
            { href: '/app/robots', label: tRobots('sidebar.robots') },
          ]}
        />
        <main className="app-content">{children}</main>
      </div>
      <CommandSearch />
      <TimezoneCookie />
      {supportWidgetId() && !DEMO_MODE && (
        <SupportIdentify
          email={user.actingUser?.email ?? user.email}
          name={user.actingUser?.name ?? user.name ?? null}
        />
      )}
    </div>
  );
}

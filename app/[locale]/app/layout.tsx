import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { DEMO_MODE, requireUser } from '@/lib/session';
import { countDueTasks } from '@/lib/crm';
import AppSidebar from '@/components/app/AppSidebar';
import AppTopbar from '@/components/app/AppTopbar';
import AppFooter from '@/components/app/AppFooter';
import CommandSearch from '@/components/app/CommandSearch';
import '@/styles/link.css';
import '@/styles/crm.css';
import '@/styles/docs.css';
import '@/styles/calendar.css';
import '@/styles/track.css';
import '@/styles/chat.css';
import '@/styles/app.css';

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
          notifications: {
            title: tTrack('notifications.title'),
            markRead: tTrack('notifications.markRead'),
            markAllRead: tTrack('notifications.markAllRead'),
            empty: tTrack('notifications.empty'),
          },
        }}
      />
      <div className="app-main-scroll">
        <AppTopbar searchLabel={tSide('search')} />
        <main className="app-content">{children}</main>
        <AppFooter backToSite={tSide('backToSite')} />
      </div>
      <CommandSearch />
    </div>
  );
}

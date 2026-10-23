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
import { signVisitorIdentity } from '@/lib/chat-identity';
import '@/styles/link.css';
import '@/styles/crm.css';
import '@/styles/crm-records.css';
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
import '@/styles/groups.css';
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
  const tGroups = await getTranslations({ locale, namespace: 'groups' });
  const tasksDue = await countDueTasks(user.id);
  // Widget de soporte: el email de la persona logueada va firmado (HMAC con el
  // secreto del widget, calculado acá) para que el inbox lo marque verificado.
  const supportId = DEMO_MODE ? null : supportWidgetId();
  const supportEmail = user.actingUser?.email ?? user.email;
  const supportUserHash = supportId ? await signVisitorIdentity(supportId, supportEmail) : null;

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
        crumb={
          <AppTopbar
            sections={[
              { href: '/app', label: tLink('tabs.overview') },
              { href: '/app/links', label: tLink('tabs.links') },
              { href: '/app/links/new', label: tLink('tabs.new') },
              { href: '/app/links/bulk', label: tLink('new.title') },
              { href: '/app/links/import', label: tLink('new.title') },
              { href: '/app/links/domains', label: tLink('domains.title') },
              { href: '/app/links/bio', label: tLink('tabs.bio') },
              { href: '/app/links/analytics', label: tLink('tabs.analytics') },
              { href: '/app/links/folders', label: tLink('folders.title') },
              { href: '/app/settings', label: tSide('settings') },
              { href: '/app/crm', label: tCrm('tabs.overview') },
              { href: '/app/crm/contacts', label: tCrm('tabs.contacts') },
              { href: '/app/crm/companies', label: tCrm('tabs.companies') },
              { href: '/app/crm/companies/duplicates', label: tCrm('record.more.duplicates') },
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
              { href: '/app/crm/trash', label: tCrm('tabs.trash') },
              { href: '/app/docs', label: tDocs('sidebar.pages') },
              { href: '/app/docs/import', label: tDocs('notionImport.title') },
              { href: '/app/calendar', label: tCalendar('sidebar.overview') },
              { href: '/app/calendar/event-types', label: tCalendar('sidebar.eventTypes') },
              { href: '/app/calendar/routing', label: tCalendar('sidebar.routing') },
              { href: '/app/calendar/bookings', label: tCalendar('sidebar.bookings') },
              { href: '/app/calendar/availability', label: tCalendar('sidebar.availability') },
              { href: '/app/calendar/settings', label: tCalendar('sidebar.settings') },
              { href: '/app/calendar/analytics', label: tCalendar('sidebar.analytics') },
              { href: '/app/track', label: tTrack('sidebar.overview') },
              { href: '/app/track/my-tasks', label: tTrack('sidebar.myTasks') },
              { href: '/app/track/projects', label: tTrack('sidebar.projects') },
              { href: '/app/track/issues', label: tTrack('sidebar.issues') },
              { href: '/app/track/inbox', label: tTrack('sidebar.inbox') },
              { href: '/app/track/settings', label: tTrack('sidebar.settings') },
              { href: '/app/chat', label: tChat('sidebar.overview') },
              { href: '/app/chat/inbox', label: tChat('sidebar.inbox') },
              { href: '/app/chat/people', label: tChat('sidebar.people') },
              { href: '/app/chat/reports', label: tChat('sidebar.reports') },
              { href: '/app/chat/widgets', label: tChat('sidebar.widgets') },
              { href: '/app/flow', label: tFlow('sidebar.flows') },
              { href: '/app/flow/tables', label: tFlow('sidebar.tables') },
              { href: '/app/flow/credentials', label: tFlow('sidebar.credentials') },
              { href: '/app/notes', label: tNotes('sidebar.all') },
              { href: '/app/notes/clip', label: tNotes('clip.button') },
              { href: '/app/board', label: tBoard('sidebar.boards') },
              { href: '/app/agents', label: tAgents('sidebar.agents') },
              { href: '/app/robots', label: tRobots('sidebar.robots') },
              { href: '/app/robots/recorder', label: tRobots('recorder.title') },
              { href: '/app/groups/inbox', label: tGroups('sidebar.inbox') },
              { href: '/app/groups/list', label: tGroups('sidebar.groups') },
              { href: '/app/groups/tickets', label: tGroups('sidebar.tickets') },
              { href: '/app/groups/broadcasts', label: tGroups('sidebar.broadcasts') },
              { href: '/app/groups/analytics', label: tGroups('sidebar.analytics') },
              { href: '/app/groups/settings', label: tGroups('sidebar.settings') },
            ]}
          />
        }
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
          settings: tSide('settings'),
          collapse: tSide('collapse'),
          expand: tSide('expand'),
          menu: tSide('menu'),
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
          newGroup: tSide('newGroup'),
          team: tSide('team'),
          link: {
            overview: tLink('tabs.overview'),
            links: tLink('tabs.links'),
            new: tLink('tabs.new'),
            bio: tLink('tabs.bio'),
            analytics: tLink('tabs.analytics'),
            bulk: tLink('bulk.title'),
            domains: tSide('linkDomains'),
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
            trash: tCrm('tabs.trash'),
          },
          docs: {
            pages: tDocs('sidebar.pages'),
            templates: tSide('docsTemplates'),
            trash: tDocs('trash.title'),
          },
          calendar: {
            overview: tCalendar('sidebar.overview'),
            eventTypes: tCalendar('sidebar.eventTypes'),
            bookings: tCalendar('sidebar.bookings'),
            routing: tCalendar('sidebar.routing'),
            availability: tCalendar('sidebar.availability'),
            analytics: tCalendar('sidebar.analytics'),
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
            reports: tChat('sidebar.reports'),
            settings: tChat('sidebar.settings'),
          },
          flow: {
            flows: tFlow('sidebar.flows'),
            tables: tFlow('sidebar.tables'),
            credentials: tFlow('sidebar.credentials'),
          },
          notes: { all: tNotes('sidebar.all'), newNote: tNotes('actions.newNote'), clip: tNotes('clip.button') },
          board: { boards: tBoard('sidebar.boards'), newBoard: tBoard('list.new') },
          agents: {
            agents: tAgents('sidebar.agents'),
          },
          robots: {
            robots: tRobots('sidebar.robots'),
            recorder: tRobots('recorder.title'),
          },
          groups: {
            inbox: tGroups('sidebar.inbox'),
            groups: tGroups('sidebar.groups'),
            tickets: tGroups('sidebar.tickets'),
            broadcasts: tGroups('sidebar.broadcasts'),
            analytics: tGroups('sidebar.analytics'),
            settings: tGroups('sidebar.settings'),
          },
          notifications: {
            title: tTrack('notifications.title'),
            markRead: tTrack('notifications.markRead'),
            markAllRead: tTrack('notifications.markAllRead'),
            empty: tTrack('notifications.empty'),
            text: {
              someone: tTrack('inbox.someone'),
              untitled: tTrack('notifications.untitled'),
              mentionedYou: tTrack.raw('activity.mentionedYou') as string,
              assignedYou: tTrack.raw('activity.assignedYou') as string,
              commentedOn: tTrack.raw('activity.commentedOn') as string,
              changedStatus: tTrack.raw('activity.changedStatus') as string,
              updatedIssue: tTrack.raw('activity.updatedIssue') as string,
              reminderFor: tTrack.raw('inboxSnooze.reminderFor') as string,
              docMention: tTrack.raw('notifications.docMention') as string,
              docCommentMention: tTrack.raw('notifications.docCommentMention') as string,
              docCommentReply: tTrack.raw('notifications.docCommentReply') as string,
              docShared: tTrack.raw('notifications.docShared') as string,
              boardMention: tTrack.raw('notifications.boardMention') as string,
              boardReply: tTrack.raw('notifications.boardReply') as string,
            },
          },
        }}
      />
      <div className="app-main-scroll">
        <main className="app-content">{children}</main>
      </div>
      <CommandSearch />
      <TimezoneCookie />
      {supportId && (
        <SupportIdentify
          email={supportEmail}
          name={user.actingUser?.name ?? user.name ?? null}
          userHash={supportUserHash}
        />
      )}
    </div>
  );
}

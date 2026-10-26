import type { ReactNode } from 'react';
import { canCreateDocPage } from '@/lib/docs-guard';
import { getTranslations } from 'next-intl/server';
import { DEMO_MODE, requireUser } from '@/lib/session';
import { countDueTasks } from '@/lib/crm';
import { getWorkspaceMode } from '@/lib/home';
import AppSidebar from '@/components/app/AppSidebar';
import AppTopbar from '@/components/app/AppTopbar';
import CommandSearch from '@/components/app/CommandSearch';
import DictationHost from '@/components/voice/DictationHost';
import RecorderProvider from '@/components/voice/RecorderProvider';
import TimezoneCookie from '@/components/app/TimezoneCookie';
import { SupportIdentify } from '@/components/SupportWidget';
import { supportWidgetId } from '@/lib/support';
import { signVisitorIdentity } from '@/lib/chat-identity';
import { getUserTimeZone } from '@/lib/user-tz';
import { SIDEBAR_COLLAPSED_SCRIPT } from '@/lib/sidebar-collapsed';
import ClientMessages from '@/components/i18n/ClientMessages';
import { settingsSectionHref, settingsSectionKeys } from '@/lib/settings-nav';
// CSS común a toda la app: link.css trae la base de páginas, tablas y filtros
// que usan todas las apps, app-shared.css las reglas de otras hojas que se usan
// fuera de su app (ver su encabezado). Cada app importa su hoja en su layout.
import '@/styles/link.css';
import '@/styles/app-shared.css';
import '@/styles/app.css';
import '@/styles/color.css';
import '@/styles/voice-host.css';

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
  const tTriage = await getTranslations({ locale, namespace: 'trackTriage' });
  // Lecturas independientes en paralelo (en Turso cada query es un RTT).
  const [tSettings, tSide, tLink, tCrm, tDocs, tCalendar, tTrack, tChat, tFlow, tNotes, tBoard, tAgents, tRobots, tGroups, tVoice, tRec, tTalk, tasksDue, serverTz, tPlanning, mode, tCat] =
    await Promise.all([
      getTranslations({ locale, namespace: 'settings' }),
      getTranslations({ locale, namespace: 'common.sidebar' }),
      getTranslations({ locale, namespace: 'link' }),
      getTranslations({ locale, namespace: 'crm' }),
      getTranslations({ locale, namespace: 'docs' }),
      getTranslations({ locale, namespace: 'calendar' }),
      getTranslations({ locale, namespace: 'track' }),
      getTranslations({ locale, namespace: 'chat' }),
      getTranslations({ locale, namespace: 'flow' }),
      getTranslations({ locale, namespace: 'notes' }),
      getTranslations({ locale, namespace: 'board' }),
      getTranslations({ locale, namespace: 'agents' }),
      getTranslations({ locale, namespace: 'robots' }),
      getTranslations({ locale, namespace: 'groups' }),
      getTranslations({ locale, namespace: 'voice' }),
      getTranslations({ locale, namespace: 'rec' }),
      getTranslations({ locale, namespace: 'talk' }),
      // El badge no puede tirar todas las páginas de la app: sin la tabla o con un error, 0.
      countDueTasks(user.id).catch((err) => {
        console.error('[app layout] countDueTasks', err);
        return 0;
      }),
      getUserTimeZone(),
      getTranslations({ locale, namespace: 'trackPlanning' }),
      getWorkspaceMode(user),
      getTranslations({ locale, namespace: 'common.categories' }),
    ]);
  // Widget de soporte: el email de la persona logueada va firmado (HMAC con el
  // secreto del widget, calculado acá) para que el inbox lo marque verificado.
  const supportId = DEMO_MODE ? null : supportWidgetId();
  const supportEmail = user.actingUser?.email ?? user.email;
  const supportUserHash = supportId ? await signVisitorIdentity(supportId, supportEmail) : null;

  return (
    // Cliente: lo que usan el sidebar y Cmd+K de otras apps; cada app suma su
    // namespace en su layout.
    <ClientMessages locale={locale} namespaces={['board.list', 'notes.actions', 'track.cmdk', 'trackPlanning.cmdk', 'settings.sections', 'settings.cmdk', 'voice.host', 'voice.errors', 'voice.cmdk', 'voice.recorder', 'rec.signout']}>
      <RecorderProvider owner={`${user.actingUser?.id ?? user.id}:${user.id}`}>
      {/* El script pone sidebar-collapsed antes del primer paint; React no toca la clase al hidratar. */}
      <div className="app-frame" suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_COLLAPSED_SCRIPT }} />
        <AppSidebar
          docsCanCreate={await canCreateDocPage(user, {}).catch(() => true)}
          demo={DEMO_MODE}
          mode={mode}
          tasksDue={tasksDue}
          user={{
            name: user.actingUser?.name ?? user.name,
            email: user.actingUser?.email ?? user.email,
            image: user.actingUser?.image ?? user.image,
            id: user.actingUser?.id ?? user.id,
            ws: user.id,
          }}
          teamName={user.actingUser && user.team ? user.team.name : null}
          crumb={
            <AppTopbar
              sections={[
                { href: '/app/links', label: tLink('tabs.links') },
                { href: '/app/links/overview', label: tLink('tabs.overview') },
                { href: '/app/links/new', label: tLink('tabs.new') },
                { href: '/app/links/bulk', label: tLink('new.title') },
                { href: '/app/links/import', label: tLink('new.title') },
                { href: '/app/links/domains', label: tLink('domains.title') },
                { href: '/app/links/bio', label: tLink('tabs.bio') },
                { href: '/app/links/analytics', label: tLink('tabs.analytics') },
                { href: '/app/links/folders', label: tLink('folders.title') },
                { href: '/app/settings', label: tSide('settings') },
                ...settingsSectionKeys(true).map((key) => ({ href: settingsSectionHref(key), label: tSettings(`sections.${key}`) })),
                // Ajustes de las apps que no los tenían (los demás están en su bloque).
                { href: '/app/links/settings', label: tSide('appSettings') },
                { href: '/app/docs/settings', label: tSide('appSettings') },
                { href: '/app/notes/settings', label: tSide('appSettings') },
                { href: '/app/board/settings', label: tSide('appSettings') },
                { href: '/app/flow/settings', label: tSide('appSettings') },
                { href: '/app/agents/settings', label: tSide('appSettings') },
                { href: '/app/robots/settings', label: tSide('appSettings') },
                { href: '/app/voice/settings', label: tSide('appSettings') },
                { href: '/app/rec/settings', label: tSide('appSettings') },
                { href: '/app/talk/settings', label: tSide('appSettings') },
                { href: '/app/crm', label: tCrm('tabs.overview') },
                { href: '/app/crm/contacts', label: tCrm('tabs.contacts') },
                { href: '/app/crm/companies', label: tCrm('tabs.companies') },
                { href: '/app/crm/companies/duplicates', label: tCrm('record.more.duplicates') },
                { href: '/app/crm/deals', label: tCrm('tabs.deals') },
                { href: '/app/crm/lists', label: tCrm('tabs.lists') },
                { href: '/app/crm/leads', label: tCrm('tabs.leads') },
                { href: '/app/crm/objects', label: tCrm('tabs.objects') },
                { href: '/app/crm/products', label: tCrm('tabs.products') },
                { href: '/app/crm/quotes', label: tCrm('tabs.quotes') },
                { href: '/app/crm/forms', label: tCrm('tabs.forms') },
                { href: '/app/crm/documents', label: tCrm('tabs.documents') },
                { href: '/app/crm/videos', label: tCrm('tabs.videos') },
                { href: '/app/crm/tasks', label: tCrm('tabs.tasks') },
                { href: '/app/crm/sequences', label: tCrm('tabs.sequences') },
                { href: '/app/crm/playbooks', label: tCrm('tabs.playbooks') },
                { href: '/app/crm/approvals', label: tCrm('approvals.title') },
                { href: '/app/crm/tasks/queue', label: tCrm('queue.title') },
                { href: '/app/crm/templates', label: tCrm('tabs.templates') },
                { href: '/app/crm/dashboards', label: tCrm('tabs.dashboards') },
                { href: '/app/crm/reports', label: tCrm('tabs.reports') },
                { href: '/app/crm/reports/custom', label: tCrm('reportBuilder.nav.custom') },
                { href: '/app/crm/forecast', label: tCrm('tabs.forecast') },
                { href: '/app/crm/workflows', label: tCrm('tabs.workflows') },
                { href: '/app/crm/agents', label: tCrm('tabs.agents') },
                { href: '/app/crm/settings', label: tCrm('tabs.crmSettings') },
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
                { href: '/app/track/teams', label: tTrack('sidebar.projects') },
                { href: '/app/track/team', label: tTrack('sidebar.projects') },
                { href: '/app/track/issues', label: tTrack('sidebar.issues') },
                { href: '/app/track/customers', label: tTrack('sidebar.customers') },
                { href: '/app/track/inbox', label: tTrack('sidebar.inbox') },
                { href: '/app/track/projects', label: tPlanning('sidebar.plans') },
                { href: '/app/track/plans', label: tPlanning('sidebar.plans') },
                { href: '/app/track/initiatives', label: tPlanning('sidebar.initiatives') },
                { href: '/app/track/roadmap', label: tPlanning('sidebar.roadmap') },
                { href: '/app/track/cycles', label: tPlanning('sidebar.cycles') },
                { href: '/app/track/insights', label: tPlanning('sidebar.insights') },
                { href: '/app/track/dashboards', label: tPlanning('sidebar.dashboards') },
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
                { href: '/app/groups/tasks', label: tGroups('sidebar.tasks') },
                { href: '/app/groups/templates', label: tGroups('sidebar.templates') },
                { href: '/app/groups/broadcasts', label: tGroups('sidebar.broadcasts') },
                { href: '/app/groups/analytics', label: tGroups('sidebar.analytics') },
                { href: '/app/groups/settings', label: tGroups('sidebar.settings') },
                { href: '/app/voice', label: tVoice('nav.meetings') },
                { href: '/app/voice/dictation', label: tVoice('nav.dictation') },
                { href: '/app/rec', label: tRec('sidebar.home') },
                { href: '/app/rec/workspace', label: tRec('sidebar.workspace') },
                { href: '/app/rec/new', label: tRec('sidebar.newVideo') },
                { href: '/app/talk', label: tTalk('sidebar.home') },
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
            appSettings: tSide('appSettings'),
            platformHome: tSide('platformHome'),
            apps: tSide('apps'),
            featured: tSide('featured'),
            moreApps: tSide('moreApps'),
            categories: {
              sell: tCat('sell.title'),
              support: tCat('support.title'),
              automate: tCat('automate.title'),
              build: tCat('build.title'),
              daily: tCat('daily.title'),
            },
            platform: tSide('platform'),
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
              leads: tCrm('tabs.leads'),
              objects: tCrm('tabs.objects'),
              reports: tCrm('tabs.reports'),
              dashboards: tCrm('tabs.dashboards'),
              forecast: tCrm('tabs.forecast'),
              workflows: tCrm('tabs.workflows'),
              settings: tCrm('tabs.crmSettings'),
              sequences: tCrm('tabs.sequences'),
              playbooks: tCrm('tabs.playbooks'),
              templates: tCrm('tabs.templates'),
              products: tCrm('tabs.products'),
              quotes: tCrm('tabs.quotes'),
              forms: tCrm('tabs.forms'),
              documents: tCrm('tabs.documents'),
              videos: tCrm('tabs.videos'),
              trash: tCrm('tabs.trash'),
              agents: tCrm('tabs.agents'),
              askAi: tCrm('ai.assistant.open'),
            },
            docs: {
              pages: tDocs('sidebar.pages'),
              templates: tSide('docsTemplates'),
              trash: tDocs('trash.title'),
              askAi: tDocs('ask.open'),
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
              planning: tPlanning('sidebar.planning'),
              plans: tPlanning('sidebar.plans'),
              initiatives: tPlanning('sidebar.initiatives'),
              roadmap: tPlanning('sidebar.roadmap'),
              analytics: tPlanning('sidebar.analytics'),
              insights: tPlanning('sidebar.insights'),
              dashboards: tPlanning('sidebar.dashboards'),
              customers: tTrack('sidebar.customers'),
              workspace: tTrack('sidebar.workspace'),
              yourTeams: tTrack('sidebar.yourTeams'),
              more: tTrack('sidebar.more'),
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
              tasks: tGroups('sidebar.tasks'),
              templates: tGroups('sidebar.templates'),
              broadcasts: tGroups('sidebar.broadcasts'),
              analytics: tGroups('sidebar.analytics'),
              settings: tGroups('sidebar.settings'),
            },
            voice: { meetings: tVoice('nav.meetings'), dictation: tVoice('nav.dictation'), newMeeting: tVoice('meetings.new') },
            rec: { home: tRec('sidebar.home'), workspace: tRec('sidebar.workspace'), newVideo: tRec('sidebar.newVideo') },
            talk: { home: tTalk('sidebar.home') },
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
                planUpdate: tPlanning.raw('notify.planUpdate') as string,
                planComment: tPlanning.raw('notify.planComment') as string,
                planReminder: tPlanning.raw('notify.planReminder') as string,
                docMention: tTrack.raw('notifications.docMention') as string,
                docCommentMention: tTrack.raw('notifications.docCommentMention') as string,
                docCommentReply: tTrack.raw('notifications.docCommentReply') as string,
                docShared: tTrack.raw('notifications.docShared') as string,
                docConflict: tTrack.raw('notifications.docConflict') as string,
                boardMention: tTrack.raw('notifications.boardMention') as string,
                boardReply: tTrack.raw('notifications.boardReply') as string,
                trackKinds: {
                  triage_owner: tTriage.raw('notifications.triage_owner') as string,
                  sla_risk: tTriage.raw('notifications.sla_risk') as string,
                  sla_breach: tTriage.raw('notifications.sla_breach') as string,
                  agent_update: tTriage.raw('notifications.agent_update') as string,
                },
                groupsMention: tTrack.raw('notifications.groupsMention') as string,
                groupsAssigned: tTrack.raw('notifications.groupsAssigned') as string,
                groupsAutoAssigned: tTrack.raw('notifications.groupsAutoAssigned') as string,
                recView: tRec.raw('notifications.view') as string,
                recComment: tRec.raw('notifications.comment') as string,
                recReaction: tRec.raw('notifications.reaction') as string,
                recComments: tRec.raw('notifications.comments') as string,
              },
            },
          }}
        />
        <div className="app-main-scroll">
          <main className="app-content">{children}</main>
        </div>
        <CommandSearch />
        <DictationHost />
        <TimezoneCookie serverTz={serverTz} />
        {supportId && (
          <SupportIdentify
            email={supportEmail}
            name={user.actingUser?.name ?? user.name ?? null}
            userHash={supportUserHash}
          />
        )}
      </div>
      </RecorderProvider>
    </ClientMessages>
  );
}

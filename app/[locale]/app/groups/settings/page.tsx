import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { isWorkspaceAdmin } from '@/lib/session';
import { availableProviders, getSettings, groupsBaseUrl, listLabels, listPeople, listPropertyDefs, listQuickReplies } from '@/lib/groups';
import { getAvailability, getAvailabilityStatus, listRules, listTeams, workspacePeople } from '@/lib/groups-inbox';
import AssignmentSettings from '@/components/groups/AssignmentSettings';
import { aiEnabled } from '@/lib/ai';
import { groupsAiFakeActive } from '@/lib/groups-flag';
import { getPlatformSettings, listLabelAccess } from '@/lib/groups-access';
import { listIntegrations } from '@/lib/groups-integrations';
import { WEBHOOK_EVENTS } from '@/lib/webhooks-events';
import PageHeader from '@/components/ui/PageHeader';
import PlatformSettingsLink from '@/components/app/PlatformSettingsLink';
import SettingsTabs from '@/components/ui/SettingsTabs';
import NumbersSettings from '@/components/groups/NumbersSettings';
import { LabelsPanel, PropertiesPanel, QuickRepliesPanel, TicketRulesPanel } from '@/components/groups/SettingsPanels';
import { AccessPanel, AppsPanel, AuditLog, IntegrationsPanel } from '@/components/groups/PlatformPanels';
import TeamPanel from '@/components/groups/TeamPanel';
import PeriskopeImport from '@/components/groups/PeriskopeImport';
import { listLines, teamForViewer, teamOverview } from '@/lib/groups-lines';
import { pageViewer, pageNumbers } from '@/lib/groups-page';

export const dynamic = 'force-dynamic';

const API_ROUTES = [
  'GET /api/v1/groups/chats',
  'GET, PATCH /api/v1/groups/chats/:id',
  'GET, POST /api/v1/groups/chats/:id/messages',
  'GET, POST /api/v1/groups/chats/:id/members',
  'POST /api/v1/groups/groups',
  'GET /api/v1/groups/numbers',
  'GET, POST /api/v1/groups/labels',
  'GET, POST /api/v1/groups/tickets',
  'GET, PATCH /api/v1/groups/tickets/:id',
  'GET, POST /api/v1/groups/broadcasts',
  'GET, POST /api/v1/groups/recurring',
  'POST /api/v1/groups/mcp',
];

const TABS = ['numbers', 'team', 'labels', 'quick', 'properties', 'ticketFields', 'assignment', 'tickets', 'access', 'audit', 'migrate', 'integrations', 'api', 'apps'] as const;
/** Nombres viejos o cercanos de pestañas que llevan a la que corresponde. */
const TAB_ALIASES: Record<string, (typeof TABS)[number]> = {
  rules: 'tickets',
  sla: 'tickets',
  webhooks: 'integrations',
  replies: 'quick',
  fields: 'ticketFields',
  teams: 'team',
  users: 'team',
  members: 'team',
  lines: 'numbers',
  periskope: 'migrate',
  import: 'migrate',
  'round-robin': 'assignment',
  permissions: 'access',
  privacy: 'access',
  mcp: 'integrations',
  slack: 'integrations',
  log: 'audit',
  mobile: 'apps',
  notifications: 'apps',
};

export default async function GroupsSettingsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ tab?: string; new?: string; reconnect?: string }> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'groups' });
  const alias = sp.tab ? TAB_ALIASES[sp.tab] : undefined;
  if (alias) redirect(`/${locale}/app/groups/settings?tab=${alias}`);
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as (typeof TABS)[number]) : 'numbers';
  const admin = isWorkspaceAdmin(user);

  let body;
  if (tab === 'numbers') {
    const [lines, people, teams, platform] = await Promise.all([
      listLines(user.id, await pageViewer(user), { withAccess: admin }),
      listPeople(user.id),
      listTeams(user.id),
      getPlatformSettings(user.id),
    ]);
    body = (
      <NumbersSettings
        initial={lines}
        providers={availableProviders()}
        canEdit={admin}
        openNew={sp.new === '1'}
        reconnect={sp.reconnect ?? null}
        people={people}
        teams={teams}
        lineAccess={platform.lineAccess}
      />
    );
  } else if (tab === 'team') {
    const [people, teams, platform, lines] = await Promise.all([teamOverview(user.id), listTeams(user.id), getPlatformSettings(user.id), listLines(user.id, await pageViewer(user), { withAccess: admin })]);
    body = (
      <TeamPanel
        initial={{
          people: teamForViewer(people, admin),
          teams,
          lineAccess: platform.lineAccess,
          teamAccess: platform.teamAccess,
          reassignOnOffline: platform.reassignOnOffline,
          canEdit: admin,
          me: user.actingUser?.id ?? user.id,
        }}
        lines={lines}
        isOwner={user.role === 'owner'}
      />
    );
  } else if (tab === 'migrate') body = admin ? <PeriskopeImport /> : <p className="ui-help">{t('access.adminsOnly')}</p>;
  else if (tab === 'labels') body = <LabelsPanel initial={await listLabels(user.id)} />;
  else if (tab === 'quick') body = <QuickRepliesPanel initial={await listQuickReplies(user.id)} />;
  else if (tab === 'properties') body = <PropertiesPanel initial={await listPropertyDefs(user.id)} canEdit={admin} />;
  else if (tab === 'ticketFields') body = <PropertiesPanel initial={await listPropertyDefs(user.id, 'ticket')} canEdit={admin} scope="ticket" />;
  else if (tab === 'tickets') body = <TicketRulesPanel initial={await getSettings(user.id)} canEdit={admin} aiAvailable={aiEnabled() || groupsAiFakeActive()} />;
  else if (tab === 'assignment') {
    const [teams, rules, people, numbers, labels, availability, statuses] = await Promise.all([
      listTeams(user.id),
      listRules(user.id),
      workspacePeople(user.id),
      pageNumbers(user),
      listLabels(user.id),
      getAvailability(user.id),
      getAvailabilityStatus(user.id),
    ]);
    body = (
      <AssignmentSettings
        teams={teams}
        rules={rules}
        people={people}
        numbers={numbers.map((n) => ({ id: n.id, name: n.name, phone: n.phone }))}
        labels={labels.map((l) => ({ id: l.id, name: l.name, color: l.color }))}
        availability={availability}
        statuses={statuses}
        canEdit={admin}
      />
    );
  } else if (tab === 'access')
    body = admin ? (
      <AccessPanel
        initial={await getPlatformSettings(user.id)}
        access={await listLabelAccess(user.id)}
        labels={(await listLabels(user.id)).map((l) => ({ id: l.id, name: l.name, color: l.color }))}
        people={await listPeople(user.id)}
        canEdit={admin}
      />
    ) : (
      <p className="ui-help">{t('access.adminsOnly')}</p>
    );
  else if (tab === 'audit')
    body = admin ? (
      <div className="ui-fields">
        <p className="ui-help">{t('audit.intro')}</p>
        <AuditLog people={await listPeople(user.id)} />
      </div>
    ) : (
      <p className="ui-help">{t('access.adminsOnly')}</p>
    );
  else if (tab === 'integrations')
    body = admin ? (
      <IntegrationsPanel
        integrations={await listIntegrations(user.id)}
        events={WEBHOOK_EVENTS.filter((e) => e.startsWith('groups.'))}
        canEdit={admin}
        mcpUrl={`${groupsBaseUrl()}/api/v1/groups/mcp`}
      />
    ) : (
      <p className="ui-help">{t('access.adminsOnly')}</p>
    );
  else if (tab === 'apps') body = <AppsPanel />;
  else
    body = (
      <div className="ui-fields gr-api">
        <p>{t('api.intro')}</p>
        <ul className="gr-mini-list gr-mono">
          {API_ROUTES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="ui-help">
          {t('api.docs')} <Link href="/docs#groups">{t('api.docsLink')}</Link>
        </p>
        <p className="ui-help">
          {t('api.scopes')} <Link href="/app/settings/api">{t('api.keys')}</Link>
        </p>
        <p>{t('api.webhooks')}</p>
        <ul className="gr-mini-list gr-mono">
          {WEBHOOK_EVENTS.filter((e) => e.startsWith('groups.')).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
        <p className="ui-help">
          {t('api.webhooksManage')} <Link href="/app/groups/settings?tab=integrations">{t('settings.tabs.integrations')}</Link>
        </p>
        <p className="ui-help">
          {t('api.flow')} <Link href="/app/flow">Flow</Link>
        </p>
      </div>
    );

  return (
    <div className="ui-page">
      <PageHeader title={t('settings.title')} description={t('settings.desc')} actions={<PlatformSettingsLink locale={locale} />} />
      <SettingsTabs mode="query" param="tab" items={TABS.map((k) => ({ key: k, label: t(`settings.tabs.${k}`) }))}>
        {body}
      </SettingsTabs>
    </div>
  );
}

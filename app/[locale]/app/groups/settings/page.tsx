import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { isWorkspaceAdmin } from '@/lib/session';
import { availableProviders, getSettings, listLabels, listNumbers, listPropertyDefs, listQuickReplies } from '@/lib/groups';
import PageHeader from '@/components/ui/PageHeader';
import SettingsTabs from '@/components/ui/SettingsTabs';
import NumbersSettings from '@/components/groups/NumbersSettings';
import { LabelsPanel, PropertiesPanel, QuickRepliesPanel, TicketRulesPanel } from '@/components/groups/SettingsPanels';

export const dynamic = 'force-dynamic';

const TABS = ['numbers', 'labels', 'quick', 'properties', 'rules', 'api'] as const;

export default async function GroupsSettingsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ tab?: string; new?: string }> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'groups' });
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as (typeof TABS)[number]) : 'numbers';
  const admin = isWorkspaceAdmin(user);

  let body;
  if (tab === 'numbers') body = <NumbersSettings initial={await listNumbers(user.id)} providers={availableProviders()} canEdit={admin} openNew={sp.new === '1'} />;
  else if (tab === 'labels') body = <LabelsPanel initial={await listLabels(user.id)} />;
  else if (tab === 'quick') body = <QuickRepliesPanel initial={await listQuickReplies(user.id)} />;
  else if (tab === 'properties') body = <PropertiesPanel initial={await listPropertyDefs(user.id)} canEdit={admin} />;
  else if (tab === 'rules') body = <TicketRulesPanel initial={await getSettings(user.id)} canEdit={admin} />;
  else
    body = (
      <div className="ui-fields gr-api">
        <p>{t('api.intro')}</p>
        <ul className="gr-mini-list gr-mono">
          <li>GET /api/v1/groups/chats</li>
          <li>GET /api/v1/groups/chats/:id/messages</li>
          <li>POST /api/v1/groups/chats/:id/messages</li>
          <li>GET /api/v1/groups/tickets</li>
          <li>POST /api/v1/groups/tickets</li>
        </ul>
        <p className="ui-help">
          {t('api.scopes')} <Link href="/app/settings/workspace">{t('api.keys')}</Link>
        </p>
        <p>{t('api.webhooks')}</p>
        <ul className="gr-mini-list gr-mono">
          <li>groups.message.received</li>
          <li>groups.ticket.created</li>
          <li>groups.ticket.updated</li>
        </ul>
        <p className="ui-help">
          {t('api.flow')} <Link href="/app/flow">Flow</Link>
        </p>
      </div>
    );

  return (
    <div className="ui-page">
      <PageHeader title={t('settings.title')} description={t('settings.desc')} />
      <SettingsTabs mode="query" param="tab" items={TABS.map((k) => ({ key: k, label: t(`settings.tabs.${k}`) }))}>
        {body}
      </SettingsTabs>
    </div>
  );
}

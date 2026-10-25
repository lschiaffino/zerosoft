import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { getEmailSettings } from '@/lib/crm-email';
import { getMailboxSync } from '@/lib/crm-email-sync';
import { scopeAllowsSend } from '@/lib/gmail';
import { listCustomFields, listPipelinesWithStages } from '@/lib/crm';
import { getIntegration, gmailRedirectUri } from '@/lib/integrations';
import { listMemberTeams, listMembers, listOwnedTeams, listPendingInvites } from '@/lib/teams';
import { listTags } from '@/lib/crm-tags';
import { getCrmSettings, listExchangeRates, missingRates } from '@/lib/crm-currency';
import { getMemberVisibility, listSalesTeams, sessionScope } from '@/lib/crm-visibility';
import { getAssignmentRule, listAssignmentHistory, unavailablePeople } from '@/lib/crm-assignment';
import { listScoreRules } from '@/lib/crm-scoring';
import { quotaProgress } from '@/lib/crm-quotas';
import { CRM_SETTINGS_TABS, crmSettingsTab } from '@/lib/crm-settings-tabs';
import PageHeader from '@/components/ui/PageHeader';
import PlatformSettingsLink from '@/components/app/PlatformSettingsLink';
import SettingsTabs from '@/components/ui/SettingsTabs';
import FormSection from '@/components/ui/FormSection';
import PipelinesEditor from '@/components/crm/PipelinesEditor';
import CallOutcomesSettings from '@/components/crm/CallOutcomesSettings';
import CustomFieldsPanel from '@/components/crm/CustomFieldsPanel';
import ImportPanel from '@/components/crm/ImportPanel';
import CrmMigrationPanel from '@/components/crm/CrmMigrationPanel';
import ExportPanel from '@/components/crm/ExportPanel';
import GmailPanel from '@/components/crm/GmailPanel';
import TeamPanel from '@/components/crm/TeamPanel';
import EmailTrackingSetting from '@/components/crm/EmailTrackingSetting';
import TagsManager from '@/components/crm/TagsManager';
import CurrencySettings from '@/components/crm/CurrencySettings';
import QuoteSettings from '@/components/crm/QuoteSettings';
import AccessPanel from '@/components/crm/AccessPanel';
import AssignmentPanel from '@/components/crm/AssignmentPanel';
import ScoringRulesPanel from '@/components/crm/ScoringRulesPanel';
import QuotasPanel from '@/components/crm/QuotasPanel';
import LegacySettingsAnchor from '@/components/crm/LegacySettingsAnchor';
import LeadStagesEditor from '@/components/crm/LeadStagesEditor';
import FieldPermissionsPanel from '@/components/crm/FieldPermissionsPanel';
import { ensureLeadStages } from '@/lib/crm-leads';
import { listObjects, objectEntity } from '@/lib/crm-objects';
import { listFieldPermissions } from '@/lib/crm-field-perms';

export const dynamic = 'force-dynamic';

type SessionUser = Awaited<ReturnType<typeof requireUser>>;

/** Personas del workspace activo (owner + miembros): equipos, round-robin y cuotas. */
async function workspacePeople(user: SessionUser) {
  const members = user.team?.id
    ? await listMembers(user.team.id)
    : [{ user_id: user.id, email: user.email, name: user.name ?? null }];
  return members.map((m) => ({ id: m.user_id, label: m.name || m.email }));
}

/**
 * Ajustes del CRM en seis pestañas (?tab=): Equipo, Ventas, Datos,
 * Automatización, Integraciones e Importar y exportar. Cada pestaña carga
 * solo lo suyo; cada bloque se guarda solo.
 */
export default async function CrmSettingsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string; gmail?: string; from?: string }>;
}) {
  const sp = await props.searchParams;
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const admin = isWorkspaceAdmin(user);
  // El callback de Gmail vuelve con ?gmail=…: abre Integraciones.
  const tab = crmSettingsTab(sp.tab, sp.gmail);

  let body: React.ReactNode = null;

  if (tab === 'team') {
    const realUser = user.actingUser ?? user;
    const ownedTeams = await listOwnedTeams(realUser.id);
    // El team que podés gestionar: el tuyo, o el activo si sos admin ahí.
    const ownedTeam = ownedTeams[0] ?? (user.team && admin ? user.team : null);
    const [members, pendingInvites, memberTeams, people, visibility, salesTeams] = await Promise.all([
      ownedTeam ? listMembers(ownedTeam.id) : Promise.resolve([]),
      ownedTeam ? listPendingInvites(ownedTeam.id) : Promise.resolve([]),
      listMemberTeams(realUser.id),
      workspacePeople(user),
      getMemberVisibility(user.id),
      listSalesTeams(user.id),
    ]);
    const baseUrl = (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
    body = (
      <>
        <FormSection title={t('settings.team')} description={t('settings.teamDesc')}>
          <TeamPanel
            realEmail={realUser.email}
            ownedTeam={ownedTeam ? { id: ownedTeam.id, name: ownedTeam.name } : null}
            members={members.map((m) => ({ user_id: m.user_id, role: m.role, email: m.email, name: m.name }))}
            invites={pendingInvites.map((i) => ({ id: i.id, email: i.email, url: `${baseUrl}/en/invite/${i.token}` }))}
            memberTeams={memberTeams.map((m) => ({ id: m.id, name: m.name, owner_email: m.owner_email }))}
            canChangeRoles={ownedTeam !== null && ownedTeam.owner_id === realUser.id}
            activeTeamId={realUser.active_team_id ?? null}
            actingTeamName={user.actingUser && user.team ? user.team.name : null}
          />
        </FormSection>
        <FormSection title={t('access.title')} description={t('access.desc')}>
          <AccessPanel
            visibility={visibility}
            teams={salesTeams.map((x) => ({ id: x.id, name: x.name, members: x.members }))}
            people={people}
            canEdit={admin}
          />
        </FormSection>
      </>
    );
  } else if (tab === 'sales') {
    const people = await workspacePeople(user);
    const scope = await sessionScope(user);
    const [pipelines, crmSettings, rates, missing, quotas, dealFields, leadStages] = await Promise.all([
      listPipelinesWithStages(user.id),
      getCrmSettings(user.id),
      listExchangeRates(user.id),
      missingRates(user.id),
      quotaProgress(user.id, { ownerIds: scope, people: people.map((p) => ({ id: p.id, name: p.label })) }),
      listCustomFields(user.id, 'deals'),
      ensureLeadStages(user.id, {
        new: t('leads.defaultStages.new'),
        attempting: t('leads.defaultStages.attempting'),
        connected: t('leads.defaultStages.connected'),
        qualified: t('leads.defaultStages.qualified'),
        disqualified: t('leads.defaultStages.disqualified'),
      }),
    ]);
    body = (
      <>
        <FormSection title={t('leads.stagesTitle')} description={t('leads.stagesDesc')}>
          <LeadStagesEditor
            initial={leadStages.map((s) => ({ id: s.id, name: s.name, kind: s.kind, position: s.position }))}
            canEdit={admin}
          />
        </FormSection>
        <FormSection title={t('settings.pipelines')} description={t('settings.pipelinesDesc')}>
          <PipelinesEditor
            initialPipelines={pipelines}
            customFields={dealFields.map((f) => ({ name: f.name, label: f.label }))}
          />
        </FormSection>
        <FormSection title={t('quotas.title')} description={t('quotas.desc')}>
          <QuotasPanel progress={quotas} people={people} baseCurrency={crmSettings.baseCurrency} locale={locale} canEdit={admin} />
        </FormSection>
        <FormSection title={t('settings.currency')} description={t('settings.currencyDesc')}>
          <CurrencySettings
            baseCurrency={crmSettings.baseCurrency}
            rates={rates.map((r) => ({ currency: r.currency, rate: r.rate, updated_at: r.updated_at }))}
            missing={missing}
            canEdit={admin}
            locale={locale}
          />
        </FormSection>
        <QuoteSettings quoteAcceptMovesDeal={crmSettings.quoteAcceptMovesDeal} canEdit={admin} />
        <FormSection title={t('calls.settingsTitle')} description={t('calls.settingsDesc')}>
          <CallOutcomesSettings kind="call" outcomes={crmSettings.callOutcomes} custom={crmSettings.callOutcomesCustom} canEdit={admin} />
          <CallOutcomesSettings
            kind="whatsapp"
            outcomes={crmSettings.whatsappOutcomes}
            custom={crmSettings.whatsappOutcomesCustom}
            canEdit={admin}
          />
        </FormSection>
      </>
    );
  } else if (tab === 'data') {
    const [customFields, tags, objects, permissions, salesTeams] = await Promise.all([
      listCustomFields(user.id),
      listTags(user.id, undefined, await sessionScope(user)),
      listObjects(user.id),
      admin ? listFieldPermissions(user.id) : Promise.resolve([]),
      listSalesTeams(user.id),
    ]);
    const entityLabel = (entity: string): string => {
      const obj = objects.find((o) => objectEntity(o.id) === entity);
      if (obj) return obj.plural;
      return t.has(`settings.entities.${entity}`) ? t(`settings.entities.${entity}`) : entity;
    };
    body = (
      <>
        <FormSection title={t('settings.customFields')} description={t('settings.customFieldsDesc')}>
          <CustomFieldsPanel initialFields={customFields.filter((f) => !f.entity.startsWith('obj:'))} />
        </FormSection>
        <FormSection title={t('fieldPerms.title')} description={t('fieldPerms.desc')}>
          <FieldPermissionsPanel
            fields={customFields.map((f) => ({ id: f.id, name: f.name, label: f.label, entityLabel: entityLabel(f.entity) }))}
            teams={salesTeams.map((x) => ({ id: x.id, name: x.name }))}
            initialRules={permissions.map((r) => ({ field_id: r.field_id, subject: r.subject, access: r.access }))}
            canEdit={admin}
          />
        </FormSection>
        <FormSection title={t('settings.tags')} description={t('settings.tagsDesc')}>
          <TagsManager
            initialTags={tags.map((x) => ({
              id: x.id,
              name: x.name,
              color: x.color,
              contacts: x.contacts,
              companies: x.companies,
              deals: x.deals,
            }))}
          />
        </FormSection>
      </>
    );
  } else if (tab === 'automation') {
    const [people, assignmentRule, away, assignmentHistory, scoreRules, customFields] = await Promise.all([
      workspacePeople(user),
      getAssignmentRule(user.id),
      unavailablePeople(user.id),
      listAssignmentHistory(user.id, 15),
      listScoreRules(user.id),
      listCustomFields(user.id, 'contacts'),
    ]);
    body = (
      <>
        <FormSection title={t('assignment.title')} description={t('assignment.desc')}>
          <AssignmentPanel
            rule={{ enabled: assignmentRule.enabled, sources: assignmentRule.sources, pool: assignmentRule.pool }}
            unavailable={[...away]}
            history={assignmentHistory.map((h) => ({
              id: h.id,
              contact_id: h.contact_id,
              contact_name: h.contact_name,
              person_id: h.person_id,
              source: h.source,
              created_at: h.created_at,
            }))}
            people={people}
            selfId={realUserId(user)}
            canEdit={admin}
          />
        </FormSection>
        <FormSection title={t('scoring.title')} description={t('scoring.desc')}>
          <ScoringRulesPanel
            initialRules={scoreRules}
            customFields={customFields.map((cf) => ({ name: cf.name, label: cf.label }))}
            canEdit={admin}
          />
        </FormSection>
      </>
    );
  } else if (tab === 'integrations') {
    // Gmail es personal: el de la persona logueada (no el del dueño del workspace).
    const gmail = await getIntegration(realUserId(user), 'gmail');
    const [mailbox, emailSettings] = await Promise.all([
      gmail ? getMailboxSync(user.id, realUserId(user)) : Promise.resolve(null),
      getEmailSettings(user.id),
    ]);
    const lastSyncRaw = mailbox?.last_sync_at ?? gmail?.last_sync_at ?? null;
    const gmailLastSync = lastSyncRaw
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(`${lastSyncRaw.replace(' ', 'T')}Z`),
        )
      : null;
    body = (
      <>
        <FormSection title={t('settings.gmailTitle')} description={t('settings.gmailDesc')}>
          <GmailPanel
            connected={gmail !== null}
            email={gmail?.email ?? ''}
            lastSync={gmailLastSync}
            notice={sp.gmail ?? null}
            redirectUri={gmailRedirectUri()}
            canSend={gmail ? scopeAllowsSend(gmail.scope) : false}
          />
        </FormSection>
        <FormSection title={t('settings.trackingTitle')} description={t('settings.trackingDesc')}>
          <EmailTrackingSetting enabled={emailSettings.trackingEnabled} canEdit={admin} />
        </FormSection>
      </>
    );
  } else {
    // ?from=hubspot|pipedrive (estados vacíos, Cmd+K) abre directo el paso del token.
    const from = sp.from === 'hubspot' || sp.from === 'pipedrive' ? sp.from : null;
    body = (
      <>
        <FormSection title={t('settings.migrateTitle')} description={t('settings.migrateDesc')}>
          <CrmMigrationPanel canAdmin={admin} initialProvider={from} locale={locale} />
        </FormSection>
        <FormSection title={t('settings.importCta')} description={t('settings.importDesc')}>
          <ImportPanel />
        </FormSection>
        <FormSection title={t('settings.exportCta')} description={t('settings.exportTagline')}>
          {admin ? <ExportPanel locale={locale} /> : <p className="ui-help">{t('common.adminOnly')}</p>}
        </FormSection>
      </>
    );
  }

  return (
    <div className="app-page ui-page crm-settings-page">
      <LegacySettingsAnchor />
      <PageHeader title={t('settings.title')} description={t('settings.subtitle')} actions={<PlatformSettingsLink locale={locale} />} />
      <SettingsTabs
        mode="query"
        param="tab"
        label={t('settings.title')}
        items={CRM_SETTINGS_TABS.map((key) => ({ key, label: t(`settings.tabs.${key}`) }))}
        className="crm-settings"
      >
        {body}
      </SettingsTabs>
    </div>
  );
}

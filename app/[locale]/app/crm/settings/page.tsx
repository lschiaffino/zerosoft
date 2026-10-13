import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { getEmailSettings } from '@/lib/crm-email';
import { getMailboxSync } from '@/lib/crm-email-sync';
import { scopeAllowsSend } from '@/lib/gmail';
import { listCustomFields, listPipelinesWithStages } from '@/lib/crm';
import { getIntegration, gmailRedirectUri } from '@/lib/integrations';
import {
  listMemberTeams,
  listMembers,
  listOwnedTeams,
  listPendingInvites,
} from '@/lib/teams';
import PipelinesEditor from '@/components/crm/PipelinesEditor';
import CustomFieldsPanel from '@/components/crm/CustomFieldsPanel';
import ImportPanel from '@/components/crm/ImportPanel';
import ExportPanel from '@/components/crm/ExportPanel';
import GmailPanel from '@/components/crm/GmailPanel';
import TeamPanel from '@/components/crm/TeamPanel';
import EmailTrackingSetting from '@/components/crm/EmailTrackingSetting';
import TagsManager from '@/components/crm/TagsManager';
import CurrencySettings from '@/components/crm/CurrencySettings';
import { listTags } from '@/lib/crm-tags';
import { getCrmSettings, listExchangeRates, missingRates } from '@/lib/crm-currency';
import { getMemberVisibility, listSalesTeams, sessionScope } from '@/lib/crm-visibility';
import { getAssignmentRule, listAssignmentHistory, unavailablePeople } from '@/lib/crm-assignment';
import { listScoreRules } from '@/lib/crm-scoring';
import { quotaProgress } from '@/lib/crm-quotas';
import AccessPanel from '@/components/crm/AccessPanel';
import AssignmentPanel from '@/components/crm/AssignmentPanel';
import ScoringRulesPanel from '@/components/crm/ScoringRulesPanel';
import QuotasPanel from '@/components/crm/QuotasPanel';

export const dynamic = 'force-dynamic';

export default async function CrmSettingsPage(
  props: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ gmail?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const pipelines = await listPipelinesWithStages(user.id);
  const customFields = await listCustomFields(user.id);
  // Gmail es personal: el de la persona logueada (no el del dueño del workspace).
  const gmail = await getIntegration(realUserId(user), 'gmail');
  const mailbox = gmail ? await getMailboxSync(user.id, realUserId(user)) : null;
  const lastSyncRaw = mailbox?.last_sync_at ?? gmail?.last_sync_at ?? null;
  const gmailLastSync = lastSyncRaw
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(`${lastSyncRaw.replace(' ', 'T')}Z`),
      )
    : null;
  const emailSettings = await getEmailSettings(user.id);
  const [tags, crmSettings, rates, missing] = await Promise.all([
    listTags(user.id, undefined, await sessionScope(user)),
    getCrmSettings(user.id),
    listExchangeRates(user.id),
    missingRates(user.id),
  ]);

  // Teams: todo se resuelve sobre tu identidad real (no el workspace activo).
  const realUser = user.actingUser ?? user;
  const ownedTeams = await listOwnedTeams(realUser.id);
  // El team que podés gestionar: el tuyo, o el activo si sos admin ahí.
  const ownedTeam = ownedTeams[0] ?? (user.team && isWorkspaceAdmin(user) ? user.team : null);
  const canChangeRoles = ownedTeam !== null && ownedTeam.owner_id === realUser.id;
  const [members, pendingInvites, memberTeams] = await Promise.all([
    ownedTeam ? listMembers(ownedTeam.id) : Promise.resolve([]),
    ownedTeam ? listPendingInvites(ownedTeam.id) : Promise.resolve([]),
    listMemberTeams(realUser.id),
  ]);
  // Personas del workspace activo (owner + members) para equipos, round-robin y cuotas.
  const workspaceMembers = user.team?.id
    ? await listMembers(user.team.id)
    : [{ user_id: user.id, email: user.email, name: user.name ?? null }];
  const people = workspaceMembers.map((m) => ({ id: m.user_id, label: m.name || m.email }));
  const scope = await sessionScope(user);
  const [visibility, salesTeams, assignmentRule, away, assignmentHistory, scoreRules, quotas] = await Promise.all([
    getMemberVisibility(user.id),
    listSalesTeams(user.id),
    getAssignmentRule(user.id),
    unavailablePeople(user.id),
    listAssignmentHistory(user.id, 15),
    listScoreRules(user.id),
    quotaProgress(user.id, { ownerIds: scope, people: people.map((p) => ({ id: p.id, name: p.label })) }),
  ]);
  const baseUrl = (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
  const inviteUrls = pendingInvites.map((i) => ({
    id: i.id,
    email: i.email,
    url: `${baseUrl}/en/invite/${i.token}`,
  }));

  const sections = [
    { id: 'team', label: t('settings.team') },
    { id: 'access', label: t('access.title') },
    { id: 'assignment', label: t('assignment.title') },
    { id: 'scoring', label: t('scoring.title') },
    { id: 'quotas', label: t('quotas.title') },
    { id: 'integrations', label: t('settings.integrations') },
    { id: 'pipelines', label: t('settings.pipelines') },
    { id: 'fields', label: t('settings.customFields') },
    { id: 'tags', label: t('settings.tags') },
    { id: 'currency', label: t('settings.currency') },
    { id: 'import', label: t('settings.importCta') },
    { id: 'export', label: t('settings.exportCta') },
  ];

  // Layout de ajustes tipo Linear/Apple: índice a la izquierda y secciones
  // separadas por hairlines (título + descripción arriba, controles abajo),
  // sin tarjetas apiladas.
  return (
    <div className="app-page crm-settings-page">
      <h1 className="app-title">{t('settings.title')}</h1>

      <div className="crm-settings">
        <nav className="crm-settings-nav" aria-label={t('settings.title')}>
          {sections.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {s.label}
            </a>
          ))}
        </nav>

        <div className="crm-settings-body">
          <section className="crm-set" id="team">
            <header className="crm-set-head">
              <h2>{t('settings.team')}</h2>
              <p className="muted">{t('settings.teamDesc')}</p>
            </header>
            <TeamPanel
              realEmail={realUser.email}
              ownedTeam={ownedTeam ? { id: ownedTeam.id, name: ownedTeam.name } : null}
              members={members.map((m) => ({
                user_id: m.user_id,
                role: m.role,
                email: m.email,
                name: m.name,
              }))}
              invites={inviteUrls}
              memberTeams={memberTeams.map((m) => ({ id: m.id, name: m.name, owner_email: m.owner_email }))}
              canChangeRoles={canChangeRoles}
              activeTeamId={realUser.active_team_id ?? null}
              actingTeamName={user.actingUser && user.team ? user.team.name : null}
            />
          </section>

          <section className="crm-set" id="access">
            <header className="crm-set-head">
              <h2>{t('access.title')}</h2>
              <p className="muted">{t('access.desc')}</p>
            </header>
            <AccessPanel
              visibility={visibility}
              teams={salesTeams.map((x) => ({ id: x.id, name: x.name, members: x.members }))}
              people={people}
              canEdit={isWorkspaceAdmin(user)}
            />
          </section>

          <section className="crm-set" id="assignment">
            <header className="crm-set-head">
              <h2>{t('assignment.title')}</h2>
              <p className="muted">{t('assignment.desc')}</p>
            </header>
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
              canEdit={isWorkspaceAdmin(user)}
            />
          </section>

          <section className="crm-set" id="scoring">
            <header className="crm-set-head">
              <h2>{t('scoring.title')}</h2>
              <p className="muted">{t('scoring.desc')}</p>
            </header>
            <ScoringRulesPanel
              initialRules={scoreRules}
              customFields={customFields.filter((cf) => cf.entity === 'contacts').map((cf) => ({ name: cf.name, label: cf.label }))}
              canEdit={isWorkspaceAdmin(user)}
            />
          </section>

          <section className="crm-set" id="quotas">
            <header className="crm-set-head">
              <h2>{t('quotas.title')}</h2>
              <p className="muted">{t('quotas.desc')}</p>
            </header>
            <QuotasPanel
              progress={quotas}
              people={people}
              baseCurrency={crmSettings.baseCurrency}
              locale={locale}
              canEdit={isWorkspaceAdmin(user)}
            />
          </section>

          <section className="crm-set" id="integrations">
            <header className="crm-set-head">
              <h2>{t('settings.integrations')}</h2>
              <p className="muted">{t('settings.gmailDesc')}</p>
            </header>
            <GmailPanel
              connected={gmail !== null}
              email={gmail?.email ?? ''}
              lastSync={gmailLastSync}
              notice={searchParams.gmail ?? null}
              redirectUri={gmailRedirectUri()}
              canSend={gmail ? scopeAllowsSend(gmail.scope) : false}
            />
            <EmailTrackingSetting enabled={emailSettings.trackingEnabled} canEdit={isWorkspaceAdmin(user)} />
          </section>

          <section className="crm-set" id="pipelines">
            <header className="crm-set-head">
              <h2>{t('settings.pipelines')}</h2>
              <p className="muted">{t('settings.pipelinesDesc')}</p>
            </header>
            <PipelinesEditor initialPipelines={pipelines} />
          </section>

          <section className="crm-set" id="fields">
            <header className="crm-set-head">
              <h2>{t('settings.customFields')}</h2>
              <p className="muted">{t('settings.customFieldsDesc')}</p>
            </header>
            <CustomFieldsPanel initialFields={customFields} />
          </section>

          <section className="crm-set" id="tags">
            <header className="crm-set-head">
              <h2>{t('settings.tags')}</h2>
              <p className="muted">{t('settings.tagsDesc')}</p>
            </header>
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
          </section>

          <section className="crm-set" id="currency">
            <header className="crm-set-head">
              <h2>{t('settings.currency')}</h2>
              <p className="muted">{t('settings.currencyDesc')}</p>
            </header>
            <CurrencySettings
              baseCurrency={crmSettings.baseCurrency}
              quoteAcceptMovesDeal={crmSettings.quoteAcceptMovesDeal}
              rates={rates.map((r) => ({ currency: r.currency, rate: r.rate, updated_at: r.updated_at }))}
              missing={missing}
              canEdit={isWorkspaceAdmin(user)}
              locale={locale}
            />
          </section>

          <section className="crm-set" id="import">
            <header className="crm-set-head">
              <h2>{t('settings.importCta')}</h2>
            </header>
            <ImportPanel />
          </section>

          <section className="crm-set" id="export">
            <header className="crm-set-head">
              <h2>{t('settings.exportCta')}</h2>
            </header>
            {isWorkspaceAdmin(user) ? (
              <ExportPanel locale={locale} />
            ) : (
              <p className="muted">{t('common.adminOnly')}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

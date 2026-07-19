import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
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

export const dynamic = 'force-dynamic';

export default async function CrmSettingsPage({
  params: { locale },
  searchParams,
}: {
  params: { locale: string };
  searchParams: { gmail?: string };
}) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const pipelines = await listPipelinesWithStages(user.id);
  const customFields = await listCustomFields(user.id);
  const gmail = await getIntegration(user.id, 'gmail');

  const gmailLastSync = gmail?.last_sync_at
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(`${gmail.last_sync_at.replace(' ', 'T')}Z`),
      )
    : null;

  // Teams: todo se resuelve sobre tu identidad real (no el workspace activo).
  const realUser = user.actingUser ?? user;
  const ownedTeams = await listOwnedTeams(realUser.id);
  const ownedTeam = ownedTeams[0] ?? null;
  const [members, pendingInvites, memberTeams] = await Promise.all([
    ownedTeam ? listMembers(ownedTeam.id) : Promise.resolve([]),
    ownedTeam ? listPendingInvites(ownedTeam.id) : Promise.resolve([]),
    listMemberTeams(realUser.id),
  ]);
  const baseUrl = (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
  const inviteUrls = pendingInvites.map((i) => ({
    id: i.id,
    email: i.email,
    url: `${baseUrl}/en/invite/${i.token}`,
  }));

  return (
    <div className="app-page">
      <h1 className="app-title">{t('settings.title')}</h1>

      <section className="panel">
        <p className="section-label">{t('settings.team')}</p>
        <p className="muted panel-desc">{t('settings.teamDesc')}</p>
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
          activeTeamId={realUser.active_team_id ?? null}
          actingTeamName={user.actingUser && user.team ? user.team.name : null}
        />
      </section>

      <section className="panel">
        <p className="section-label">{t('settings.integrations')}</p>
        <p className="muted panel-desc">{t('settings.gmailDesc')}</p>
        <GmailPanel
          connected={gmail !== null}
          email={gmail?.email ?? ''}
          lastSync={gmailLastSync}
          notice={searchParams.gmail ?? null}
          redirectUri={gmailRedirectUri()}
        />
      </section>

      <section className="panel">
        <p className="section-label">{t('settings.pipelines')}</p>
        <p className="muted panel-desc">{t('settings.pipelinesDesc')}</p>
        <PipelinesEditor initialPipelines={pipelines} />
      </section>

      <section className="panel">
        <p className="section-label">{t('settings.customFields')}</p>
        <p className="muted panel-desc">{t('settings.customFieldsDesc')}</p>
        <CustomFieldsPanel initialFields={customFields} />
      </section>

      <section className="panel">
        <p className="section-label">{t('settings.importCta')}</p>
        <ImportPanel />
      </section>

      <section className="panel">
        <p className="section-label">{t('settings.exportCta')}</p>
        <ExportPanel locale={locale} />
      </section>
    </div>
  );
}

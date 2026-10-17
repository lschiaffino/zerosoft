'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { invalidateWorkspaceLabels } from '@/components/track/LabelPicker';

interface MemberInfo {
  user_id: string;
  role: string;
  email: string;
  name: string | null;
}

interface InviteInfo {
  id: string;
  email: string;
  url: string;
}

interface MemberTeamInfo {
  id: string;
  name: string;
  owner_email: string;
}

interface TeamPanelProps {
  realEmail: string;
  ownedTeam: { id: string; name: string } | null;
  members: MemberInfo[];
  invites: InviteInfo[];
  memberTeams: MemberTeamInfo[];
  /** Solo el owner puede cambiar roles. */
  canChangeRoles: boolean;
  activeTeamId: string | null;
  actingTeamName: string | null;
}

/** Gestión de team en settings: workspaces, miembros e invitaciones por link. */
export default function TeamPanel({
  realEmail,
  ownedTeam,
  members,
  invites,
  memberTeams,
  canChangeRoles,
  activeTeamId,
  actingTeamName,
}: TeamPanelProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [teamName, setTeamName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function call(input: string, init?: RequestInit): Promise<Response | null> {
    setBusy(true);
    setError(null);
    const res = await fetch(input, init).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      setError(t('settings.teamError'));
      return null;
    }
    return res;
  }

  async function refresh() {
    router.refresh();
  }

  async function switchTo(teamId: string | null) {
    if (!(await call('/api/teams/switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teamId }),
    }))) return;
    // Los labels de Track cacheados son del workspace anterior.
    invalidateWorkspaceLabels();
    refresh();
  }

  async function createTeam() {
    if (!teamName.trim() || busy) return;
    if (!(await call('/api/teams', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: teamName.trim() }),
    }))) return;
    setTeamName('');
    refresh();
  }

  async function createInvite() {
    if (!inviteEmail.trim() || !ownedTeam || busy) return;
    const res = await call('/api/teams/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: ownedTeam.id, email: inviteEmail.trim() }),
    });
    if (!res) return;
    const data = (await res.json().catch(() => null)) as { url?: string } | null;
    setCreatedUrl(data?.url ?? null);
    setInviteEmail('');
    refresh();
  }

  async function revokeInvite(id: string) {
    if (!ownedTeam) return;
    if (!(await call(`/api/teams/invites/${id}?teamId=${ownedTeam.id}`, { method: 'DELETE' })))
      return;
    refresh();
  }

  async function removeMember(userId: string, email: string) {
    if (!ownedTeam) return;
    if (!window.confirm(t('settings.teamRemoveConfirm', { email }))) return;
    if (!(await call(`/api/teams/members/${userId}?teamId=${ownedTeam.id}`, { method: 'DELETE' })))
      return;
    refresh();
  }

  async function changeRole(userId: string, role: 'admin' | 'member') {
    if (!ownedTeam) return;
    if (!(await call(`/api/teams/members/${userId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: ownedTeam.id, role }),
    }))) return;
    refresh();
  }

  function roleLabel(role: string): string {
    if (role === 'owner') return t('settings.teamOwner');
    if (role === 'admin') return t('settings.teamAdmin');
    return t('settings.teamMember');
  }

  async function leaveTeam(teamId: string, name: string) {
    if (!window.confirm(t('settings.teamLeaveConfirm', { team: name }))) return;
    // Salir = removerte a vos mismo; tu id real lo resuelve el server.
    const res = await call(`/api/teams/members/self?teamId=${teamId}`, { method: 'DELETE' });
    if (!res) return;
    refresh();
  }

  async function copy(text: string, tag: string) {
    await navigator.clipboard.writeText(text).catch(() => null);
    setCopied(tag);
    setTimeout(() => setCopied((c) => (c === tag ? null : c)), 1500);
  }

  return (
    <div className="team-panel">
      {actingTeamName && (
        <p className="team-acting">{t('settings.teamActing', { team: actingTeamName })}</p>
      )}

      {/* Workspaces */}
      <h3 className="crm-subhead">{t('settings.teamWorkspaces')}</h3>
      <ul className="recent-list team-list">
        <li className="team-row">
          <span className="recent-name">{t('settings.teamPersonal')}</span>
          <span className="muted recent-meta">{realEmail}</span>
          {activeTeamId === null || activeTeamId === ownedTeam?.id ? (
            <span className="badge">{t('settings.teamActive')}</span>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-small"
              disabled={busy}
              onClick={() => switchTo(null)}
            >
              {t('settings.teamSwitch')}
            </button>
          )}
        </li>
        {memberTeams.map((m) => (
          <li key={m.id} className="team-row">
            <span className="recent-name">{m.name}</span>
            <span className="muted recent-meta">{m.owner_email}</span>
            <span className="team-row-actions">
              {activeTeamId === m.id ? (
                <span className="badge">{t('settings.teamActive')}</span>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  disabled={busy}
                  onClick={() => switchTo(m.id)}
                >
                  {t('settings.teamSwitch')}
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-small"
                disabled={busy}
                onClick={() => leaveTeam(m.id, m.name)}
              >
                {t('settings.teamLeave')}
              </button>
            </span>
          </li>
        ))}
      </ul>

      {/* Tu team (owner) */}
      <h3 className="crm-subhead">{t('settings.teamYours')}</h3>
      {ownedTeam ? (
        <>
          <ul className="recent-list team-list">
            {members.map((m) => (
              <li key={m.user_id} className="team-row">
                <span className="recent-name">{m.name || m.email}</span>
                <span className="muted recent-meta">{m.email}</span>
                <span className="team-row-actions">
                  {canChangeRoles && m.role !== 'owner' ? (
                    <select
                      className="input input-small"
                      value={m.role === 'admin' ? 'admin' : 'member'}
                      disabled={busy}
                      aria-label={t('settings.teamRole')}
                      onChange={(e) => changeRole(m.user_id, e.target.value as 'admin' | 'member')}
                    >
                      <option value="member">{t('settings.teamMember')}</option>
                      <option value="admin">{t('settings.teamAdmin')}</option>
                    </select>
                  ) : (
                    <span className="badge">{roleLabel(m.role)}</span>
                  )}
                  {m.role !== 'owner' && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      disabled={busy}
                      onClick={() => removeMember(m.user_id, m.email)}
                    >
                      {t('settings.teamRemove')}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>

          <div className="team-invite-form">
            <input
              className="input"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder={t('settings.teamInvitePh')}
              aria-label={t('settings.teamInvitePh')}
            />
            <button
              type="button"
              className="btn btn-solid btn-small"
              disabled={busy || !inviteEmail.trim()}
              onClick={createInvite}
            >
              {t('settings.teamInviteCreate')}
            </button>
          </div>
          <p className="muted">{t('settings.teamInviteNote')}</p>

          {createdUrl && (
            <div className="team-created">
              <span className="team-created-url data">{createdUrl}</span>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => copy(createdUrl, 'new')}
              >
                {copied === 'new' ? t('settings.teamCopied') : t('settings.teamCopy')}
              </button>
            </div>
          )}

          {invites.length > 0 && (
            <>
              <h3 className="crm-subhead">{t('settings.teamPending')}</h3>
              <ul className="recent-list team-list">
                {invites.map((i) => (
                  <li key={i.id} className="team-row">
                    <span className="recent-name">{i.email}</span>
                    <span className="team-row-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-small"
                        onClick={() => copy(i.url, i.id)}
                      >
                        {copied === i.id ? t('settings.teamCopied') : t('settings.teamCopy')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-small"
                        disabled={busy}
                        onClick={() => revokeInvite(i.id)}
                      >
                        {t('settings.teamRevoke')}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <div className="team-invite-form">
          <input
            className="input"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder={t('settings.teamNamePh')}
            aria-label={t('settings.teamNamePh')}
            maxLength={80}
          />
          <button
            type="button"
            className="btn btn-solid btn-small"
            disabled={busy || !teamName.trim()}
            onClick={createTeam}
          >
            {t('settings.teamCreate')}
          </button>
        </div>
      )}

      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

interface Person {
  id: string;
  label: string;
}

interface Team {
  id: string;
  name: string;
  members: string[];
}

interface Props {
  visibility: 'all' | 'mine' | 'team';
  teams: Team[];
  people: Person[];
  canEdit: boolean;
}

/**
 * Visibilidad de registros para members (todos / solo los suyos / los de su
 * equipo) y equipos de venta (grupos de members que comparten visibilidad).
 */
export default function AccessPanel({ visibility: initialVisibility, teams: initialTeams, people, canEdit }: Props) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [visibility, setVisibility] = useState(initialVisibility);
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveVisibility(v: Props['visibility']) {
    setVisibility(v);
    setError(null);
    const res = await fetch('/api/crm/visibility', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visibility: v }),
    }).catch(() => null);
    if (!res?.ok) setError(t('errors.generic'));
    else router.refresh();
  }

  async function createTeam() {
    if (!newName.trim() || busy) return;
    setBusy(true);
    const res = await fetch('/api/crm/sales-teams', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), members: [] }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      const team = (await res.json()) as Team;
      setTeams((prev) => [...prev, team]);
      setNewName('');
    } else setError(t('errors.generic'));
  }

  async function patchTeam(id: string, patch: Partial<Pick<Team, 'name' | 'members'>>) {
    setTeams((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const res = await fetch(`/api/crm/sales-teams/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => null);
    if (!res?.ok) setError(t('errors.generic'));
  }

  async function deleteTeam(id: string) {
    if (!confirm(t('access.deleteTeamConfirm'))) return;
    const res = await fetch(`/api/crm/sales-teams/${id}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) setTeams((prev) => prev.filter((x) => x.id !== id));
  }

  return (
    <div className="access-panel">
      <fieldset className="access-vis" disabled={!canEdit}>
        <legend className="section-label">{t('access.visibility')}</legend>
        {(['all', 'mine', 'team'] as const).map((v) => (
          <label key={v} className="access-radio">
            <input
              type="radio"
              name="crm-visibility"
              value={v}
              checked={visibility === v}
              onChange={() => saveVisibility(v)}
              data-testid={`visibility-${v}`}
            />
            <span>
              <strong>{t(`access.vis.${v}`)}</strong>
              <span className="muted"> — {t(`access.visDesc.${v}`)}</span>
            </span>
          </label>
        ))}
        <p className="muted access-note">{t('access.adminsSeeAll')}</p>
      </fieldset>

      <div className="access-teams">
        <p className="section-label">{t('access.teams')}</p>
        <p className="muted access-note">{t('access.teamsDesc')}</p>
        {teams.length === 0 && <p className="muted">{t('access.noTeams')}</p>}
        <ul className="access-team-list">
          {teams.map((team) => (
            <li key={team.id} className="access-team">
              <div className="access-team-head">
                <input
                  className="input"
                  defaultValue={team.name}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== team.name && patchTeam(team.id, { name: e.target.value.trim() })}
                  aria-label={t('access.teamName')}
                  disabled={!canEdit}
                />
                {canEdit && (
                  <button type="button" className="icon-btn danger" onClick={() => deleteTeam(team.id)}>
                    {t('common.delete')}
                  </button>
                )}
              </div>
              <div className="access-members">
                {people.map((p) => (
                  <label key={p.id} className="fb-check">
                    <input
                      type="checkbox"
                      checked={team.members.includes(p.id)}
                      onChange={(e) =>
                        patchTeam(team.id, {
                          members: e.target.checked ? [...team.members, p.id] : team.members.filter((m) => m !== p.id),
                        })
                      }
                      disabled={!canEdit}
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="access-new">
            <input
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createTeam()}
              placeholder={t('access.teamNamePh')}
              aria-label={t('access.teamName')}
            />
            <button type="button" className="btn btn-small" onClick={createTeam} disabled={busy || !newName.trim()}>
              {t('access.createTeam')}
            </button>
          </div>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { GroupsPerson, LabelDto } from '@/lib/groups';
import type { AssignRuleDto, TeamDto } from '@/lib/groups-inbox';
import { Modal, api, useErrorText, useToast } from './ui';

interface NumberLite {
  id: string;
  name: string;
  phone: string;
}

interface Props {
  teams: TeamDto[];
  rules: AssignRuleDto[];
  people: GroupsPerson[];
  numbers: NumberLite[];
  labels: LabelDto[];
  availability: Record<string, boolean>;
  canEdit: boolean;
}

type RuleDraft = {
  id?: string;
  name: string;
  numberId: string;
  labelId: string;
  kind: string;
  target: 'team' | 'people';
  teamId: string;
  personIds: string[];
};

const emptyRule = (teams: TeamDto[]): RuleDraft => ({
  name: '',
  numberId: '',
  labelId: '',
  kind: '',
  target: teams.length ? 'team' : 'people',
  teamId: teams[0]?.id ?? '',
  personIds: [],
});

/**
 * Ajustes > Asignación: equipos de la bandeja (para asignar chats y rotar) y
 * reglas round-robin (por número, etiqueta o tipo de chat, a un equipo o a
 * personas, solo entre quienes están disponibles).
 */
export default function AssignmentSettings(props: Props) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  const [teams, setTeams] = useState(props.teams);
  const [rules, setRules] = useState(props.rules);
  const [teamDraft, setTeamDraft] = useState<{ id?: string; name: string; memberIds: string[] } | null>(null);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [removing, setRemoving] = useState<{ kind: 'team' | 'rule'; id: string; name: string } | null>(null);

  const personName = (id: string) => {
    const p = props.people.find((x) => x.id === id);
    return p ? p.name || p.email : '';
  };
  const available = (id: string) => props.availability[id] !== false;

  async function saveTeam() {
    if (!teamDraft) return;
    setBusy(true);
    setFormError('');
    const body = { name: teamDraft.name, memberIds: teamDraft.memberIds };
    const res = teamDraft.id
      ? await api<TeamDto>(`/api/groups/teams/${teamDraft.id}`, { method: 'PATCH', body })
      : await api<TeamDto>('/api/groups/teams', { body });
    setBusy(false);
    if (!res.data) return setFormError(errText(res.error));
    const saved = res.data;
    setTeams((list) => [...list.filter((x) => x.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
    setTeamDraft(null);
    showToast(t('common.saved'));
  }

  async function saveRule() {
    if (!ruleDraft) return;
    setBusy(true);
    setFormError('');
    const body = {
      name: ruleDraft.name,
      numberId: ruleDraft.numberId || null,
      labelId: ruleDraft.labelId || null,
      kind: ruleDraft.kind || null,
      teamId: ruleDraft.target === 'team' ? ruleDraft.teamId || null : null,
      personIds: ruleDraft.target === 'people' ? ruleDraft.personIds : [],
    };
    const res = ruleDraft.id
      ? await api<AssignRuleDto>(`/api/groups/rules/${ruleDraft.id}`, { method: 'PATCH', body })
      : await api<AssignRuleDto>('/api/groups/rules', { body });
    setBusy(false);
    if (!res.data) return setFormError(errText(res.error));
    const saved = res.data;
    setRules((list) => (list.some((x) => x.id === saved.id) ? list.map((x) => (x.id === saved.id ? saved : x)) : [...list, saved]));
    setRuleDraft(null);
    showToast(t('common.saved'));
  }

  async function toggleRule(r: AssignRuleDto) {
    // Optimista: el switch cambia ya y vuelve atrás si el servidor no acepta.
    setRules((list) => list.map((x) => (x.id === r.id ? { ...x, enabled: !r.enabled } : x)));
    const res = await api<AssignRuleDto>(`/api/groups/rules/${r.id}`, { method: 'PATCH', body: { enabled: !r.enabled } });
    if (res.data) setRules((list) => list.map((x) => (x.id === r.id ? res.data! : x)));
    else {
      setRules((list) => list.map((x) => (x.id === r.id ? r : x)));
      showToast(errText(res.error), true);
    }
  }

  async function remove() {
    if (!removing) return;
    const res = await api(`/api/groups/${removing.kind === 'team' ? 'teams' : 'rules'}/${removing.id}`, { method: 'DELETE' });
    if (!res.data) showToast(errText(res.error), true);
    else if (removing.kind === 'team') {
      setTeams((list) => list.filter((x) => x.id !== removing.id));
      setRules((list) => list.map((r) => (r.teamId === removing.id ? { ...r, teamId: null, enabled: false } : r)));
    } else setRules((list) => list.filter((x) => x.id !== removing.id));
    setRemoving(null);
  }

  function describe(r: AssignRuleDto): string {
    const when: string[] = [];
    if (r.numberId) when.push(props.numbers.find((n) => n.id === r.numberId)?.name ?? '');
    if (r.labelId) when.push(props.labels.find((l) => l.id === r.labelId)?.name ?? '');
    if (r.kind) when.push(t(r.kind === 'group' ? 'assign.kindGroups' : 'assign.kindDms'));
    const who = r.teamId ? teams.find((x) => x.id === r.teamId)?.name ?? '' : r.personIds.map(personName).filter(Boolean).join(', ');
    return t('assign.ruleSummary', { when: when.filter(Boolean).join(' · ') || t('assign.anyChat'), who: who || t('assign.nobody') });
  }

  return (
    <div className="ui-fields">
      <section className="gr-settings-block" aria-labelledby="gr-teams-title">
        <div className="gr-settings-head">
          <h2 id="gr-teams-title" className="gr-settings-title">
            {t('assign.teams')}
          </h2>
          {props.canEdit && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTeamDraft({ name: '', memberIds: [] })}>
              {t('assign.newTeam')}
            </button>
          )}
        </div>
        <p className="ui-help">{t('assign.teamsIntro')}</p>
        {teams.length === 0 ? (
          <p className="ui-help">{t('assign.noTeams')}</p>
        ) : (
          <ul className="gr-mini-list">
            {teams.map((tm) => (
              <li key={tm.id}>
                <strong>{tm.name}</strong>
                <span className="ui-help">{tm.memberIds.map(personName).filter(Boolean).join(', ') || t('assign.noMembers')}</span>
                {props.canEdit && (
                  <>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTeamDraft({ id: tm.id, name: tm.name, memberIds: tm.memberIds })}>
                      {t('assign.edit')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm gr-danger" onClick={() => setRemoving({ kind: 'team', id: tm.id, name: tm.name })}>
                      {t('common.delete')}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="gr-settings-block" aria-labelledby="gr-rules-title">
        <div className="gr-settings-head">
          <h2 id="gr-rules-title" className="gr-settings-title">
            {t('assign.rules')}
          </h2>
          {props.canEdit && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRuleDraft(emptyRule(teams))}>
              {t('assign.newRule')}
            </button>
          )}
        </div>
        <p className="ui-help">{t('assign.rulesIntro')}</p>
        {rules.length === 0 ? (
          <p className="ui-help">{t('assign.noRules')}</p>
        ) : (
          <ul className="gr-mini-list">
            {rules.map((r) => (
              <li key={r.id}>
                <strong>{r.name}</strong>
                <span className="ui-help">{describe(r)}</span>
                {r.lastPersonId && <span className="ui-help">{t('assign.lastPerson', { name: personName(r.lastPersonId) })}</span>}
                <label className="gr-toggle">
                  <input type="checkbox" checked={r.enabled} onChange={() => void toggleRule(r)} disabled={!props.canEdit} />
                  {r.enabled ? t('assign.on') : t('assign.off')}
                </label>
                {props.canEdit && (
                  <>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        setRuleDraft({
                          id: r.id,
                          name: r.name,
                          numberId: r.numberId ?? '',
                          labelId: r.labelId ?? '',
                          kind: r.kind ?? '',
                          target: r.teamId ? 'team' : 'people',
                          teamId: r.teamId ?? teams[0]?.id ?? '',
                          personIds: r.personIds,
                        })
                      }
                    >
                      {t('assign.edit')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm gr-danger" onClick={() => setRemoving({ kind: 'rule', id: r.id, name: r.name })}>
                      {t('common.delete')}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="gr-settings-block" aria-labelledby="gr-avail-title">
        <h2 id="gr-avail-title" className="gr-settings-title">
          {t('assign.availability')}
        </h2>
        <p className="ui-help">{t('assign.availabilityIntro')}</p>
        <ul className="gr-mini-list">
          {props.people.map((p) => (
            <li key={p.id}>
              <span>
                <i className={`gr-presence-dot${available(p.id) ? ' is-on' : ''}`} aria-hidden="true" /> {p.name || p.email}
              </span>
              <span className="ui-help">{available(p.id) ? t('inbox.available') : t('inbox.away')}</span>
            </li>
          ))}
        </ul>
      </section>

      <Modal
        open={!!teamDraft}
        title={teamDraft?.id ? t('assign.editTeam') : t('assign.newTeam')}
        onClose={() => setTeamDraft(null)}
        onSubmit={() => void saveTeam()}
        busy={busy}
        foot={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setTeamDraft(null)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={!teamDraft?.name.trim()} aria-busy={busy || undefined}>
              {t('common.save')}
            </button>
          </>
        }
      >
        {teamDraft && (
          <div className="ui-fields">
            <label className="ui-field">
              <span className="label">{t('assign.teamName')}</span>
              <input className="input" value={teamDraft.name} maxLength={60} autoFocus onChange={(e) => setTeamDraft({ ...teamDraft, name: e.target.value })} />
            </label>
            <fieldset className="ui-field gr-checks">
              <legend className="label">{t('assign.members')}</legend>
              {props.people.map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    checked={teamDraft.memberIds.includes(p.id)}
                    onChange={(e) =>
                      setTeamDraft({
                        ...teamDraft,
                        memberIds: e.target.checked ? [...teamDraft.memberIds, p.id] : teamDraft.memberIds.filter((x) => x !== p.id),
                      })
                    }
                  />
                  {p.name || p.email}
                </label>
              ))}
            </fieldset>
            {formError && (
              <p className="ui-error" role="alert">
                {formError}
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={!!ruleDraft}
        title={ruleDraft?.id ? t('assign.editRule') : t('assign.newRule')}
        onClose={() => setRuleDraft(null)}
        onSubmit={() => void saveRule()}
        busy={busy}
        wide
        foot={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setRuleDraft(null)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={!ruleDraft?.name.trim()} aria-busy={busy || undefined}>
              {t('common.save')}
            </button>
          </>
        }
      >
        {ruleDraft && (
          <div className="ui-fields">
            <label className="ui-field">
              <span className="label">{t('assign.ruleName')}</span>
              <input className="input" value={ruleDraft.name} maxLength={60} autoFocus onChange={(e) => setRuleDraft({ ...ruleDraft, name: e.target.value })} />
            </label>
            <p className="ui-help">{t('assign.conditions')}</p>
            <div className="gr-rule-grid">
              <label className="ui-field">
                <span className="label">{t('assign.number')}</span>
                <select className="select" value={ruleDraft.numberId} onChange={(e) => setRuleDraft({ ...ruleDraft, numberId: e.target.value })}>
                  <option value="">{t('assign.anyNumber')}</option>
                  {props.numbers.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                      {n.phone ? ` +${n.phone}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ui-field">
                <span className="label">{t('assign.label')}</span>
                <select className="select" value={ruleDraft.labelId} onChange={(e) => setRuleDraft({ ...ruleDraft, labelId: e.target.value })}>
                  <option value="">{t('assign.anyLabel')}</option>
                  {props.labels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ui-field">
                <span className="label">{t('assign.kind')}</span>
                <select className="select" value={ruleDraft.kind} onChange={(e) => setRuleDraft({ ...ruleDraft, kind: e.target.value })}>
                  <option value="">{t('assign.anyKind')}</option>
                  <option value="group">{t('assign.kindGroups')}</option>
                  <option value="dm">{t('assign.kindDms')}</option>
                </select>
              </label>
            </div>
            <fieldset className="ui-field gr-checks">
              <legend className="label">{t('assign.rotateAmong')}</legend>
              <label>
                <input type="radio" name="gr-rule-target" checked={ruleDraft.target === 'team'} disabled={teams.length === 0} onChange={() => setRuleDraft({ ...ruleDraft, target: 'team' })} />
                {t('assign.aTeam')}
              </label>
              <label>
                <input type="radio" name="gr-rule-target" checked={ruleDraft.target === 'people'} onChange={() => setRuleDraft({ ...ruleDraft, target: 'people' })} />
                {t('assign.somePeople')}
              </label>
            </fieldset>
            {ruleDraft.target === 'team' ? (
              <label className="ui-field">
                <span className="label">{t('assign.team')}</span>
                <select className="select" value={ruleDraft.teamId} onChange={(e) => setRuleDraft({ ...ruleDraft, teamId: e.target.value })}>
                  {teams.map((tm) => (
                    <option key={tm.id} value={tm.id}>
                      {tm.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <fieldset className="ui-field gr-checks">
                <legend className="label">{t('assign.people')}</legend>
                {props.people.map((p) => (
                  <label key={p.id}>
                    <input
                      type="checkbox"
                      checked={ruleDraft.personIds.includes(p.id)}
                      onChange={(e) =>
                        setRuleDraft({
                          ...ruleDraft,
                          personIds: e.target.checked ? [...ruleDraft.personIds, p.id] : ruleDraft.personIds.filter((x) => x !== p.id),
                        })
                      }
                    />
                    {p.name || p.email}
                  </label>
                ))}
              </fieldset>
            )}
            <p className="ui-help">{t('assign.onlyAvailable')}</p>
            {formError && (
              <p className="ui-error" role="alert">
                {formError}
              </p>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!removing}
        title={removing?.kind === 'team' ? t('assign.deleteTeamTitle', { name: removing?.name ?? '' }) : t('assign.deleteRuleTitle', { name: removing?.name ?? '' })}
        body={removing?.kind === 'team' ? t('assign.deleteTeamBody') : t('assign.deleteRuleBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
      {toast}
    </div>
  );
}

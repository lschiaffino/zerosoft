'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { LineAccess, LineDto, TeamPersonDto } from '@/lib/groups-lines';
import type { PlatformSettings } from '@/lib/groups-access';
import { AVAILABILITY, type Availability } from '@/lib/groups-lines-shared';
import { Modal, api, useErrorText, useToast } from './ui';

interface TeamData {
  people: TeamPersonDto[];
  teams: Array<{ id: string; name: string; memberIds: string[] }>;
  lineAccess: boolean;
  teamAccess: boolean;
  reassignOnOffline: boolean;
  canEdit: boolean;
  me: string;
}

/**
 * Ajustes › Equipo: quién trabaja en Groups. Invitar (la misma invitación
 * del workspace, con rol y equipos), rol de cada persona (owner, admin,
 * member: uno solo para toda la suite), equipos, líneas que ve, estado
 * (en línea, ausente, desconectado) y chats abiertos asignados. Los admins
 * prenden acá el acceso por línea y por equipo y la reasignación al
 * desconectarse.
 */
export default function TeamPanel({ initial, lines: initialLines, isOwner }: { initial: TeamData; lines: LineDto[]; isOwner: boolean }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  const [data, setData] = useState(initial);
  const [lines, setLines] = useState(initialLines);
  const [inviting, setInviting] = useState(false);
  const [linesFor, setLinesFor] = useState<TeamPersonDto | null>(null);
  const [error, setError] = useState('');
  const canEdit = data.canEdit;

  const reload = useCallback(async () => {
    const [team, ls] = await Promise.all([api<TeamData>('/api/groups/team'), api<{ lines: LineDto[] }>('/api/groups/lines')]);
    if (team.data) {
      setData(team.data);
      setError('');
    } else setError(errText(team.error));
    if (ls.data) setLines(ls.data.lines);
  }, [errText]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, 30_000);
    return () => clearInterval(id);
  }, [reload]);

  async function saveSetting(patch: Partial<PlatformSettings>) {
    const prev = data;
    setData({ ...data, ...patch });
    const res = await api<{ settings: PlatformSettings }>('/api/groups/access', { method: 'PATCH', body: patch });
    if (!res.data) {
      setData(prev);
      return showToast(errText(res.error), true);
    }
    showToast(t('common.saved'));
    void reload();
  }

  async function setRole(p: TeamPersonDto, role: 'admin' | 'member') {
    const res = await api(`/api/teams/members/${p.id}`, { method: 'PATCH', body: { role } });
    if (!res.data) return showToast(errText(res.error), true);
    showToast(t('common.saved'));
    void reload();
  }

  async function setStatus(p: TeamPersonDto, status: Availability) {
    setData((d) => ({ ...d, people: d.people.map((x) => (x.id === p.id ? { ...x, availability: status } : x)) }));
    const res = await api('/api/groups/availability', { method: 'PUT', body: p.id === data.me ? { status } : { status, personIds: [p.id] } });
    if (!res.data) {
      showToast(errText(res.error), true);
      return void reload();
    }
    void reload();
  }

  const lineName = (id: string) => lines.find((l) => l.id === id);
  const teamName = (id: string) => data.teams.find((x) => x.id === id)?.name ?? '';

  return (
    <div className="ui-fields">
      <div className="gr-detail-head">
        <p className="ui-help">{t('team.intro')}</p>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={() => setInviting(true)}>
            {t('team.invite')}
          </button>
        )}
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void reload()}>
            {t('audit.retry')}
          </button>
        </p>
      )}

      {data.people.length <= 1 ? (
        <p className="ui-help">{t('team.alone')}</p>
      ) : null}
      <div className="table-wrap gr-team-wrap">
        <table className="table gr-table gr-team-table">
          <thead>
            <tr>
              <th scope="col">{t('team.colPerson')}</th>
              <th scope="col">{t('team.colRole')}</th>
              <th scope="col">{t('team.colTeams')}</th>
              {canEdit && <th scope="col">{t('team.colLines')}</th>}
              <th scope="col">{t('team.colStatus')}</th>
              {canEdit && <th scope="col">{t('team.colOpen')}</th>}
            </tr>
          </thead>
          <tbody>
            {data.people.map((p) => {
              const editRole = canEdit && p.role !== 'owner' && p.id !== data.me && (isOwner || p.role === 'member');
              const editStatus = p.id === data.me || canEdit;
              return (
                <tr key={p.id} className="gr-team-row">
                  <td data-label={t('team.colPerson')}>
                    <span className="gr-team-person">
                      <strong>{p.name || p.email}</strong>
                      {p.name && <span className="ui-help">{p.email}</span>}
                    </span>
                  </td>
                  <td data-label={t('team.colRole')}>
                    {editRole ? (
                      <select className="select" value={p.role} onChange={(e) => void setRole(p, e.target.value as 'admin' | 'member')} aria-label={t('team.roleFor', { name: p.name || p.email })}>
                        <option value="member">{t('team.roles.member')}</option>
                        {(isOwner || p.role === 'admin') && <option value="admin">{t('team.roles.admin')}</option>}
                      </select>
                    ) : (
                      t(`team.roles.${p.role}`)
                    )}
                  </td>
                  <td data-label={t('team.colTeams')}>{p.teamIds.length ? p.teamIds.map(teamName).filter(Boolean).join(', ') : <span className="ui-help">·</span>}</td>
                  {canEdit && (
                  <td data-label={t('team.colLines')}>
                    <span className="gr-team-lines">
                      {p.lineIds === 'all' ? (
                        <span>{data.lineAccess && p.role !== 'member' ? t('team.allLinesAdmin') : t('team.allLines')}</span>
                      ) : p.lineIds.length === 0 ? (
                        <span className="ui-error">{t('team.noLines')}</span>
                      ) : (
                        p.lineIds.map((id) => {
                          const l = lineName(id);
                          return l ? (
                            <span key={id}>
                              <span className="gr-line-dot" style={{ background: l.displayColor }} aria-hidden="true" />
                              {l.name}
                            </span>
                          ) : null;
                        })
                      )}
                      {canEdit && p.role === 'member' && lines.length > 0 && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLinesFor(p)} aria-label={t('team.editLinesFor', { name: p.name || p.email })}>
                          {t('team.editLines')}
                        </button>
                      )}
                    </span>
                  </td>
                  )}
                  <td data-label={t('team.colStatus')}>
                    {editStatus ? (
                      <span className="gr-avail">
                        <span className={`gr-avail-dot is-${p.availability}`} aria-hidden="true" />
                        <select className="select" value={p.availability} onChange={(e) => void setStatus(p, e.target.value as Availability)} aria-label={t('team.statusFor', { name: p.name || p.email })}>
                          {AVAILABILITY.map((a) => (
                            <option key={a} value={a}>
                              {t(`team.status.${a}`)}
                            </option>
                          ))}
                        </select>
                      </span>
                    ) : (
                      <span className="gr-avail">
                        <span className={`gr-avail-dot is-${p.availability}`} aria-hidden="true" />
                        {t(`team.status.${p.availability}`)}
                      </span>
                    )}
                  </td>
                  {canEdit && <td data-label={t('team.colOpen')}>{p.openChats}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="ui-help">
        {t('team.rolesHelp')} <Link href="/app/settings/members">{t('team.workspaceMembers')}</Link>
      </p>

      {canEdit && (
        <section className="gr-detail-section" aria-labelledby="gr-team-access">
          <h2 className="gr-detail-title" id="gr-team-access">
            {t('team.accessTitle')}
          </h2>
          <label className="gr-check-label">
            <input type="checkbox" className="ui-check" checked={data.lineAccess} onChange={(e) => void saveSetting({ lineAccess: e.target.checked })} />
            {t('team.lineAccess')}
          </label>
          <p className="ui-help">{t('team.lineAccessHelp')}</p>
          <label className="gr-check-label">
            <input type="checkbox" className="ui-check" checked={data.teamAccess} onChange={(e) => void saveSetting({ teamAccess: e.target.checked })} />
            {t('team.teamAccess')}
          </label>
          <p className="ui-help">
            {t('team.teamAccessHelp')} <Link href="/app/groups/settings?tab=access">{t('team.labelAccessLink')}</Link>
          </p>
          <label className="gr-check-label">
            <input type="checkbox" className="ui-check" checked={data.reassignOnOffline} onChange={(e) => void saveSetting({ reassignOnOffline: e.target.checked })} />
            {t('team.reassign')}
          </label>
          <p className="ui-help">{t('team.reassignHelp')}</p>
        </section>
      )}

      <InviteModal open={inviting} teams={data.teams} isOwner={isOwner} onClose={() => setInviting(false)} onDone={(msg) => {
        setInviting(false);
        showToast(msg);
        void reload();
      }} />
      <PersonLinesModal
        person={linesFor}
        lines={lines}
        onClose={() => setLinesFor(null)}
        onSaved={() => {
          setLinesFor(null);
          showToast(t('common.saved'));
          void reload();
        }}
      />
      {toast}
    </div>
  );
}

interface InviteResult {
  email: string;
  status: string;
  link?: string;
}

function InviteModal({
  open,
  teams,
  isOwner,
  onClose,
  onDone,
}: {
  open: boolean;
  teams: Array<{ id: string; name: string }>;
  isOwner: boolean;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [emails, setEmails] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [groupIds, setGroupIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setEmails('');
    setRole('member');
    setGroupIds(new Set());
    setError('');
  }, [open]);

  async function submit() {
    setBusy(true);
    setError('');
    const res = await api<{ results: InviteResult[]; invalid: string[] }>('/api/teams/invites', { body: { emails, role, groupIds: [...groupIds] } });
    setBusy(false);
    if (!res.data) return setError(res.error === 'invalid_emails' ? t('team.invalidEmails') : errText(res.error));
    const sent = res.data.results.filter((r) => r.status !== 'member' && r.status !== 'limited').length;
    onDone(t('team.invited', { n: sent }));
  }

  return (
    <Modal
      open={open}
      title={t('team.inviteTitle')}
      onClose={onClose}
      onSubmit={() => void submit()}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!emails.trim()} aria-busy={busy || undefined}>
            {t('team.sendInvite')}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        <label className="ui-field">
          <span className="label">{t('team.emails')}</span>
          <textarea className="input" rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="ana@empresa.com, juan@empresa.com" />
        </label>
        <label className="ui-field">
          <span className="label">{t('team.colRole')}</span>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
            <option value="member">{t('team.roles.member')}</option>
            {isOwner && <option value="admin">{t('team.roles.admin')}</option>}
          </select>
          <span className="ui-help">{role === 'admin' ? t('team.adminHelp') : t('team.memberHelp')}</span>
        </label>
        {teams.length > 0 && (
          <fieldset className="gr-check-list">
            <legend className="label">{t('team.colTeams')}</legend>
            {teams.map((tm) => (
              <label key={tm.id} className="gr-check-label">
                <input
                  type="checkbox"
                  className="ui-check"
                  checked={groupIds.has(tm.id)}
                  onChange={(e) => {
                    const next = new Set(groupIds);
                    if (e.target.checked) next.add(tm.id);
                    else next.delete(tm.id);
                    setGroupIds(next);
                  }}
                />
                {tm.name}
              </label>
            ))}
          </fieldset>
        )}
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Líneas dadas directamente a una persona (las de su equipo se ven en Ajustes › Líneas). */
function PersonLinesModal({ person, lines, onClose, onSaved }: { person: TeamPersonDto | null; lines: LineDto[]; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!person) return;
    setPicked(new Set(person.directLineIds));
    setError('');
  }, [person]);

  async function save() {
    if (!person) return;
    setBusy(true);
    setError('');
    for (const l of lines) {
      const access: LineAccess = l.access ?? { personIds: [], teamIds: [] };
      const has = access.personIds.includes(person.id);
      const want = picked.has(l.id);
      if (has === want) continue;
      const personIds = want ? [...access.personIds, person.id] : access.personIds.filter((x) => x !== person.id);
      const res = await api('/api/groups/lines', { method: 'PUT', body: { numberId: l.id, personIds } });
      if (!res.data) {
        setBusy(false);
        return setError(errText(res.error));
      }
    }
    setBusy(false);
    onSaved();
  }

  return (
    <Modal
      open={!!person}
      title={person ? t('team.linesTitle', { name: person.name || person.email }) : ''}
      onClose={onClose}
      onSubmit={() => void save()}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        <p className="ui-help">{t('team.linesIntro')}</p>
        <fieldset className="gr-check-list">
          <legend className="sr-only">{t('team.colLines')}</legend>
          {lines.map((l) => (
            <label key={l.id} className="gr-check-label">
              <input
                type="checkbox"
                className="ui-check"
                checked={picked.has(l.id)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(l.id);
                  else next.delete(l.id);
                  setPicked(next);
                }}
              />
              <span className="gr-line-dot" style={{ background: l.displayColor }} aria-hidden="true" />
              {l.name}
              {l.phone ? <span className="ui-help">+{l.phone}</span> : null}
            </label>
          ))}
        </fieldset>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

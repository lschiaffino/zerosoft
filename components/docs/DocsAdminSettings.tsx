'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { formatDateTime } from '@/lib/datetime';
import type { DocsSettings, DocsTeamspaceWithMe, TeamspaceAccess, TeamspaceMember } from '@/lib/docs-access';
import type { DocsAuditEntry } from '@/lib/docs-audit';
import type { DocsShareRole } from '@/lib/docs-types';

const ROLES: DocsShareRole[] = ['full', 'edit', 'comment', 'view'];
const ACCESS: TeamspaceAccess[] = ['open', 'closed', 'private'];

/** Rol de los miembros y seguridad del workspace (exportar, publicar, invitados). */
export function DocsAccessSettings({ initial, canManage }: { initial: DocsSettings; canManage: boolean }) {
  const t = useTranslations('docs.admin');
  const tr = useTranslations('docs.share.roles');
  const uid = useId();
  const [s, setS] = useState(initial);

  async function save(patch: Partial<DocsSettings>): Promise<string | void> {
    const res = await fetch('/api/docs/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return t('saveError');
    setS((await res.json()) as DocsSettings);
  }

  return (
    <>
      <FormSection
        title={t('membersTitle')}
        description={t('membersHelp')}
        disabled={!canManage}
        note={canManage ? undefined : t('adminsOnly')}
        onSubmit={canManage ? (fd) => save({ member_role: String(fd.get('member_role')) as DocsShareRole }) : undefined}
      >
        <div className="ui-field">
          <label className="label" htmlFor={`${uid}-role`}>
            {t('memberRole')}
          </label>
          <select id={`${uid}-role`} name="member_role" className="select" defaultValue={s.member_role} disabled={!canManage} data-testid="docs-settings-member-role">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {tr(r)}
              </option>
            ))}
          </select>
          <span className="ui-help">{t('memberRoleHelp')}</span>
        </div>
      </FormSection>
      <FormSection
        title={t('securityTitle')}
        description={t('securityHelp')}
        disabled={!canManage}
        note={canManage ? undefined : t('adminsOnly')}
        onSubmit={
          canManage
            ? (fd) => save({ allow_export: fd.get('allow_export') === 'on', allow_publish: fd.get('allow_publish') === 'on', allow_guests: fd.get('allow_guests') === 'on' })
            : undefined
        }
      >
        {(['allow_export', 'allow_publish', 'allow_guests'] as const).map((key) => (
          <label key={key} className="ui-switch docs-switch-row">
            <input type="checkbox" role="switch" name={key} defaultChecked={s[key]} disabled={!canManage} data-testid={`docs-settings-${key}`} />
            <span className="docs-switch-text">
              <span className="docs-switch-label">{t(`${key}.label`)}</span>
              <span className="ui-help">{t(`${key}.help`)}</span>
            </span>
          </label>
        ))}
      </FormSection>
      {/* Colaboración: no es un permiso de admins (otra sección que Seguridad). */}
      <FormSection
        title={t('collabTitle')}
        description={t('collabHelp')}
        disabled={!canManage}
        note={canManage ? undefined : t('adminsOnly')}
        onSubmit={canManage ? (fd) => save({ coedit: fd.get('coedit') === 'on' }) : undefined}
      >
        <label className="ui-switch docs-switch-row">
          <input type="checkbox" role="switch" name="coedit" defaultChecked={s.coedit} disabled={!canManage} data-testid="docs-settings-coedit" />
          <span className="docs-switch-text">
            <span className="docs-switch-label">{t('coedit.label')}</span>
            <span className="ui-help">{t('coedit.help')}</span>
          </span>
        </label>
      </FormSection>
    </>
  );
}

interface Person {
  id: string;
  name: string;
  email: string;
}

/** Teamspaces: crear, editar tipo y rol, miembros, unirse y salir, borrar. */
export function DocsTeamspacesSettings({
  initial,
  people,
  meId,
  isAdmin,
  canCreate,
}: {
  initial: DocsTeamspaceWithMe[];
  people: Person[];
  meId: string;
  isAdmin: boolean;
  canCreate: boolean;
}) {
  const t = useTranslations('docs.admin');
  const tt = useTranslations('docs.teamspaces');
  const tr = useTranslations('docs.share.roles');
  const router = useRouter();
  const uid = useId();
  const [list, setList] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamspaceMember[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DocsTeamspaceWithMe | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setList(initial), [initial]);

  const loadMembers = useCallback(async (id: string) => {
    setMembers(null);
    const res = await fetch(`/api/docs/teamspaces/${id}`);
    if (res.ok) setMembers(((await res.json()) as { members: TeamspaceMember[] }).members);
    else setMembers([]);
  }, []);

  useEffect(() => {
    if (openId) void loadMembers(openId);
  }, [openId, loadMembers]);

  async function create(fd: FormData): Promise<string | void> {
    const name = String(fd.get('name') ?? '').trim();
    if (!name) return t('nameRequired');
    const res = await fetch('/api/docs/teamspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        access: fd.get('access'),
        member_role: fd.get('member_role'),
        icon: String(fd.get('icon') ?? '').trim() || null,
        ai_knowledge: fd.get('ai_knowledge') === 'on',
      }),
    });
    if (!res.ok) return t('saveError');
    const ts = (await res.json()) as DocsTeamspaceWithMe;
    const mine: DocsTeamspaceWithMe = { ...ts, my_role: 'owner', member_count: 1 };
    setList((prev) => [...prev, mine].sort((a, b) => a.name.localeCompare(b.name)));
    router.refresh();
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/docs/teamspaces/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError(t('saveError'));
      return;
    }
    const ts = (await res.json()) as DocsTeamspaceWithMe;
    setList((prev) => prev.map((x) => (x.id === id ? { ...x, ...ts } : x)));
    router.refresh();
  }

  async function addMember(id: string, userId: string, role: 'owner' | 'member' = 'member') {
    setError(null);
    const res = await fetch(`/api/docs/teamspaces/${id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, role }),
    });
    if (!res.ok) {
      setError(t('saveError'));
      return;
    }
    setMembers(((await res.json()) as { rows: TeamspaceMember[] }).rows);
    if (userId === meId) setList((prev) => prev.map((x) => (x.id === id ? { ...x, my_role: role } : x)));
    router.refresh();
  }

  async function removeMember(id: string, userId: string) {
    setError(null);
    const res = await fetch(`/api/docs/teamspaces/${id}/members?user=${encodeURIComponent(userId)}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error === 'last_owner' ? t('lastOwner') : t('saveError'));
      return;
    }
    setMembers(((await res.json()) as { rows: TeamspaceMember[] }).rows);
    if (userId === meId) setList((prev) => prev.map((x) => (x.id === id ? { ...x, my_role: null } : x)));
    router.refresh();
  }

  async function remove(ts: DocsTeamspaceWithMe) {
    const res = await fetch(`/api/docs/teamspaces/${ts.id}`, { method: 'DELETE' });
    if (res.ok) {
      setList((prev) => prev.filter((x) => x.id !== ts.id));
      if (openId === ts.id) setOpenId(null);
      router.refresh();
    } else setError(t('saveError'));
  }

  const open = list.find((x) => x.id === openId) ?? null;
  const manage = (ts: DocsTeamspaceWithMe) => isAdmin || ts.my_role === 'owner';

  return (
    <>
      {canCreate && (
        <FormSection title={t('newTeamspace')} description={t('newTeamspaceHelp')} onSubmit={create} submitLabel={t('create')} resetOnSave>
          <div className="docs-ts-form">
            <div className="ui-field docs-ts-icon-field">
              <label className="label" htmlFor={`${uid}-icon`}>
                {t('icon')}
              </label>
              <input id={`${uid}-icon`} name="icon" className="input" maxLength={4} placeholder="◆" />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor={`${uid}-name`}>
                {t('name')}
              </label>
              <input id={`${uid}-name`} name="name" className="input" maxLength={120} required data-testid="docs-ts-name" />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor={`${uid}-access`}>
                {t('access')}
              </label>
              <select id={`${uid}-access`} name="access" className="select" defaultValue="open" data-testid="docs-ts-access">
                {ACCESS.map((a) => (
                  <option key={a} value={a}>
                    {tt(`access.${a}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="ui-field">
              <label className="label" htmlFor={`${uid}-mrole`}>
                {t('teamspaceRole')}
              </label>
              <select id={`${uid}-mrole`} name="member_role" className="select" defaultValue="edit">
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {tr(r)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="ui-help">{t('accessHelp')}</p>
          <label className="ui-switch docs-switch-row">
            <input type="checkbox" role="switch" name="ai_knowledge" />
            <span className="docs-switch-text">
              <span className="docs-switch-label">{t('aiKnowledge')}</span>
              <span className="ui-help">{t('aiKnowledgeHelp')}</span>
            </span>
          </label>
        </FormSection>
      )}

      <FormSection title={t('teamspacesTab')} description={t('teamspacesHelp')}>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        {list.length === 0 ? (
          <EmptyState quiet product="docs" title={t('noTeamspaces')} body={t('noTeamspacesBody')} />
        ) : (
          <ul className="docs-ts-list" data-testid="docs-ts-list">
            {list.map((ts) => (
              <li key={ts.id} className={`docs-ts-item${openId === ts.id ? ' is-open' : ''}`}>
                <div className="docs-ts-row">
                  <span className="docs-teamspace-icon" aria-hidden="true">
                    {ts.icon || ts.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="docs-ts-main">
                    <span className="docs-ts-name">{ts.name}</span>
                    <span className="ui-help">
                      {ts.is_default ? `${t('defaultBadge')} · ` : ''}
                      {tt(`access.${ts.access}`)} · {ts.is_default ? t('everyone') : t('memberCount', { count: ts.member_count })} · {tr(ts.member_role)}
                    </span>
                  </span>
                  <span className="docs-ts-actions">
                    {!ts.my_role && ts.access === 'open' && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void addMember(ts.id, meId)}>
                        {tt('join')}
                      </button>
                    )}
                    {ts.my_role === 'member' && !ts.is_default && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void removeMember(ts.id, meId)}>
                        {tt('leave')}
                      </button>
                    )}
                    {(manage(ts) || ts.my_role) && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-expanded={openId === ts.id}
                        onClick={() => setOpenId((cur) => (cur === ts.id ? null : ts.id))}
                      >
                        {manage(ts) ? t('manage') : t('members')}
                      </button>
                    )}
                  </span>
                </div>
                {openId === ts.id && open && (
                  <div className="docs-ts-detail">
                    {manage(ts) && (
                      <div className="docs-ts-edit">
                        <div className="ui-field">
                          <label className="label" htmlFor={`${uid}-rn-${ts.id}`}>
                            {t('name')}
                          </label>
                          <input
                            id={`${uid}-rn-${ts.id}`}
                            className="input"
                            defaultValue={ts.name}
                            maxLength={120}
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (v && v !== ts.name) void patch(ts.id, { name: v });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            }}
                          />
                        </div>
                        <div className="ui-field">
                          <label className="label" htmlFor={`${uid}-ac-${ts.id}`}>
                            {t('access')}
                          </label>
                          <select id={`${uid}-ac-${ts.id}`} className="select" value={ts.access} onChange={(e) => void patch(ts.id, { access: e.target.value })}>
                            {ACCESS.map((a) => (
                              <option key={a} value={a}>
                                {tt(`access.${a}`)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="ui-field">
                          <label className="label" htmlFor={`${uid}-mr-${ts.id}`}>
                            {t('teamspaceRole')}
                          </label>
                          <select id={`${uid}-mr-${ts.id}`} className="select" value={ts.member_role} onChange={(e) => void patch(ts.id, { member_role: e.target.value })}>
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {tr(r)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                    {manage(ts) && (
                      <label className="ui-switch docs-switch-row">
                        <input
                          type="checkbox"
                          role="switch"
                          checked={ts.ai_knowledge || ts.access === 'open'}
                          disabled={ts.access === 'open'}
                          onChange={(e) => void patch(ts.id, { ai_knowledge: e.target.checked })}
                          data-testid="docs-ts-ai"
                        />
                        <span className="docs-switch-text">
                          <span className="docs-switch-label">{t('aiKnowledge')}</span>
                          <span className="ui-help">{ts.access === 'open' ? t('aiKnowledgeOpen') : t('aiKnowledgeHelp')}</span>
                        </span>
                      </label>
                    )}
                    {isAdmin && (
                      <label className="ui-switch docs-switch-row">
                        <input
                          type="checkbox"
                          role="switch"
                          checked={ts.is_default}
                          onChange={(e) => void patch(ts.id, { is_default: e.target.checked }).then(() => setList((prev) => prev.map((x) => ({ ...x, is_default: e.target.checked ? x.id === ts.id : x.id === ts.id ? false : x.is_default }))))}
                          data-testid="docs-ts-default"
                        />
                        <span className="docs-switch-text">
                          <span className="docs-switch-label">{t('isDefault')}</span>
                          <span className="ui-help">{t('isDefaultHelp')}</span>
                        </span>
                      </label>
                    )}
                    <h3 className="docs-ts-sub">{t('members')}</h3>
                    {members === null ? (
                      <div className="ui-loading-stack" aria-busy="true">
                        <span className="ui-skeleton ui-skeleton-row" />
                        <span className="ui-skeleton ui-skeleton-row" />
                      </div>
                    ) : (
                      <ul className="docs-ts-members">
                        {members.map((m) => (
                          <li key={m.user_id} className="docs-ts-member">
                            <span className="docs-ts-main">
                              <span>{m.name || m.email}</span>
                              <span className="ui-help">{m.email}</span>
                            </span>
                            {manage(ts) ? (
                              <select
                                className="select docs-access-select"
                                value={m.role}
                                aria-label={`${t('memberRoleIn')}: ${m.name || m.email}`}
                                onChange={(e) => void addMember(ts.id, m.user_id, e.target.value as 'owner' | 'member')}
                              >
                                <option value="owner">{tt('roleOwner')}</option>
                                <option value="member">{tt('roleMember')}</option>
                              </select>
                            ) : (
                              <span className="docs-access-role">{m.role === 'owner' ? tt('roleOwner') : tt('roleMember')}</span>
                            )}
                            {manage(ts) && (
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void removeMember(ts.id, m.user_id)}>
                                {t('remove')}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {manage(ts) && members && (
                      <div className="ui-field docs-ts-add">
                        <label className="label" htmlFor={`${uid}-add-${ts.id}`}>
                          {t('addMember')}
                        </label>
                        <select
                          id={`${uid}-add-${ts.id}`}
                          className="select"
                          value=""
                          onChange={(e) => e.target.value && void addMember(ts.id, e.target.value)}
                          data-testid="docs-ts-add-member"
                        >
                          <option value="">{t('pickPerson')}</option>
                          {people
                            .filter((p) => !members.some((m) => m.user_id === p.id))
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}
                    {manage(ts) && (
                      <button type="button" className="btn btn-ghost btn-danger btn-sm docs-ts-delete" onClick={() => setConfirmDelete(ts)}>
                        {t('deleteTeamspace')}
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </FormSection>
      <ConfirmDialog
        open={!!confirmDelete}
        title={t('deleteTitle', { name: confirmDelete?.name ?? '' })}
        body={confirmDelete && (confirmDelete.access === 'open' || confirmDelete.is_default) ? t('deleteBody') : t('deleteBodyPrivate')}
        confirmLabel={t('deleteTeamspace')}
        cancelLabel={t('cancel')}
        danger
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const ts = confirmDelete;
          setConfirmDelete(null);
          if (ts) void remove(ts);
        }}
      />
    </>
  );
}

const ACTION_GROUPS = ['page', 'share', 'guest', 'version', 'teamspace', 'settings'] as const;

/** Registro de auditoría con filtros y export CSV de lo filtrado (solo admins). */
export function DocsAuditLog({ people }: { people: Array<{ id: string; name: string }> }) {
  const t = useTranslations('docs.admin');
  const ta = useTranslations('docs.audit');
  const locale = useLocale();
  const uid = useId();
  const [rows, setRows] = useState<DocsAuditEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [filters, setFilters] = useState({ action: '', actor: '', from: '', to: '' });

  const qs = useCallback(
    (extra: Record<string, string> = {}) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries({ ...filters, ...extra })) if (v) p.set(k, v);
      return p.toString();
    },
    [filters],
  );

  const load = useCallback(
    async (before?: string) => {
      setError(false);
      try {
        const res = await fetch(`/api/docs/audit?${qs(before ? { before } : {})}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { rows: DocsAuditEntry[]; next: string | null };
        setRows((prev) => (before && prev ? [...prev, ...data.rows] : data.rows));
        setNext(data.next);
      } catch {
        setError(true);
        setRows((prev) => prev ?? []);
      }
    },
    [qs],
  );

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  return (
    <FormSection
      title={t('auditTab')}
      description={t('auditHelp')}
      footer={
        <a className="btn btn-secondary btn-sm" href={`/api/docs/audit?${qs({ format: 'csv' })}`} download data-testid="docs-audit-csv">
          {t('exportCsv')}
        </a>
      }
    >
      <div className="docs-audit-filters">
        <div className="ui-field">
          <label className="label" htmlFor={`${uid}-act`}>
            {t('auditAction')}
          </label>
          <select id={`${uid}-act`} className="select" value={filters.action} onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))} data-testid="docs-audit-action">
            <option value="">{t('auditAll')}</option>
            {ACTION_GROUPS.map((g) => (
              <option key={g} value={g}>
                {ta(`group.${g}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor={`${uid}-who`}>
            {t('auditActor')}
          </label>
          <select id={`${uid}-who`} className="select" value={filters.actor} onChange={(e) => setFilters((f) => ({ ...f, actor: e.target.value }))}>
            <option value="">{t('auditAnyone')}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor={`${uid}-from`}>
            {t('auditFrom')}
          </label>
          <input id={`${uid}-from`} type="date" className="input" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor={`${uid}-to`}>
            {t('auditTo')}
          </label>
          <input id={`${uid}-to`} type="date" className="input" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        </div>
      </div>
      {error ? (
        <div role="alert">
          <p className="ui-error">{t('auditError')}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
            {t('retry')}
          </button>
        </div>
      ) : rows === null ? (
        <div className="ui-loading-stack" aria-busy="true" aria-label={t('loading')}>
          <span className="ui-skeleton ui-skeleton-row" />
          <span className="ui-skeleton ui-skeleton-row" />
          <span className="ui-skeleton ui-skeleton-row" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState quiet product="docs" title={t('auditEmpty')} />
      ) : (
        <div className="docs-audit-wrap">
          <table className="docs-audit" data-testid="docs-audit-table">
            <thead>
              <tr>
                <th scope="col">{t('auditWhen')}</th>
                <th scope="col">{t('auditActor')}</th>
                <th scope="col">{t('auditAction')}</th>
                <th scope="col">{t('auditPage')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num">{formatDateTime(r.created_at, locale)}</td>
                  <td>{r.actor_label || t('auditSystem')}</td>
                  <td>
                    <span className="docs-audit-action">{ta.has(`action.${r.action}`) ? ta(`action.${r.action}`) : r.action}</span>
                    {r.detail && <span className="ui-help docs-audit-detail">{r.detail}</span>}
                  </td>
                  <td>{r.page_id ? <a href={`/${locale}/app/docs/${r.page_id}`} className="docs-inline-link">{r.page_title || t('untitled')}</a> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {next && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load(next)}>
              {t('loadMore')}
            </button>
          )}
        </div>
      )}
    </FormSection>
  );
}

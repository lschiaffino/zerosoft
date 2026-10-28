'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import CopyButton from '@/components/link/CopyButton';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import DataTable from '@/components/ui/DataTable';
import EmptyState from '@/components/ui/EmptyState';
import FormSection from '@/components/ui/FormSection';
import QuickModal from '@/components/app/QuickModal';
import { PRODUCT_CONFIG, APP_SWITCHER_ORDER, type ProductKey } from '@/lib/products';
import type { DirectoryDto, InviteDto, MemberDto } from '@/lib/workspace-directory';
import type { InviteOutcome } from '@/lib/workspace-invites';
import { parseDbUtc } from '@/lib/utils';

type Role = 'owner' | 'admin' | 'member' | 'guest';
type Apps = '*' | ProductKey[];

function canManage(actor: Role, target: Role): boolean {
  if (target === 'owner') return false;
  if (actor === 'owner') return true;
  return actor === 'admin' && (target === 'member' || target === 'guest');
}

function initial(name: string | null, email: string): string {
  return ((name ?? email).trim().charAt(0) || '?').toUpperCase();
}

/** Selector de apps: "Todas" o una lista. */
export function AppsPicker({ value, onChange, idPrefix }: { value: Apps; onChange: (v: Apps) => void; idPrefix: string }) {
  const t = useTranslations('settings.members');
  const all = value === '*';
  const list = all ? [] : value;
  return (
    <fieldset className="st-fieldset ws-apps">
      <legend className="label">{t('apps')}</legend>
      <label className="ui-check">
        <input type="checkbox" checked={all} onChange={(e) => onChange(e.target.checked ? '*' : [...APP_SWITCHER_ORDER])} />
        <span>{t('allApps')}</span>
      </label>
      {!all && (
        <div className="ws-apps-grid" role="group" aria-label={t('apps')}>
          {APP_SWITCHER_ORDER.map((key) => (
            <label key={key} className="ui-check" htmlFor={`${idPrefix}-${key}`}>
              <input
                id={`${idPrefix}-${key}`}
                type="checkbox"
                checked={list.includes(key)}
                onChange={(e) => onChange(e.target.checked ? [...list, key] : list.filter((k) => k !== key))}
              />
              <span>{PRODUCT_CONFIG[key].name}</span>
            </label>
          ))}
        </div>
      )}
      {!all && list.length === 0 && <p className="ui-help">{t('noAppsHelp')}</p>}
    </fieldset>
  );
}

function GroupsPicker({
  groups,
  value,
  onChange,
  idPrefix,
}: {
  groups: DirectoryDto['groups'];
  value: string[];
  onChange: (v: string[]) => void;
  idPrefix: string;
}) {
  const t = useTranslations('settings.members');
  if (!groups.length) return null;
  return (
    <fieldset className="st-fieldset">
      <legend className="label">{t('teams')}</legend>
      <div className="ws-apps-grid">
        {groups.map((g) => (
          <label key={g.id} className="ui-check" htmlFor={`${idPrefix}-${g.id}`}>
            <input
              id={`${idPrefix}-${g.id}`}
              type="checkbox"
              checked={value.includes(g.id)}
              onChange={(e) => onChange(e.target.checked ? [...value, g.id] : value.filter((x) => x !== g.id))}
            />
            <span>{g.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Ajustes › Miembros: invitar por email (con rol, apps y subequipos), la
 * lista de personas (rol, acceso, sacar) y las invitaciones pendientes
 * (copiar link, reenviar, revocar). Los cambios se ven sin recargar.
 */
export default function MembersPanel({
  initial: initialDir,
  me,
  role,
  legacyNotice = false,
}: {
  initial: DirectoryDto;
  me: string;
  role: Role;
  /** Owner de antes de 128 con datos propios: quien entre va a ver lo que hasta hoy era solo suyo. */
  legacyNotice?: boolean;
}) {
  const t = useTranslations('settings.members');
  const locale = useLocale();
  const router = useRouter();
  const [dir, setDir] = useState<DirectoryDto>(initialDir);
  const admin = role === 'owner' || role === 'admin';
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

  // Invitar
  const [emails, setEmails] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'admin' | 'guest'>('member');
  const [inviteApps, setInviteApps] = useState<Apps>('*');
  const [inviteGroups, setInviteGroups] = useState<string[]>([]);
  const [results, setResults] = useState<InviteOutcome[] | null>(null);
  const [invalid, setInvalid] = useState<string[]>([]);

  // Editar / sacar
  const [editing, setEditing] = useState<MemberDto | null>(null);
  const [editApps, setEditApps] = useState<Apps>('*');
  const [editGroups, setEditGroups] = useState<string[]>([]);
  const [removing, setRemoving] = useState<MemberDto | null>(null);
  const [leaving, setLeaving] = useState(false);

  const groupName = useMemo(() => new Map(dir.groups.map((g) => [g.id, g.name])), [dir.groups]);
  const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(parseDbUtc(iso)) : '');

  async function refresh() {
    const res = await fetch('/api/teams/members').catch(() => null);
    if (res?.ok) setDir((await res.json()) as DirectoryDto);
  }

  async function call(input: string, init: RequestInit, errKey = 'error'): Promise<Response | null> {
    setBusy(true);
    setError(null);
    const res = await fetch(input, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const code = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : undefined;
      setError(code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t(errKey));
      return null;
    }
    return res;
  }

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    if (!emails.trim() || busy) return;
    const res = await call('/api/teams/invites', {
      method: 'POST',
      body: JSON.stringify({ emails, role: inviteRole, apps: inviteRole === 'guest' ? [] : inviteApps, groupIds: inviteGroups, locale }),
    });
    if (!res) return;
    const data = (await res.json()) as { results: InviteOutcome[]; invalid: string[] };
    setResults(data.results);
    setInvalid(data.invalid);
    setEmails('');
    await refresh();
    router.refresh();
  }

  function openEdit(m: MemberDto) {
    setEditing(m);
    setEditApps(m.apps);
    setEditGroups(m.groupIds);
  }

  async function saveEdit() {
    if (!editing) return;
    const res = await call(`/api/teams/members/${encodeURIComponent(editing.userId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ apps: editApps, groupIds: editGroups }),
    });
    if (!res) return;
    setEditing(null);
    await refresh();
  }

  async function changeRole(m: MemberDto, next: string) {
    const res = await call(`/api/teams/members/${encodeURIComponent(m.userId)}`, { method: 'PATCH', body: JSON.stringify({ role: next }) });
    if (res) await refresh();
  }

  async function remove() {
    if (!removing) return;
    const res = await call(`/api/teams/members/${encodeURIComponent(removing.userId)}`, { method: 'DELETE' });
    setRemoving(null);
    if (res) await refresh();
  }

  async function leave() {
    const res = await call('/api/teams/members/self', { method: 'DELETE' });
    setLeaving(false);
    if (res) {
      router.push('/app');
      router.refresh();
    }
  }

  async function approve(inv: InviteDto) {
    const res = await call(`/api/teams/invites/${encodeURIComponent(inv.id)}`, { method: 'POST', body: JSON.stringify({ action: 'approve' }) });
    if (res) await refresh();
  }

  async function resend(inv: InviteDto, allowAnyEmail?: boolean) {
    const res = await call(
      `/api/teams/invites/${encodeURIComponent(inv.id)}`,
      { method: 'POST', body: JSON.stringify(allowAnyEmail ? { allowAnyEmail: true } : {}) },
      'resendError',
    );
    if (!res) return;
    const out = (await res.json()) as InviteOutcome;
    setResults([out]);
    await refresh();
  }

  async function revoke(inv: InviteDto) {
    const res = await call(`/api/teams/invites/${encodeURIComponent(inv.id)}`, { method: 'DELETE' });
    if (res) await refresh();
  }

  const appsLabel = (apps: Apps, r: Role) =>
    r === 'owner' ? t('allApps') : r === 'guest' ? t('guestAccess') : apps === '*' ? t('allApps') : apps.length === 0 ? t('noApps') : apps.map((k) => PRODUCT_CONFIG[k].name).join(', ');

  const q = query.trim().toLowerCase();
  const members = q ? dir.members.filter((m) => `${m.name ?? ''} ${m.email}`.toLowerCase().includes(q)) : dir.members;
  const meMember = dir.members.find((m) => m.userId === me);

  return (
    <>
      {admin && (
        <FormSection title={t('inviteTitle', { workspace: dir.team.name })} description={t('inviteDesc')}>
          {legacyNotice && (
            <p className="ws-notice" role="note" data-testid="legacy-notice">
              {t('legacyNotice')}
            </p>
          )}
          <form className="ws-invite" onSubmit={onInvite}>
            <div className="ui-field">
              <label className="label" htmlFor="ws-invite-emails">
                {t('emails')}
              </label>
              <textarea
                id="ws-invite-emails"
                className="input ws-invite-emails"
                rows={2}
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                onKeyDown={(e) => {
                  // Enter manda (como un input); Shift+Enter baja de línea para pegar una lista larga.
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder={t('emailsPlaceholder')}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="ui-help">{t('emailsHelp')}</p>
            </div>
            <div className="ui-fields ui-fields-2">
              <div className="ui-field">
                <label className="label" htmlFor="ws-invite-role">
                  {t('role')}
                </label>
                <select id="ws-invite-role" className="select" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)}>
                  <option value="member">{t('roles.member')}</option>
                  {role === 'owner' && <option value="admin">{t('roles.admin')}</option>}
                  <option value="guest">{t('roles.guest')}</option>
                </select>
                <p className="ui-help">{t(`roleHelp.${inviteRole}`)}</p>
              </div>
            </div>
            {inviteRole !== 'guest' && (
              <>
                <AppsPicker value={inviteApps} onChange={setInviteApps} idPrefix="ws-inv-app" />
                <GroupsPicker groups={dir.groups} value={inviteGroups} onChange={setInviteGroups} idPrefix="ws-inv-grp" />
              </>
            )}
            <div className="st-form-foot">
              <button type="submit" className="btn btn-primary" disabled={!emails.trim() || busy} aria-busy={busy || undefined}>
                {t('send')}
              </button>
            </div>
          </form>
          {(results || invalid.length > 0) && (
            <div className="ws-results" role="status" aria-live="polite">
              {invalid.length > 0 && <p className="ui-error">{t('invalidEmails', { list: invalid.join(', ') })}</p>}
              {results?.map((r) => (
                <div key={r.email} className={`ws-result ws-result-${r.status}`} data-testid="invite-result">
                  <span className="data ws-result-email">{r.email}</span>
                  <span className="ws-result-status">{t(`result.${r.status}`)}</span>
                  {r.url && r.status !== 'sent' && <CopyButton text={r.url} label={t('copyLink')} className="btn btn-secondary btn-sm" />}
                </div>
              ))}
            </div>
          )}
        </FormSection>
      )}

      <FormSection
        title={t('listTitle', { count: dir.members.length })}
        description={admin ? t('listDescAdmin') : t('listDesc')}
        footer={
          role !== 'owner' && meMember ? (
            <div className="st-actions">
              <p className="ui-section-note">{t('leaveNote', { workspace: dir.team.name })}</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLeaving(true)}>
                {t('leave')}
              </button>
            </div>
          ) : undefined
        }
      >
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        {dir.members.length > 8 && (
          <div className="ui-field ws-search">
            <label className="sr-only" htmlFor="ws-member-search">
              {t('search')}
            </label>
            <input id="ws-member-search" className="input" type="search" placeholder={t('search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        )}
        <DataTable
          caption={t('listTitle', { count: dir.members.length })}
          rows={members}
          rowKey={(m) => m.userId}
          compact
          className="st-table-stack ws-members"
          empty={<EmptyState quiet title={t('noMatches')} />}
          columns={[
            {
              key: 'person',
              header: t('colPerson'),
              cell: (m) => (
                <div className="ws-person" data-testid="member-row" data-email={m.email}>
                  {m.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.image} alt="" width={24} height={24} className="ws-avatar" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="ws-avatar ws-avatar-initial" aria-hidden="true">
                      {initial(m.name, m.email)}
                    </span>
                  )}
                  <span className="ws-person-text" title={`${t('colJoined')}: ${fmt(m.joinedAt)}`}>
                    <span className="st-strong">
                      {m.name || m.email.split('@')[0]}
                      {m.userId === me && <span className="st-muted"> {t('you')}</span>}
                    </span>
                    <span className="data st-muted ws-person-email" title={m.email}>
                      {m.email}
                    </span>
                  </span>
                </div>
              ),
            },
            {
              key: 'role',
              header: t('colRole'),
              cell: (m) =>
                admin && m.userId !== me && canManage(role, m.role) ? (
                  <select
                    className="select ws-role-select"
                    aria-label={t('roleOf', { name: m.name || m.email })}
                    value={m.role}
                    disabled={busy}
                    onChange={(e) => void changeRole(m, e.target.value)}
                  >
                    {role === 'owner' && <option value="admin">{t('roles.admin')}</option>}
                    <option value="member">{t('roles.member')}</option>
                    <option value="guest">{t('roles.guest')}</option>
                  </select>
                ) : (
                  t(`roles.${m.role}`)
                ),
            },
            { key: 'apps', header: t('colApps'), cell: (m) => <span className="ws-cell-muted">{appsLabel(m.apps, m.role)}</span> },
            {
              key: 'teams',
              header: t('colTeams'),
              cell: (m) =>
                m.groupIds.length ? (
                  <span className="ws-cell-muted">{m.groupIds.map((g) => groupName.get(g)).filter(Boolean).join(', ')}</span>
                ) : (
                  <span className="st-muted">{t('none')}</span>
                ),
            },
            {
              key: 'actions',
              header: <span className="sr-only">{t('colActions')}</span>,
              cell: (m) =>
                admin && m.userId !== me && canManage(role, m.role) ? (
                  <div className="st-row-actions">
                    {m.role !== 'guest' && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(m)} disabled={busy}>
                        {t('editAccess')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-danger btn-sm"
                      onClick={() => setRemoving(m)}
                      disabled={busy}
                      aria-label={t('removeOf', { name: m.name || m.email })}
                    >
                      {t('remove')}
                    </button>
                  </div>
                ) : null,
            },
          ]}
        />
        {dir.members.length <= 1 && admin && <p className="ui-help ws-alone">{t('alone')}</p>}
      </FormSection>

      {admin && (
        <FormSection title={t('pendingTitle', { count: dir.invites.length })} description={t('pendingDesc')}>
          <DataTable
            caption={t('pendingTitle', { count: dir.invites.length })}
            rows={dir.invites}
            rowKey={(i) => i.id}
            compact
            className="st-table-stack ws-invites"
            empty={<EmptyState quiet compact title={t('pendingEmpty')} body={t('pendingEmptyBody')} />}
            columns={[
              { key: 'email', header: t('colEmail'), cell: (i) => <span className="data" data-testid="invite-row">{i.email}</span> },
              { key: 'role', header: t('colRole'), cell: (i) => t(`roles.${i.role}`) },
              {
                key: 'status',
                header: t('colStatus'),
                cell: (i) => (
                  <span className={i.expired || i.emailStatus === 'failed' ? 'ws-status-bad' : 'ws-cell-muted'}>
                    {i.kind === 'request'
                      ? t('status.request')
                      : i.expired
                        ? t('status.expired')
                        : i.emailStatus === 'sent'
                          ? t('status.sent', { date: fmt(i.sentAt) })
                          : i.emailStatus === 'failed'
                            ? t('status.failed')
                            : t('status.notSent')}
                    {i.anyEmail && <span className="ws-status-note"> {t('status.anyEmail')}</span>}
                  </span>
                ),
              },
              { key: 'expires', header: t('colExpires'), cell: (i) => (i.expired ? '' : fmt(i.expiresAt)), data: true },
              {
                key: 'actions',
                header: <span className="sr-only">{t('colActions')}</span>,
                cell: (i) => (
                  <div className="st-row-actions">
                    {i.kind === 'request' ? (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void approve(i)} disabled={busy}>
                        {t('approve')}
                      </button>
                    ) : (
                      <>
                        {i.url && !i.expired && <CopyButton text={i.url} label={t('copyLink')} className="btn btn-ghost btn-sm" />}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void resend(i)} disabled={busy}>
                          {t('resend')}
                        </button>
                        {!i.anyEmail && i.role !== 'admin' && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => void resend(i, true)}
                            disabled={busy}
                            title={t('allowAnyEmailHelp')}
                          >
                            {t('allowAnyEmail')}
                          </button>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-danger btn-sm"
                      onClick={() => void revoke(i)}
                      disabled={busy}
                      aria-label={t('revokeOf', { email: i.email })}
                    >
                      {t('revoke')}
                    </button>
                  </div>
                ),
              },
            ]}
          />
        </FormSection>
      )}

      <QuickModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t('editTitle', { name: editing?.name || editing?.email || '' })}
        onSubmit={() => void saveEdit()}
        submitLabel={t('save')}
        cancelLabel={t('cancel')}
        busy={busy}
        error={editing ? error : null}
        width={520}
      >
        <AppsPicker value={editApps} onChange={setEditApps} idPrefix="ws-edit-app" />
        <GroupsPicker groups={dir.groups} value={editGroups} onChange={setEditGroups} idPrefix="ws-edit-grp" />
      </QuickModal>

      <ConfirmDialog
        open={removing !== null}
        danger
        busy={busy}
        title={t('removeTitle', { name: removing?.name || removing?.email || '', workspace: dir.team.name })}
        body={t('removeBody')}
        confirmLabel={t('remove')}
        cancelLabel={t('cancel')}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
      <ConfirmDialog
        open={leaving}
        danger
        busy={busy}
        title={t('leaveTitle', { workspace: dir.team.name })}
        body={t('leaveBody')}
        confirmLabel={t('leave')}
        cancelLabel={t('cancel')}
        onConfirm={() => void leave()}
        onCancel={() => setLeaving(false)}
      />
    </>
  );
}

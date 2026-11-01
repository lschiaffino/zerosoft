'use client';

import LocalText from '@/components/ui/LocalText';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
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
import { describeApps, joinNames } from '@/lib/app-access-label';

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

/**
 * Selector de apps: "Todas" o una lista, en el orden del sidebar. `limit`: las
 * apps de quien edita (nadie da las que no tiene: las que la otra persona ya
 * tiene se pueden quitar). `requested`: las que pidió, marcadas.
 */
export function AppsPicker({
  value,
  onChange,
  idPrefix,
  order = APP_SWITCHER_ORDER,
  limit = '*',
  requested = [],
}: {
  value: Apps;
  onChange: (v: Apps) => void;
  idPrefix: string;
  order?: readonly ProductKey[];
  limit?: Apps;
  requested?: readonly ProductKey[];
}) {
  const t = useTranslations('settings.members');
  const all = value === '*';
  const list = all ? [] : value;
  const limited = limit !== '*';
  const canAdd = (k: ProductKey) => limit === '*' || limit.includes(k);
  const visible = order.filter((k) => canAdd(k) || list.includes(k));
  return (
    <fieldset className="st-fieldset ws-apps">
      <legend className="label">{t('apps')}</legend>
      {(!limited || all) && (
        <label className="ui-check">
          <input type="checkbox" checked={all} onChange={(e) => onChange(e.target.checked ? [...order] : limited ? [...(limit as ProductKey[])] : [...order])} />
          <span>{t('allApps')}</span>
        </label>
      )}
      {!all && (
        <div className="ws-apps-grid" role="group" aria-label={t('apps')}>
          {visible.map((key) => (
            <label key={key} className="ui-check" htmlFor={`${idPrefix}-${key}`}>
              <input
                id={`${idPrefix}-${key}`}
                type="checkbox"
                checked={list.includes(key)}
                disabled={!list.includes(key) && !canAdd(key)}
                onChange={(e) => onChange(e.target.checked ? [...list, key] : list.filter((k) => k !== key))}
              />
              <span>
                {PRODUCT_CONFIG[key].name}
                {requested.includes(key) && <span className="ws-app-requested"> {t('requested')}</span>}
              </span>
            </label>
          ))}
        </div>
      )}
      {limited && <p className="ui-help">{t(all ? 'appsLimitAllHelp' : 'appsLimitHelp')}</p>}
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
  openPerson = null,
  actorApps = '*',
  appOrder = APP_SWITCHER_ORDER,
  initial: initialDir,
  me,
  role,
  legacyNotice = false,
  peopleLinks = false,
  emailLogin = false,
}: {
  /** Abrir el acceso de esta persona al entrar (aviso de "pide acceso", ya validado contra el workspace). */
  openPerson?: string | null;
  /** Apps de quien edita: no puede dar otras. */
  actorApps?: Apps;
  /** Orden del sidebar. */
  appOrder?: readonly ProductKey[];
  initial: DirectoryDto;
  me: string;
  role: Role;
  /** Quien mira tiene People: cada fila enlaza a la ficha de la persona. */
  peopleLinks?: boolean;
  /** Owner de antes de 128 con datos propios: quien entre va a ver lo que hasta hoy era solo suyo. */
  legacyNotice?: boolean;
  /** Se puede entrar con código por email (lib/email-login.ts): cambia el texto de la invitación. */
  emailLogin?: boolean;
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
  const [inviteApps, setInviteApps] = useState<Apps>(actorApps);
  const [inviteGroups, setInviteGroups] = useState<string[]>([]);
  const [results, setResults] = useState<InviteOutcome[] | null>(null);
  const [invalid, setInvalid] = useState<string[]>([]);

  // Editar / sacar
  const [editing, setEditing] = useState<MemberDto | null>(null);
  const [editApps, setEditApps] = useState<Apps>('*');
  const [editGroups, setEditGroups] = useState<string[]>([]);
  const [removing, setRemoving] = useState<MemberDto | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [revoking, setRevoking] = useState<InviteDto | null>(null);

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

  // Sus pedidos que quien edita puede responder (un admin no responde por apps que no tiene).
  const answerable = (m: MemberDto | null): ProductKey[] => (m?.requestedApps ?? []).filter((a) => actorApps === '*' || actorApps.includes(a));

  function openEdit(m: MemberDto, fromRequest = false) {
    setError(null);
    setEditing(m);
    const asked = answerable(m);
    // Desde el aviso, lo pedido ya viene tildado: aprobar es Guardar.
    setEditApps(fromRequest && m.apps !== '*' && asked.length ? [...new Set([...m.apps, ...asked])] : m.apps);
    setEditGroups(m.groupIds);
  }

  function closeEdit() {
    setEditing(null);
    // Sin ?person= recargar no vuelve a abrir el diálogo.
    if (openPerson) router.replace('/app/settings/members', { scroll: false });
  }

  // El aviso de "pide acceso": la página ya comprobó que es de este workspace. Sigue al link aunque
  // ya estemos en Miembros (la campana navega sin desmontar esta página).
  useEffect(() => {
    if (!admin || !openPerson) return;
    const m = initialDir.members.find((x) => x.userId === openPerson);
    if (m) openEdit(m, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPerson]);

  async function saveEdit() {
    if (!editing) return;
    const res = await call(`/api/teams/members/${encodeURIComponent(editing.userId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ apps: editApps, groupIds: editGroups, workspaceId: dir.team.id }),
    });
    if (!res) return;
    closeEdit();
    await refresh();
    router.refresh();
  }

  async function deny() {
    if (!editing) return;
    const res = await call('/api/teams/access-request', {
      method: 'DELETE',
      body: JSON.stringify({ personId: editing.userId, workspaceId: dir.team.id }),
    });
    if (!res) return;
    closeEdit();
    await refresh();
    router.refresh();
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

  async function revoke() {
    const inv = revoking;
    if (!inv) return;
    const res = await call(`/api/teams/invites/${encodeURIComponent(inv.id)}`, { method: 'DELETE' });
    setRevoking(null);
    if (res) await refresh();
  }

  // Con la mayoría de las apps se nombra lo que falta ("todas las apps menos Track").
  const appsLabel = (apps: Apps, r: Role) => {
    if (r === 'owner') return t('allApps');
    if (r === 'guest') return t('guestAccess');
    const d = describeApps(apps);
    if (d.kind === 'all') return t('allApps');
    if (!d.names.length) return t('noApps');
    return d.kind === 'except' ? t('allAppsExcept', { apps: joinNames(d.names, locale) }) : d.names.join(', ');
  };

  const q = query.trim().toLowerCase();
  const members = q ? dir.members.filter((m) => `${m.name ?? ''} ${m.email}`.toLowerCase().includes(q)) : dir.members;
  const meMember = dir.members.find((m) => m.userId === me);

  return (
    <>
      {admin && (
        <FormSection title={t('inviteTitle', { workspace: dir.team.name })} description={t(emailLogin ? 'inviteDesc' : 'inviteDescGoogle')}>
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
                <AppsPicker value={inviteApps} onChange={setInviteApps} idPrefix="ws-inv-app" order={appOrder} limit={actorApps} />
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
              <button type="button" id="leave" className="btn btn-secondary btn-sm" onClick={() => setLeaving(true)}>
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
                      {peopleLinks ? (
                        <Link href={`/app/people/u/${encodeURIComponent(m.userId)}`} className="ws-person-link" title={t('peopleProfile')}>
                          {m.name || m.email.split('@')[0]}
                        </Link>
                      ) : (
                        m.name || m.email.split('@')[0]
                      )}
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
            {
              key: 'apps',
              header: t('colApps'),
              cell: (m) => (
                <>
                  <span className="ws-cell-muted">{appsLabel(m.apps, m.role)}</span>
                  {/* El pedido sigue a la vista aunque el aviso ya se haya leído. */}
                  {answerable(m).length > 0 && canManage(role, m.role) && (
                    <button type="button" className="ws-link-btn ws-requested-marker" onClick={() => openEdit(m, true)} data-testid="request-marker">
                      {t('requestedMarker', { apps: answerable(m).map((a) => PRODUCT_CONFIG[a].name).join(', ') })}
                    </button>
                  )}
                </>
              ),
            },
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
        <details className="ws-roles" data-testid="roles-legend">
          <summary>{t('rolesLegend')}</summary>
          <dl>
            {(['owner', 'admin', 'member', 'guest'] as const).map((r) => (
              <div key={r}>
                <dt className="st-strong">{t(`roles.${r}`)}</dt>
                <dd className="ui-help">{t(`roleLegend.${r}`)}</dd>
              </div>
            ))}
          </dl>
          <p className="ui-help">{t(admin ? 'rolesLegendAppsAdmin' : 'rolesLegendApps')}</p>
        </details>
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
              {
                key: 'email',
                header: t('colEmail'),
                cell: (i) => (
                  <span className="ws-invite-email">
                    <span className="data" data-testid="invite-row">
                      {/* Si no entra en una línea, corta antes de la arroba y no a mitad de palabra. */}
                      {i.email.split('@')[0]}
                      <wbr />@{i.email.split('@').slice(1).join('@')}
                    </span>
                    {/* Permitir otro email: un link chico debajo, así la fila no se sale a 1280. */}
                    {i.canAllowAnyEmail && !i.anyEmail && (
                      <button type="button" className="ws-link-btn" onClick={() => void resend(i, true)} disabled={busy} title={t('allowAnyEmailHelp')}>
                        {t('allowAnyEmail')}
                      </button>
                    )}
                  </span>
                ),
              },
              {
                key: 'role',
                header: t('colRole'),
                // Con apps limitadas se ven abajo del rol: lo que va a tener al aceptar.
                cell: (i) => (
                  <span className="ws-invite-email">
                    <span>{t(`roles.${i.role}`)}</span>
                    {i.role !== 'guest' && i.apps !== '*' && <span className="ws-cell-muted">{appsLabel(i.apps, i.role)}</span>}
                  </span>
                ),
              },
              {
                key: 'status',
                header: t('colStatus'),
                // Una línea corta; el detalle (sin proveedor, vencimiento) va en el title.
                cell: (i) => (
                  <span
                    className={i.expired || i.emailStatus === 'failed' ? 'ws-status-bad' : 'ws-cell-muted'}
                    title={[
                      i.kind !== 'request' && !i.expired && i.emailStatus !== 'sent' && i.emailStatus !== 'failed' ? t('status.notSentHelp') : '',
                      i.expiresAt && !i.expired ? t('status.expiresOn', { date: fmt(i.expiresAt) }) : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <LocalText>{i.kind === 'request'
                      ? t('status.request')
                      : i.expired
                        ? t('status.expired')
                        : i.emailStatus === 'sent'
                          ? t('status.sent', { date: fmt(i.sentAt) })
                          : i.emailStatus === 'failed'
                            ? t('status.failed')
                            : t('status.linkOnly')}</LocalText>
                    {i.anyEmail && <span className="ws-status-note"> {t('status.anyEmail')}</span>}
                  </span>
                ),
              },
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
                        {i.canResend && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void resend(i)} disabled={busy}>
                          {t('resend')}
                        </button>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-danger btn-sm"
                      onClick={() => setRevoking(i)}
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
        onClose={closeEdit}
        title={t('editTitle', { name: editing?.name || editing?.email || '' })}
        onSubmit={() => void saveEdit()}
        submitLabel={t('save')}
        cancelLabel={t('cancel')}
        busy={busy}
        error={editing ? error : null}
        width={520}
        footExtra={
          answerable(editing).length > 0 ? (
            <button type="button" className="btn btn-secondary" onClick={() => void deny()} disabled={busy} data-testid="deny-request">
              {t('denyRequest')}
            </button>
          ) : undefined
        }
      >
        {answerable(editing).length > 0 && (
          <p className="ws-request-line" data-testid="request-line">
            {t('requestLine', { name: editing?.name || editing?.email || '', apps: answerable(editing).map((a) => PRODUCT_CONFIG[a].name).join(', ') })}
          </p>
        )}
        <AppsPicker value={editApps} onChange={setEditApps} idPrefix="ws-edit-app" order={appOrder} limit={actorApps} requested={answerable(editing)} />
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
        open={revoking !== null}
        danger
        busy={busy}
        title={t('revokeConfirm.title', { email: revoking?.email ?? '' })}
        body={t('revokeConfirm.body')}
        confirmLabel={t('revokeConfirm.confirm')}
        cancelLabel={t('revokeConfirm.cancel')}
        onConfirm={() => void revoke()}
        onCancel={() => setRevoking(null)}
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

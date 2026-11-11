'use client';

import LocalText from '@/components/ui/LocalText';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
import type { AuditEntry } from '@/lib/workspace-admin';
import type { PersonAccessView } from '@/lib/workspace-access-view';
import { parseDbUtc } from '@/lib/utils';
import { describeApps, joinNames } from '@/lib/app-access-label';
import { assignableRoles, can, canManageRole, ROLE_MATRIX, ROLES, type Role } from '@/lib/roles';
import { CAPABILITIES, capabilityDef, capabilityMessageKey, type Capability } from '@/lib/capabilities';

type Apps = '*' | ProductKey[];
type Patch = { role?: Exclude<Role, 'owner'>; apps?: Apps; groupIds?: string[]; capabilities?: Capability[] };

function initial(name: string | null, email: string): string {
  return ((name ?? email).trim().charAt(0) || '?').toUpperCase();
}

const nameOf = (m: { name: string | null; email: string }) => m.name || m.email.split('@')[0];

/** La persona con el cambio aplicado (en la pantalla, antes de que conteste el servidor). */
function withPatch(m: MemberDto, patch: Patch): MemberDto {
  const { capabilities, ...rest } = patch;
  return { ...m, ...rest, ...(capabilities ? { caps: capabilities } : {}), ...(rest.role && rest.role !== 'member' ? { caps: [] } : {}) };
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
  disabled = false,
}: {
  value: Apps;
  onChange: (v: Apps) => void;
  idPrefix: string;
  order?: readonly ProductKey[];
  limit?: Apps;
  requested?: readonly ProductKey[];
  disabled?: boolean;
}) {
  const t = useTranslations('settings.members');
  const all = value === '*';
  const list = all ? [] : value;
  const limited = limit !== '*';
  const canAdd = (k: ProductKey) => limit === '*' || limit.includes(k);
  const visible = order.filter((k) => canAdd(k) || list.includes(k));
  return (
    <fieldset className="st-fieldset ws-apps" disabled={disabled}>
      <legend className="label">{t('apps')}</legend>
      {(!limited || all) && (
        <label className="ui-check">
          <input type="checkbox" checked={all} onChange={(e) => onChange(e.target.checked ? '*' : limited ? [...(limit as ProductKey[])] : [...order])} />
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
  disabled = false,
}: {
  groups: DirectoryDto['groups'];
  value: string[];
  onChange: (v: string[]) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  const t = useTranslations('settings.members');
  if (!groups.length) return null;
  return (
    <fieldset className="st-fieldset" disabled={disabled}>
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

function Avatar({ m }: { m: { image: string | null; name: string | null; email: string } }) {
  return m.image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={m.image} alt="" width={24} height={24} className="ws-avatar" referrerPolicy="no-referrer" />
  ) : (
    <span className="ws-avatar ws-avatar-initial" aria-hidden="true">
      {initial(m.name, m.email)}
    </span>
  );
}

interface Toast {
  id: number;
  label: string;
  undo?: () => Promise<void>;
}

/**
 * Ajustes › Miembros y permisos: invitar (por email o con un link, con el rol
 * elegido), la tabla de personas (rol en línea, apps, equipos, última
 * actividad; selección en lote), "qué puede ver" cada persona, las
 * invitaciones pendientes, las personas quitadas (para sumarlas de nuevo) y
 * el registro de cambios. Cada cambio se aplica al instante y se deshace.
 */
export default function MembersPanel({
  openPerson = null,
  actorApps = '*',
  appOrder: sidebarOrder = APP_SWITCHER_ORDER,
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
  const tp = useTranslations('settings.members.perm');
  // Inbox es personal (la tiene todo el mundo): no se da ni se quita.
  const appOrder = useMemo(() => sidebarOrder.filter((k) => k !== 'inbox'), [sidebarOrder]);
  const locale = useLocale();
  const router = useRouter();
  const [dir, setDir] = useState<DirectoryDto>(initialDir);
  // La página se vuelve a armar (aviso de la campana, router.refresh): la lista toma lo nuevo.
  useEffect(() => setDir(initialDir), [initialDir]);
  const actor = { role, apps: actorApps };
  const admin = can(actor, 'members.invite');
  const inviteRoles = assignableRoles(role);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Un cambio en curso (pedido y recarga de la lista): los controles esperan, así el siguiente parte de lo nuevo.
  const [syncing, setSyncing] = useState(false);
  const locked = busy || syncing;
  // Los checkboxes del acceso no se deshabilitan mientras guardan (perderían el foco y Esc dejaría de cerrar):
  // un segundo cambio espera a que termine el primero.
  const inflight = useRef<Promise<void>>(Promise.resolve());
  // Cambios en cola (incluido el que corre): mientras quede otro, no se recarga la lista para no pisar lo optimista.
  const queued = useRef(0);
  async function synced(run: () => Promise<void>) {
    queued.current += 1;
    const next = inflight.current.then(async () => {
      setSyncing(true);
      try {
        await run();
      } finally {
        queued.current -= 1;
        setSyncing(false);
      }
    });
    inflight.current = next.catch(() => undefined);
    await next;
  }
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'' | Role>('');
  const [teamFilter, setTeamFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<Toast | null>(null);
  const toastSeq = useRef(0);

  // Invitar
  const [emails, setEmails] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'admin' | 'guest'>('member');
  const [inviteApps, setInviteApps] = useState<Apps>(actorApps);
  const [inviteGroups, setInviteGroups] = useState<string[]>([]);
  const [results, setResults] = useState<InviteOutcome[] | null>(null);
  const [invalid, setInvalid] = useState<string[]>([]);

  // Acceso de una persona / sacar
  const [viewing, setViewing] = useState<MemberDto | null>(null);
  const [view, setView] = useState<PersonAccessView | null>(null);
  const [viewState, setViewState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [fromRequest, setFromRequest] = useState(false);
  const [removing, setRemoving] = useState<MemberDto[] | null>(null);
  const [owned, setOwned] = useState<{ trackIssues: number; crmRecords: number } | null>(null);
  const [transferTo, setTransferTo] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [revoking, setRevoking] = useState<InviteDto | null>(null);

  const groupName = useMemo(() => new Map(dir.groups.map((g) => [g.id, g.name])), [dir.groups]);
  const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(parseDbUtc(iso)) : '');
  const ago = (iso: string | null) => {
    if (!iso) return tp('never');
    const diff = (Date.now() - parseDbUtc(iso).getTime()) / 1000;
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (diff < 3600) return rtf.format(-Math.max(1, Math.round(diff / 60)), 'minute');
    if (diff < 86_400) return rtf.format(-Math.round(diff / 3600), 'hour');
    if (diff < 30 * 86_400) return rtf.format(-Math.round(diff / 86_400), 'day');
    return fmt(iso);
  };
  const roleName = (r: string) => (ROLES.includes(r as Role) ? t(`roles.${r as Role}`) : r);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/teams/members').catch(() => null);
    if (res?.ok) setDir((await res.json()) as DirectoryDto);
  }, []);

  const showToast = useCallback((label: string, undo?: () => Promise<void>) => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, label, undo });
  }, []);

  // El aviso se va solo a los 8 segundos (Esc lo cierra).
  useEffect(() => {
    if (!toast) return;
    const id = toast.id;
    const timer = window.setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), 8000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function errorText(code: string | undefined, fallback = 'error'): string {
    return code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t(fallback);
  }

  async function call(input: string, init: RequestInit, errKey = 'error'): Promise<Response | null> {
    setBusy(true);
    setError(null);
    const res = await fetch(input, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const code = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : undefined;
      setError(errorText(code, errKey));
      return null;
    }
    return res;
  }

  /** Cambia a la persona en la pantalla ya (los checkboxes responden al instante); si el pedido falla, se recarga la lista. */
  async function patchPerson(userId: string, patch: Patch): Promise<Response | null> {
    setDir((cur) => ({ ...cur, members: cur.members.map((m) => (m.userId === userId ? withPatch(m, patch) : m)) }));
    const res = await call(`/api/teams/members/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify({ ...patch, workspaceId: dir.team.id }) });
    if (!res) await refresh();
    return res;
  }

  // ---------- Invitar ----------

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

  async function onInviteLink() {
    if (busy || inviteRole === 'admin') return;
    const res = await call('/api/teams/invites', {
      method: 'POST',
      body: JSON.stringify({ link: true, role: inviteRole, apps: inviteRole === 'guest' ? [] : inviteApps, groupIds: inviteGroups, locale }),
    });
    if (!res) return;
    const data = (await res.json()) as { results: InviteOutcome[] };
    setResults(data.results);
    setInvalid([]);
    await refresh();
  }

  // ---------- Pedidos de acceso ----------

  // Sus pedidos que quien edita puede responder (un admin no responde por apps que no tiene).
  const answerable = (m: MemberDto | null): ProductKey[] => (m?.requestedApps ?? []).filter((a) => actorApps === '*' || actorApps.includes(a));

  async function approveRequest(m: MemberDto) {
    await synced(async () => {
      const asked = answerable(m);
      if (!asked.length || m.apps === '*') return;
      const before = m.apps;
      const res = await patchPerson(m.userId, { apps: [...new Set([...m.apps, ...asked])] });
      if (!res) return;
      await afterChange(m.userId);
      showToast(tp('toast.appOn', { name: nameOf(m), app: asked.map((a) => PRODUCT_CONFIG[a].name).join(', ') }), async () => {
        if (await patchPerson(m.userId, { apps: before })) await afterChange(m.userId, true);
      });
    });
  }

  async function deny() {
    if (!viewing) return;
    const res = await call('/api/teams/access-request', {
      method: 'DELETE',
      body: JSON.stringify({ personId: viewing.userId, workspaceId: dir.team.id }),
    });
    if (!res) return;
    closeAccess();
    await refresh();
    router.refresh();
  }

  // ---------- Qué puede ver ----------

  const loadView = useCallback(async (userId: string) => {
    setViewState('loading');
    const res = await fetch(`/api/teams/members/${encodeURIComponent(userId)}`).catch(() => null);
    if (!res?.ok) {
      setViewState('error');
      return;
    }
    setView((await res.json()) as PersonAccessView);
    setViewState('idle');
  }, []);

  function openAccess(m: MemberDto, request = false) {
    setError(null);
    setViewing(m);
    setView(null);
    setFromRequest(request);
    if (admin) void loadView(m.userId);
  }

  function closeAccess() {
    setViewing(null);
    setView(null);
    // Sin ?person= recargar no vuelve a abrir el diálogo.
    if (openPerson) {
      window.history.replaceState(null, '', window.location.pathname);
      router.replace('/app/settings/members', { scroll: false });
    }
  }

  // El aviso de "pide acceso": la página ya comprobó que es de este workspace. Sigue al link aunque
  // ya estemos en Miembros (la campana navega sin desmontar esta página).
  useEffect(() => {
    if (!admin || !openPerson) return;
    const m = initialDir.members.find((x) => x.userId === openPerson);
    if (m) openAccess(m, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPerson]);

  /** Después de un cambio: la lista, la persona abierta y el registro, sin recargar. */
  async function afterChange(userId?: string, undone = false) {
    // Hay otro cambio esperando: el último recarga. Si se recargara ahora, la lista volvería a mostrar
    // el estado del server sin los cambios en cola y los checkboxes saltarían.
    if (queued.current <= 1) {
      await refresh();
      if (userId && viewing?.userId === userId) void loadView(userId);
      router.refresh();
    }
    if (undone) showToast(tp('toast.undone'));
  }

  // ---------- Cambios con deshacer ----------

  async function changeRole(m: MemberDto, next: Exclude<Role, 'owner'>) {
    await synced(async () => {
      if (next === m.role) return;
      const prev = m.role as Exclude<Role, 'owner'>;
      // Pasar de guest a member le devuelve las apps que tenía: deshacer vuelve a guest.
      if (!(await patchPerson(m.userId, { role: next }))) return;
      await afterChange(m.userId);
      showToast(tp('toast.role', { name: nameOf(m), role: roleName(next) }), async () => {
        if (await patchPerson(m.userId, { role: prev })) await afterChange(m.userId, true);
      });
    });
  }

  /** El checkbox cambia al tocarlo aunque haya otro guardado en curso (synced los encola). */
  function showNow(userId: string, patch: Patch) {
    setDir((cur) => ({ ...cur, members: cur.members.map((x) => (x.userId === userId ? withPatch(x, patch) : x)) }));
  }

  // Pasar a admin pide confirmación: suma la gestión de personas y de los ajustes del workspace.
  const [promoting, setPromoting] = useState<MemberDto | null>(null);
  function requestRole(m: MemberDto, next: Exclude<Role, 'owner'>) {
    if (next === 'admin' && m.role !== 'admin') setPromoting(m);
    else void changeRole(m, next);
  }

  // Dar una capacidad marcada como sensible pide confirmación; quitarla es al instante (con deshacer).
  const [granting, setGranting] = useState<{ m: MemberDto; cap: Capability } | null>(null);
  function requestCap(m: MemberDto, cap: Capability, on: boolean) {
    if (on && capabilityDef(cap).confirmGrant) setGranting({ m, cap });
    else void toggleCap(m, cap, on);
  }

  async function toggleCap(m: MemberDto, cap: Capability, on: boolean) {
    const prev = m.caps;
    const next = on ? CAPABILITIES.map((c) => c.key).filter((k) => k === cap || prev.includes(k)) : prev.filter((k) => k !== cap);
    const label = tp(`caps.${capabilityMessageKey(cap)}.label` as 'caps.lines_numbers_manage.label');
    showNow(m.userId, { capabilities: next });
    await synced(async () => {
      if (!(await patchPerson(m.userId, { capabilities: next }))) return;
      await afterChange(m.userId);
      showToast(tp(on ? 'toast.capOn' : 'toast.capOff', { name: nameOf(m), cap: label }), async () => {
        if (await patchPerson(m.userId, { capabilities: prev })) await afterChange(m.userId, true);
      });
    });
  }

  async function changeApps(m: MemberDto, next: Apps, label: string) {
    const prev = m.apps;
    showNow(m.userId, { apps: next });
    await synced(async () => {
      if (!(await patchPerson(m.userId, { apps: next }))) return;
      await afterChange(m.userId);
      showToast(label, async () => {
        if (await patchPerson(m.userId, { apps: prev })) await afterChange(m.userId, true);
      });
    });
  }

  function toggleApp(m: MemberDto, app: ProductKey, on: boolean) {
    const cur = m.apps === '*' ? [...appOrder] : m.apps;
    const next = on ? [...new Set([...cur, app])] : cur.filter((k) => k !== app);
    void changeApps(m, next, tp(on ? 'toast.appOn' : 'toast.appOff', { name: nameOf(m), app: PRODUCT_CONFIG[app].name }));
  }

  async function changeTeams(m: MemberDto, next: string[]) {
    showNow(m.userId, { groupIds: next });
    await synced(async () => {
      const prev = m.groupIds;
      if (!(await patchPerson(m.userId, { groupIds: next }))) return;
      await afterChange(m.userId);
      showToast(tp('toast.teams', { name: nameOf(m) }), async () => {
        if (await patchPerson(m.userId, { groupIds: prev })) await afterChange(m.userId, true);
      });
    });
  }

  // ---------- En lote ----------

  const manageable = (m: MemberDto) => admin && m.userId !== me && canManageRole(role, m.role);

  async function bulk(make: (m: MemberDto) => Patch | null) {
    const people = dir.members.filter((m) => selected.has(m.userId));
    const undo: Array<[string, Patch]> = [];
    let skipped = 0;
    setBusy(true);
    for (const m of people) {
      const patch = manageable(m) ? make(m) : null;
      if (!patch) {
        skipped += 1;
        continue;
      }
      const prev: Patch = {};
      if (patch.role) prev.role = m.role as Exclude<Role, 'owner'>;
      if (patch.apps) prev.apps = m.apps;
      if (patch.groupIds) prev.groupIds = m.groupIds;
      const res = await fetch(`/api/teams/members/${encodeURIComponent(m.userId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...patch, workspaceId: dir.team.id }),
      }).catch(() => null);
      if (res?.ok) undo.push([m.userId, prev]);
      else skipped += 1;
    }
    setBusy(false);
    await afterChange();
    const label = [undo.length ? tp('toast.bulk', { count: undo.length }) : '', skipped ? tp('toast.skipped', { count: skipped }) : ''].filter(Boolean).join('. ');
    showToast(
      label,
      undo.length
        ? async () => {
            for (const [id, prev] of undo.reverse()) await patchPerson(id, prev);
            await afterChange(undefined, true);
          }
        : undefined,
    );
  }

  const [bulkPromote, setBulkPromote] = useState(false);
  function onBulkRole(value: string) {
    if (!value) return;
    if (value === 'admin') return setBulkPromote(true);
    void bulk((m) => (m.role === value ? null : { role: value as Exclude<Role, 'owner'> }));
  }
  function onBulkGive(app: string) {
    if (!app) return;
    const key = app as ProductKey;
    void bulk((m) => (m.role === 'guest' || m.apps === '*' || m.apps.includes(key) ? null : { apps: [...m.apps, key] }));
  }
  function onBulkTake(app: string) {
    if (!app) return;
    const key = app as ProductKey;
    void bulk((m) => {
      if (m.role === 'guest') return null;
      const cur = m.apps === '*' ? [...appOrder] : m.apps;
      return cur.includes(key) ? { apps: cur.filter((k) => k !== key) } : null;
    });
  }
  function onBulkTeam(groupId: string) {
    if (!groupId) return;
    void bulk((m) => (m.role === 'guest' || m.groupIds.includes(groupId) ? null : { groupIds: [...m.groupIds, groupId] }));
  }

  // ---------- Sacar, sumar de nuevo ----------

  async function askRemove(people: MemberDto[]) {
    setError(null);
    setTransferTo('');
    setOwned(null);
    setRemoving(people);
    if (people.length === 1) {
      const res = await fetch(`/api/teams/members/${encodeURIComponent(people[0].userId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'owned', workspaceId: dir.team.id }),
      }).catch(() => null);
      if (res?.ok) setOwned((await res.json()) as { trackIssues: number; crmRecords: number });
    }
  }

  async function remove() {
    const people = removing;
    if (!people) return;
    const done: MemberDto[] = [];
    setBusy(true);
    setError(null);
    let lastCode: string | undefined;
    for (const m of people) {
      const res = await fetch(`/api/teams/members/${encodeURIComponent(m.userId)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: dir.team.id, ...(transferTo ? { transferTo } : {}) }),
      }).catch(() => null);
      if (res?.ok) done.push(m);
      else lastCode = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : undefined;
    }
    setBusy(false);
    setRemoving(null);
    setSelected(new Set());
    if (viewing && done.some((m) => m.userId === viewing.userId)) closeAccess();
    if (lastCode !== undefined || done.length < people.length) setError(errorText(lastCode));
    await afterChange();
    if (done.length) {
      showToast(tp('toast.removed', { count: done.length, name: nameOf(done[0]) }), async () => {
        for (const m of done) await addBack(m.userId, false);
        await afterChange(undefined, true);
      });
    }
  }

  async function addBack(userId: string, announce = true) {
    const res = await call(`/api/teams/members/${encodeURIComponent(userId)}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'reactivate', workspaceId: dir.team.id }),
    });
    if (!res || !announce) return;
    const person = dir.deactivated.find((d) => d.userId === userId);
    await afterChange();
    if (person) showToast(tp('toast.addedBack', { name: nameOf(person) }));
  }

  async function forget(userId: string) {
    const res = await call(`/api/teams/members/${encodeURIComponent(userId)}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'forget', workspaceId: dir.team.id }),
    });
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

  // ---------- Invitaciones ----------

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

  // ---------- Textos ----------

  // Con la mayoría de las apps se nombra lo que falta ("todas las apps menos Track").
  const appsLabel = (apps: Apps, r: Role) => {
    if (r === 'owner') return t('allApps');
    if (r === 'guest') return t('guestAccess');
    const d = describeApps(apps);
    if (d.kind === 'all') return t('allApps');
    if (!d.names.length) return t('noApps');
    return d.kind === 'except' ? t('allAppsExcept', { apps: joinNames(d.names, locale) }) : d.names.join(', ');
  };

  function logLine(a: AuditEntry): string {
    const actorName = a.actorName || tp('someone');
    const target = a.targetLabel || tp('someone');
    switch (a.action) {
      case 'member.role':
        return tp('log.role', { actor: actorName, target, from: roleName(String(a.before.role ?? '')), to: roleName(String(a.after.role ?? '')) });
      case 'member.apps':
        return tp('log.apps', { actor: actorName, target, to: appsLabel((a.after.apps as Apps) ?? [], 'member') });
      case 'member.teams':
        return tp('log.teams', { actor: actorName, target });
      case 'member.caps': {
        const before = new Set((a.before.caps as string[] | undefined) ?? []);
        const after = new Set((a.after.caps as string[] | undefined) ?? []);
        const names = (keys: string[]) =>
          joinNames(
            keys.filter((k) => CAPABILITIES.some((c) => c.key === k)).map((k) => tp(`caps.${capabilityMessageKey(k as Capability)}.label` as 'caps.lines_numbers_manage.label')),
            locale,
          );
        const given = [...after].filter((k) => !before.has(k));
        const taken = [...before].filter((k) => !after.has(k));
        if (given.length && !taken.length) return tp('log.capsGiven', { actor: actorName, target, caps: names(given) });
        if (taken.length && !given.length) return tp('log.capsTaken', { actor: actorName, target, caps: names(taken) });
        return tp('log.caps', { actor: actorName, target });
      }
      case 'member.remove':
        return a.after.left ? tp('log.left', { target }) : tp('log.remove', { actor: actorName, target });
      case 'member.reactivate':
        return tp('log.reactivate', { actor: actorName, target });
      case 'member.transfer':
        return tp('log.transfer', { actor: actorName, target, to: String(a.after.toLabel ?? tp('someone')) });
      case 'invite.create':
        return a.after.link ? tp('log.link', { actor: actorName }) : tp('log.invite', { actor: actorName, target });
      case 'invite.revoke':
        return tp('log.revoke', { actor: actorName, target: target || tp('linkInvite') });
    }
    return '';
  }

  // ---------- Filtros ----------

  const q = query.trim().toLowerCase();
  const members = dir.members.filter(
    (m) =>
      (!q || `${m.name ?? ''} ${m.email}`.toLowerCase().includes(q)) &&
      (!roleFilter || m.role === roleFilter) &&
      (!teamFilter || m.groupIds.includes(teamFilter)),
  );
  const meMember = dir.members.find((m) => m.userId === me);
  const selectable = members.filter(manageable);
  const selectedPeople = dir.members.filter((m) => selected.has(m.userId));
  const allShownSelected = selectable.length > 0 && selectable.every((m) => selected.has(m.userId));
  const transferCandidates = dir.members.filter((m) => m.role !== 'guest' && !removing?.some((r) => r.userId === m.userId));

  function toggleSelect(id: string, on: boolean) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // Esc cierra el aviso; ⌘Z deshace el último cambio fuera de los campos de texto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!toast) return;
      const el = e.target as HTMLElement | null;
      const typing = Boolean(el?.closest?.('input, textarea, select, [contenteditable="true"]'));
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"], [role="alertdialog"]')) setToast(null);
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && toast.undo && !typing) {
        e.preventDefault();
        const run = toast.undo;
        setToast(null);
        void run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toast]);

  const viewingNow = viewing ? dir.members.find((m) => m.userId === viewing.userId) ?? viewing : null;
  const canEditViewing = viewingNow ? manageable(viewingNow) : false;
  const appsLimit: Apps = role === 'owner' ? '*' : actorApps;
  const giveable = appOrder.filter((k) => appsLimit === '*' || appsLimit.includes(k));

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
            <div className="ui-field">
              <label className="label" htmlFor="ws-invite-role">
                {t('role')}
              </label>
              <select id="ws-invite-role" className="select ws-invite-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)}>
                {inviteRoles.includes('admin') && <option value="admin">{t('roles.admin')}</option>}
                <option value="member">{t('roles.member')}</option>
                <option value="guest">{t('roles.guest')}</option>
              </select>
              <p className="ui-help">{t(`roleHelp.${inviteRole}`)}</p>
            </div>
            {inviteRole !== 'guest' && (
              <>
                <AppsPicker value={inviteApps} onChange={setInviteApps} idPrefix="ws-inv-app" order={appOrder} limit={actorApps} />
                <GroupsPicker groups={dir.groups} value={inviteGroups} onChange={setInviteGroups} idPrefix="ws-inv-grp" />
              </>
            )}
            <div className="st-form-foot ws-invite-foot">
              <button type="submit" className="btn btn-primary" disabled={!emails.trim() || busy} aria-busy={busy || undefined}>
                {t('send')}
              </button>
              {inviteRole !== 'admin' && (
                <button type="button" className="btn btn-secondary" onClick={() => void onInviteLink()} disabled={locked} title={tp('inviteLinkHelp')} data-testid="invite-link">
                  {tp('inviteLink')}
                </button>
              )}
            </div>
            {inviteRole !== 'admin' && <p className="ui-help ws-invite-link-help">{tp('inviteLinkHelp')}</p>}
          </form>
          {(results || invalid.length > 0) && (
            <div className="ws-results" role="status" aria-live="polite">
              {invalid.length > 0 && <p className="ui-error">{t('invalidEmails', { list: invalid.join(', ') })}</p>}
              {results?.map((r) => (
                <div key={r.inviteId ?? r.email} className={`ws-result ws-result-${r.status}`} data-testid="invite-result">
                  <span className="data ws-result-email">{r.email || tp('linkInvite')}</span>
                  <span className="ws-result-status">{r.email ? t(`result.${r.status}`) : tp('inviteLinkReady')}</span>
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
        {error && !viewing && !removing && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        <div className="ws-toolbar">
          <div className="ui-field ws-search">
            <label className="sr-only" htmlFor="ws-member-search">
              {t('search')}
            </label>
            <input id="ws-member-search" className="input" type="search" placeholder={t('search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <label className="sr-only" htmlFor="ws-filter-role">
            {tp('filterRole')}
          </label>
          <select id="ws-filter-role" className="select ws-filter" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as '' | Role)}>
            <option value="">{tp('allRoles')}</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </select>
          {dir.groups.length > 0 && (
            <>
              <label className="sr-only" htmlFor="ws-filter-team">
                {tp('filterTeam')}
              </label>
              <select id="ws-filter-team" className="select ws-filter" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
                <option value="">{tp('allTeams')}</option>
                {dir.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        {admin && selectedPeople.length > 0 && (
          <div className="ws-bulk" role="region" aria-label={tp('selected', { count: selectedPeople.length })} data-testid="bulk-bar">
            <span className="ws-bulk-count">{tp('selected', { count: selectedPeople.length })}</span>
            <select className="select ws-bulk-select" aria-label={tp('bulkRole')} value="" disabled={locked} onChange={(e) => onBulkRole(e.target.value)}>
              <option value="">{tp('bulkRole')}</option>
              {inviteRoles.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </select>
            <select className="select ws-bulk-select" aria-label={tp('bulkGive')} value="" disabled={locked} onChange={(e) => onBulkGive(e.target.value)}>
              <option value="">{tp('bulkGive')}</option>
              {giveable.map((k) => (
                <option key={k} value={k}>
                  {PRODUCT_CONFIG[k].name}
                </option>
              ))}
            </select>
            <select className="select ws-bulk-select" aria-label={tp('bulkTake')} value="" disabled={locked} onChange={(e) => onBulkTake(e.target.value)}>
              <option value="">{tp('bulkTake')}</option>
              {appOrder.map((k) => (
                <option key={k} value={k}>
                  {PRODUCT_CONFIG[k].name}
                </option>
              ))}
            </select>
            {dir.groups.length > 0 && (
              <select className="select ws-bulk-select" aria-label={tp('bulkTeam')} value="" disabled={locked} onChange={(e) => onBulkTeam(e.target.value)}>
                <option value="">{tp('bulkTeam')}</option>
                {dir.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className="btn btn-ghost btn-danger btn-sm" disabled={locked} onClick={() => void askRemove(selectedPeople.filter(manageable))}>
              {tp('bulkRemove')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm ws-bulk-clear" onClick={() => setSelected(new Set())}>
              {tp('clear')}
            </button>
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
            ...(admin
              ? [
                  {
                    key: 'select',
                    header: (
                      <input
                        type="checkbox"
                        className="ws-select"
                        aria-label={tp('selectAll')}
                        checked={allShownSelected}
                        disabled={!selectable.length}
                        onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((m) => m.userId)) : new Set())}
                      />
                    ),
                    width: '36px',
                    cell: (m: MemberDto) =>
                      manageable(m) ? (
                        <input type="checkbox" className="ws-select" aria-label={tp('selectPerson', { name: nameOf(m) })} checked={selected.has(m.userId)} onChange={(e) => toggleSelect(m.userId, e.target.checked)} />
                      ) : null,
                  },
                ]
              : []),
            {
              key: 'person',
              header: t('colPerson'),
              cell: (m: MemberDto) => (
                <div className="ws-person" data-testid="member-row" data-email={m.email}>
                  <Avatar m={m} />
                  <span className="ws-person-text" title={`${t('colJoined')}: ${fmt(m.joinedAt)}`}>
                    <span className="st-strong ws-person-name">
                      {peopleLinks ? (
                        <Link href={`/app/people/u/${encodeURIComponent(m.userId)}`} className="ws-person-link" title={t('peopleProfile')}>
                          {nameOf(m)}
                        </Link>
                      ) : (
                        nameOf(m)
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
              cell: (m: MemberDto) =>
                manageable(m) ? (
                  <select
                    className="select ws-role-select"
                    aria-label={t('roleOf', { name: m.name || m.email })}
                    value={m.role}
                    disabled={locked}
                    onChange={(e) => requestRole(m, e.target.value as Exclude<Role, 'owner'>)}
                  >
                    {inviteRoles.includes('admin') && <option value="admin">{t('roles.admin')}</option>}
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
              cell: (m: MemberDto) => (
                <>
                  <span className="ws-cell-muted ws-apps-cell">{appsLabel(m.apps, m.role)}</span>
                  {/* El pedido sigue a la vista aunque el aviso ya se haya leído. */}
                  {answerable(m).length > 0 && manageable(m) && (
                    <button type="button" className="ws-link-btn ws-requested-marker" onClick={() => openAccess(m, true)} data-testid="request-marker">
                      {t('requestedMarker', { apps: answerable(m).map((a) => PRODUCT_CONFIG[a].name).join(', ') })}
                    </button>
                  )}
                </>
              ),
            },
            ...(dir.groups.length
              ? [
                  {
                    key: 'teams',
                    header: t('colTeams'),
                    cell: (m: MemberDto) =>
                      m.groupIds.length ? (
                        <span className="ws-cell-muted">{m.groupIds.map((g) => groupName.get(g)).filter(Boolean).join(', ')}</span>
                      ) : (
                        <span className="st-muted">{t('none')}</span>
                      ),
                  },
                ]
              : []),
            {
              key: 'active',
              header: tp('colLastActive'),
              cell: (m: MemberDto) => (
                <span suppressHydrationWarning className="ws-cell-muted" title={m.lastActiveAt ? fmt(m.lastActiveAt) : undefined}>
                  {m.userId === me ? new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'second') : ago(m.lastActiveAt)}
                </span>
              ),
            },
            {
              key: 'actions',
              header: <span className="sr-only">{t('colActions')}</span>,
              cell: (m: MemberDto) =>
                admin ? (
                  <div className="st-row-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => openAccess(m)} aria-label={tp('accessOf', { name: nameOf(m) })} disabled={locked}>
                      {tp('access')}
                    </button>
                  </div>
                ) : null,
            },
          ]}
        />
        {dir.members.length <= 1 && admin && <p className="ui-help ws-alone">{t('alone')}</p>}
        <details className="ws-roles" data-testid="roles-legend">
          <summary>{t('rolesLegend')}</summary>
          <p className="ui-help">{tp('rolesDesc')}</p>
          <div className="table-wrap ws-matrix-wrap">
            <table className="table table-compact ws-matrix">
              <caption className="sr-only">{t('rolesLegend')}</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">{t('colRole')}</span>
                  </th>
                  {ROLES.map((r) => (
                    <th key={r} scope="col">
                      {t(`roles.${r}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROLE_MATRIX.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{tp(`matrix.${row.key}`)}</th>
                    {ROLES.map((r) => {
                      const yes = can({ role: r }, row.action);
                      return (
                        <td key={r} className={yes ? 'ws-yes' : 'ws-no'}>
                          {row.key === 'useApps' && r === 'guest' ? tp('matrixGuest') : yes ? tp('yes') : tp('no')}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl>
            {ROLES.map((r) => (
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
                      {i.email ? (
                        <>
                          {/* Si no entra en una línea, corta antes de la arroba y no a mitad de palabra. */}
                          {i.email.split('@')[0]}
                          <wbr />@{i.email.split('@').slice(1).join('@')}
                        </>
                      ) : (
                        tp('linkInvite')
                      )}
                    </span>
                    {/* Permitir otro email: un link chico debajo, así la fila no se sale a 1280. */}
                    {i.canAllowAnyEmail && !i.anyEmail && (
                      <button type="button" className="ws-link-btn" onClick={() => void resend(i, true)} disabled={locked} title={t('allowAnyEmailHelp')}>
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
                    <LocalText>
                      {i.kind === 'request'
                        ? t('status.request')
                        : i.expired
                          ? t('status.expired')
                          : i.emailStatus === 'sent'
                            ? t('status.sent', { date: fmt(i.sentAt) })
                            : i.emailStatus === 'failed'
                              ? t('status.failed')
                              : t('status.linkOnly')}
                    </LocalText>
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
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void approve(i)} disabled={locked}>
                        {t('approve')}
                      </button>
                    ) : (
                      <>
                        {i.url && !i.expired && <CopyButton text={i.url} label={t('copyLink')} className="btn btn-ghost btn-sm" />}
                        {i.canResend && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void resend(i)} disabled={locked}>
                            {t('resend')}
                          </button>
                        )}
                      </>
                    )}
                    {i.canRevoke && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-danger btn-sm"
                        onClick={() => setRevoking(i)}
                        disabled={locked}
                        aria-label={t('revokeOf', { email: i.email || tp('linkInvite') })}
                      >
                        {t('revoke')}
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </FormSection>
      )}

      {admin && dir.deactivated.length > 0 && (
        <FormSection title={tp('removedTitle', { count: dir.deactivated.length })} description={tp('removedDesc')}>
          <DataTable
            caption={tp('removedTitle', { count: dir.deactivated.length })}
            rows={dir.deactivated}
            rowKey={(d) => d.userId}
            compact
            className="st-table-stack ws-removed"
            columns={[
              {
                key: 'person',
                header: t('colPerson'),
                cell: (d) => (
                  <div className="ws-person" data-testid="removed-row" data-removed-email={d.email}>
                    <Avatar m={d} />
                    <span className="ws-person-text">
                      <span className="st-strong ws-person-name">{nameOf(d)}</span>
                      <span className="data st-muted ws-person-email">{d.email}</span>
                    </span>
                  </div>
                ),
              },
              { key: 'role', header: t('colRole'), cell: (d) => <span className="ws-cell-muted">{t(`roles.${d.role}`)}</span> },
              { key: 'when', header: tp('colStatus'), cell: (d) => <span className="ws-cell-muted">{tp('removedOn', { date: fmt(d.removedAt) })}</span> },
              {
                key: 'actions',
                header: <span className="sr-only">{t('colActions')}</span>,
                cell: (d) =>
                  canManageRole(role, d.role) && (d.role !== 'admin' || role === 'owner') ? (
                    <div className="st-row-actions">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void addBack(d.userId)} disabled={locked} aria-label={tp('addBackOf', { name: nameOf(d) })}>
                        {tp('addBack')}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void forget(d.userId)} disabled={locked} aria-label={tp('forgetOf', { name: nameOf(d) })}>
                        {tp('forget')}
                      </button>
                    </div>
                  ) : null,
              },
            ]}
          />
        </FormSection>
      )}

      {admin && (
        <FormSection title={tp('logTitle')} description={tp('logDesc')}>
          {dir.audit.length === 0 ? (
            <EmptyState quiet compact title={tp('logEmpty')} />
          ) : (
            <ol className="ws-log" data-testid="audit-log">
              {dir.audit.slice(0, 20).map((a) => (
                <li key={a.id} className="ws-log-item">
                  <span className="ws-log-line">{logLine(a)}</span>
                  <time suppressHydrationWarning className="data st-muted ws-log-time" dateTime={a.createdAt} title={fmt(a.createdAt)}>
                    {ago(a.createdAt)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </FormSection>
      )}

      <QuickModal
        open={viewing !== null}
        onClose={closeAccess}
        title={tp('accessTitle', { name: viewingNow ? nameOf(viewingNow) : '' })}
        onSubmit={closeAccess}
        submitLabel={tp('done')}
        cancelLabel={t('cancel')}
        busy={busy}
        error={viewing ? error : null}
        width={560}
        footExtra={
          viewingNow && canEditViewing ? (
            <>
              {answerable(viewingNow).length > 0 && (
                <button type="button" className="btn btn-secondary" onClick={() => void deny()} disabled={locked} data-testid="deny-request">
                  {t('denyRequest')}
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-danger"
                onClick={() => {
                  const m = viewingNow;
                  closeAccess();
                  void askRemove([m]);
                }}
                disabled={locked}
                aria-label={t('removeOf', { name: viewingNow.name || viewingNow.email })}
              >
                {t('remove')}
              </button>
            </>
          ) : undefined
        }
      >
        {viewingNow && (
          <div className="ws-access" data-testid="access-view">
            {answerable(viewingNow).length > 0 && canEditViewing && (
              <div className="ws-request-line" data-testid="request-line">
                <p>{t('requestLine', { name: nameOf(viewingNow), apps: answerable(viewingNow).map((a) => PRODUCT_CONFIG[a].name).join(', ') })}</p>
                {viewingNow.apps !== '*' && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void approveRequest(viewingNow)} disabled={locked} data-testid="approve-request" autoFocus={fromRequest}>
                    {tp('approveRequest', { apps: answerable(viewingNow).map((a) => PRODUCT_CONFIG[a].name).join(', ') })}
                  </button>
                )}
              </div>
            )}
            <div className="ws-access-head">
              <Avatar m={viewingNow} />
              <span className="ws-person-text">
                <span className="st-strong">{viewingNow.email}</span>
                <span className="ws-cell-muted">{t(`roleLegend.${viewingNow.role}`)}</span>
              </span>
              {canEditViewing && (
                <select
                  className="select ws-role-select"
                  aria-label={t('roleOf', { name: viewingNow.name || viewingNow.email })}
                  value={viewingNow.role}
                  disabled={locked}
                  onChange={(e) => requestRole(viewingNow, e.target.value as Exclude<Role, 'owner'>)}
                >
                  {inviteRoles.includes('admin') && <option value="admin">{t('roles.admin')}</option>}
                  <option value="member">{t('roles.member')}</option>
                  <option value="guest">{t('roles.guest')}</option>
                </select>
              )}
            </div>

            <section className="ws-access-block" aria-labelledby="ws-access-apps">
              <h3 id="ws-access-apps" className="ws-access-title">
                {t('apps')}
              </h3>
              {viewingNow.role === 'owner' ? (
                <p className="ui-help">{tp('ownerAll')}</p>
              ) : viewingNow.role === 'guest' ? (
                <p className="ui-help">{tp('guestApps')}</p>
              ) : (
                <>
                  {canEditViewing && (appsLimit === '*' || viewingNow.apps === '*') && (
                    <label className="ui-check ws-access-all">
                      <input
                        type="checkbox"
                        checked={viewingNow.apps === '*'}
                        disabled={appsLimit !== '*' && viewingNow.apps !== '*'}
                        onChange={(e) => void changeApps(viewingNow, e.target.checked ? '*' : [...appOrder], tp('toast.apps', { name: nameOf(viewingNow) }))}
                      />
                      <span>{t('allApps')}</span>
                    </label>
                  )}
                  <ul className="ws-access-apps">
                    {appOrder.map((k) => {
                      const on = viewingNow.apps === '*' || viewingNow.apps.includes(k);
                      const detail = view?.apps.find((a) => a.app === k)?.detail;
                      const canToggle = canEditViewing && viewingNow.apps !== '*' && (on || appsLimit === '*' || appsLimit.includes(k));
                      const canTurnOff = canEditViewing && viewingNow.apps === '*';
                      return (
                        <li key={k} className={`ws-access-app${on ? ' is-on' : ''}`}>
                          <label className="ui-check" htmlFor={`ws-acc-${k}`}>
                            <input
                              id={`ws-acc-${k}`}
                              type="checkbox"
                              checked={on}
                              disabled={!(canToggle || canTurnOff)}
                              onChange={(e) => toggleApp(viewingNow, k, e.target.checked)}
                            />
                            <span>{PRODUCT_CONFIG[k].name}</span>
                          </label>
                          <span className="ws-cell-muted ws-access-detail">
                            {on ? (detail ? <LocalText>{detail}</LocalText> : tp('allowed')) : tp('notAllowed')}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {canEditViewing && <p className="ui-help">{tp('appsHelp')}</p>}
                </>
              )}
            </section>

            {viewingNow.role !== 'guest' && (
              <section className="ws-access-block" aria-labelledby="ws-access-caps" data-testid="caps-section">
                <h3 id="ws-access-caps" className="ws-access-title">
                  {tp('capsTitle')}
                </h3>
                {viewingNow.role === 'member' ? (
                  <>
                    <p className="ui-help">{tp('capsIntro')}</p>
                    <ul className="ws-access-caps">
                      {CAPABILITIES.map((c) => {
                        const k = capabilityMessageKey(c.key) as 'lines_numbers_manage';
                        const on = (viewingNow.caps ?? []).includes(c.key);
                        const appOn = viewingNow.apps === '*' || viewingNow.apps.includes(c.app as ProductKey);
                        return (
                          <li key={c.key} className={`ws-access-cap${on ? ' is-on' : ''}`}>
                            <input
                              id={`ws-cap-${k}`}
                              type="checkbox"
                              className="ws-access-cap-input"
                              checked={on}
                              disabled={!canEditViewing}
                              aria-describedby={`ws-cap-${k}-help`}
                              onChange={(e) => requestCap(viewingNow, c.key, e.target.checked)}
                              data-testid={`cap-${c.key}`}
                            />
                            <span className="ws-access-cap-text">
                              <label htmlFor={`ws-cap-${k}`} className="st-strong">
                                {tp(`caps.${k}.label`)}
                              </label>
                              <span id={`ws-cap-${k}-help`} className="ui-help">
                                {tp(`caps.${k}.help`)}
                              </span>
                              {on && !appOn && (
                                <span className="ui-help ws-access-cap-warn" role="note">
                                  {tp('capsNeedsApp', { app: PRODUCT_CONFIG[c.app as ProductKey].name })}
                                </span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : (
                  <p className="ui-help">{tp('capsByRole')}</p>
                )}
              </section>
            )}

            {viewingNow.role !== 'guest' && dir.groups.length > 0 && (
              <section className="ws-access-block">
                {canEditViewing ? (
                  <GroupsPicker groups={dir.groups} value={viewingNow.groupIds} onChange={(v) => void changeTeams(viewingNow, v)} idPrefix="ws-acc-grp" disabled={locked} />
                ) : (
                  <>
                    <h3 className="ws-access-title">{t('teams')}</h3>
                    <p className="ws-cell-muted">{viewingNow.groupIds.map((g) => groupName.get(g)).filter(Boolean).join(', ') || tp('noTeams')}</p>
                  </>
                )}
              </section>
            )}

            {viewState === 'loading' && !view && (
              <p className="ui-help" role="status">
                {tp('loading')}
              </p>
            )}
            {viewState === 'error' && (
              <p className="ui-error" role="alert">
                {tp('loadError')}{' '}
                <button type="button" className="ws-link-btn" onClick={() => void loadView(viewingNow.userId)}>
                  {tp('retry')}
                </button>
              </p>
            )}
            {view && (
              <>
                <section className="ws-access-block" aria-labelledby="ws-access-shared">
                  <h3 id="ws-access-shared" className="ws-access-title">
                    {tp('sharedTitle')}
                  </h3>
                  {Object.entries(view.shared).filter(([, n]) => n > 0).length === 0 ? (
                    <p className="ws-cell-muted">{tp('sharedNone')}</p>
                  ) : (
                    <ul className="ws-access-list">
                      {Object.entries(view.shared)
                        .filter(([, n]) => n > 0)
                        .map(([k, n]) => (
                          <li key={k}>{tp(`shared.${k}` as 'shared.docs', { count: n })}</li>
                        ))}
                    </ul>
                  )}
                </section>
                {viewingNow.role !== 'guest' && (
                  <section className="ws-access-block" aria-labelledby="ws-access-work">
                    <h3 id="ws-access-work" className="ws-access-title">
                      {tp('workTitle')}
                    </h3>
                    {view.owned.trackIssues + view.owned.crmRecords === 0 ? (
                      <p className="ws-cell-muted">{tp('workNone')}</p>
                    ) : (
                      <ul className="ws-access-list">
                        {view.owned.trackIssues > 0 && <li>{tp('work.trackIssues', { count: view.owned.trackIssues })}</li>}
                        {view.owned.crmRecords > 0 && <li>{tp('work.crmRecords', { count: view.owned.crmRecords })}</li>}
                      </ul>
                    )}
                  </section>
                )}
                <section className="ws-access-block" aria-labelledby="ws-access-history">
                  <h3 id="ws-access-history" className="ws-access-title">
                    {tp('historyTitle')}
                  </h3>
                  {view.history.length === 0 ? (
                    <p className="ws-cell-muted">{tp('historyNone')}</p>
                  ) : (
                    <ol className="ws-log">
                      {view.history.slice(0, 8).map((a) => (
                        <li key={a.id} className="ws-log-item">
                          <span className="ws-log-line">{logLine(a)}</span>
                          <time suppressHydrationWarning className="data st-muted ws-log-time" dateTime={a.createdAt} title={fmt(a.createdAt)}>
                            {ago(a.createdAt)}
                          </time>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </>
            )}
          </div>
        )}
      </QuickModal>

      <ConfirmDialog
        open={removing !== null}
        danger
        busy={busy}
        title={
          removing && removing.length === 1
            ? t('removeTitle', { name: removing[0].name || removing[0].email, workspace: dir.team.name })
            : tp('removeManyTitle', { count: removing?.length ?? 0, workspace: dir.team.name })
        }
        body={
          <div className="ws-remove-body">
            <p>{tp('removeBody')}</p>
            {transferCandidates.length > 0 && (removing?.length !== 1 || !owned || owned.trackIssues + owned.crmRecords > 0) && (
              <div className="ui-field">
                <label className="label" htmlFor="ws-transfer">
                  {tp('transfer')}
                </label>
                <select id="ws-transfer" className="select" value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
                  <option value="">{tp('transferNone')}</option>
                  {transferCandidates.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {nameOf(m)}
                    </option>
                  ))}
                </select>
                <p className="ui-help">{owned ? tp('transferCount', { issues: owned.trackIssues, records: owned.crmRecords }) : tp('transferHelp')}</p>
              </div>
            )}
            {error && removing && (
              <p className="ui-error" role="alert">
                {error}
              </p>
            )}
          </div>
        }
        confirmLabel={t('remove')}
        cancelLabel={t('cancel')}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
      <ConfirmDialog
        open={revoking !== null}
        danger
        busy={busy}
        title={t('revokeConfirm.title', { email: revoking?.email || tp('linkInvite') })}
        body={t('revokeConfirm.body')}
        confirmLabel={t('revokeConfirm.confirm')}
        cancelLabel={t('revokeConfirm.cancel')}
        onConfirm={() => void revoke()}
        onCancel={() => setRevoking(null)}
      />
      <ConfirmDialog
        open={promoting !== null}
        busy={busy}
        title={tp('promoteTitle', { name: promoting ? nameOf(promoting) : '' })}
        body={tp('promoteBody')}
        confirmLabel={tp('promoteConfirm')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          const m = promoting;
          setPromoting(null);
          if (m) void changeRole(m, 'admin');
        }}
        onCancel={() => setPromoting(null)}
      />
      <ConfirmDialog
        open={bulkPromote}
        busy={busy}
        title={tp('promoteManyTitle', { count: selected.size })}
        body={tp('promoteBody')}
        confirmLabel={tp('promoteConfirm')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          setBulkPromote(false);
          void bulk((m) => (m.role === 'admin' ? null : { role: 'admin' }));
        }}
        onCancel={() => setBulkPromote(false)}
      />
      <ConfirmDialog
        open={granting !== null}
        busy={busy}
        title={tp('capGrantTitle', {
          name: granting ? nameOf(granting.m) : '',
          cap: granting ? tp(`caps.${capabilityMessageKey(granting.cap)}.label` as 'caps.lines_numbers_manage.label') : '',
        })}
        body={granting ? tp(`caps.${capabilityMessageKey(granting.cap)}.confirm` as 'caps.lines_numbers_manage.confirm') : ''}
        confirmLabel={tp('capGrantConfirm')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          const g = granting;
          setGranting(null);
          if (g) void toggleCap(g.m, g.cap, true);
        }}
        onCancel={() => setGranting(null)}
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

      {toast && (
        <div className="ui-toasts" role="status" aria-live="polite">
          <div className="ui-toast" data-testid="members-toast">
            <span>{toast.label}</span>
            {toast.undo && (
              <button
                type="button"
                className="ui-toast-action"
                aria-keyshortcuts="Meta+Z Control+Z"
                data-testid="members-undo"
                onClick={() => {
                  const run = toast.undo!;
                  setToast(null);
                  void run();
                }}
              >
                {tp('undo')}
              </button>
            )}
            <button type="button" className="ui-toast-action" onClick={() => setToast(null)} aria-label={tp('dismiss')}>
              ×
            </button>
          </div>
        </div>
      )}
    </>
  );
}

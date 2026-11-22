'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import SearchClear from '@/components/app/SearchClear';
import Avatar from './Avatar';
import { MessageMenu, type MenuItem } from './Menu';
import { ChatIcon, Close, CopyIcon, LinkIcon, Search, UserPlus } from './icons';
import { Modal, useErrorText } from '../dialog-kit';
import { parseNewChatPhone } from '@/lib/groups-new-chat-shared';
import type { MemberTargetResult, ParticipantErrorReason } from '@/lib/wa-group-members';

/*
 * "Miembros" del panel de info de un grupo, como en WhatsApp (Lines e Inbox):
 * arriba "Agregar miembros" (contactos de la línea o de la cuenta, o un número
 * escrito; varios a la vez) e "Invitar con link"; cada persona con "Admin del
 * grupo" y un ⋯ siempre visible con Mensaje, Hacer admin / Quitar como admin y
 * Quitar del grupo. Si el número conectado no es admin del grupo, todo eso se
 * ve deshabilitado con la explicación. Los cambios se ven al instante y se
 * corrigen con lo que responde WhatsApp; los rechazos van por persona.
 */

export type GroupMemberRole = 'member' | 'admin' | 'superadmin';

export interface GroupMember {
  phone: string;
  name: string;
  role: GroupMemberRole;
  picture?: string;
  /** El número conectado (la línea o la cuenta de Inbox). */
  me?: boolean;
  /** Teléfono oculto para quien mira: se actúa con `ref`. */
  masked?: boolean;
  ref?: string;
}

export interface MemberContact {
  key: string;
  name: string;
  phoneLabel: string;
  /** Dígitos; vacío si quien mira no ve los teléfonos (va `ref`). */
  phone: string;
  ref?: string;
  pictureUrl?: string;
}

export type MemberActionName = 'add' | 'remove' | 'promote' | 'demote';
export interface MemberTargets {
  phones: string[];
  refs: string[];
}
export type MemberRunResult = { ok: true; results: MemberTargetResult[]; members: GroupMember[] } | { ok: false; error: string };

interface Issue {
  key: string;
  label: string;
  error: ParticipantErrorReason;
  target: MemberTargets;
}

const targetOf = (m: { phone: string; ref?: string; masked?: boolean }): MemberTargets => (m.ref && (m.masked || !m.phone) ? { phones: [], refs: [m.ref] } : { phones: [m.phone], refs: [] });

export default function GroupMembers({
  members: initial,
  size,
  groupName,
  canManage,
  unsupported,
  run,
  searchContacts,
  getInviteLink,
  sendInvite,
  initialLink = '',
  onOpen,
  onMessage,
  showPhone,
  toast,
  onMembers,
  limit = 300,
  more,
  focusAdd = false,
  children,
}: {
  members: GroupMember[];
  /** Total de WhatsApp si es mayor que la lista (participantes sin teléfono). */
  size?: number;
  groupName: string;
  /** El proveedor maneja grupos. */
  canManage: boolean;
  /** Texto si no se puede (Cloud API). */
  unsupported?: ReactNode;
  run: (action: MemberActionName, targets: MemberTargets) => Promise<MemberRunResult>;
  searchContacts: (q: string) => Promise<MemberContact[]>;
  getInviteLink?: (revoke: boolean) => Promise<{ link: string } | { error: string }>;
  sendInvite?: (targets: MemberTargets, text: string) => Promise<{ results: MemberTargetResult[] } | { error: string }>;
  initialLink?: string;
  onOpen?: (m: GroupMember) => void;
  onMessage?: (m: GroupMember) => void;
  showPhone: (phone: string) => string;
  toast: (text: string, error?: boolean) => void;
  onMembers?: (list: GroupMember[]) => void;
  limit?: number;
  /** "Ver los N" (Lines compacto): link a la página del grupo. */
  more?: (n: number) => ReactNode;
  /** El botón "Agregar miembros" se enfoca al abrir (atajo desde la tarjeta del grupo). */
  focusAdd?: boolean;
  children?: ReactNode;
}) {
  const t = useTranslations('groups.wa.members');
  const tw = useTranslations('groups.wa');
  const errText = useErrorText();
  const [members, setMembers] = useState(initial);
  const [pending, setPending] = useState<GroupMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [forcedNotAdmin, setForcedNotAdmin] = useState(false);
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(limit);
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState(initialLink);
  const [linkBusy, setLinkBusy] = useState(false);
  const addBtn = useRef<HTMLButtonElement>(null);

  const initialKey = initial.map((m) => `${m.phone}:${m.role}`).join(',');
  useEffect(() => setMembers(initial), [initialKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setLink(initialLink), [initialLink]);
  useEffect(() => {
    if (focusAdd) addBtn.current?.focus();
  }, [focusAdd]);

  const self = members.find((m) => m.me);
  const notAdmin = forcedNotAdmin || self?.role === 'member';
  const locked = !canManage || notAdmin;
  const nameOf = (m: { name: string; phone: string; me?: boolean }) => (m.me ? t('you') : m.name || showPhone(m.phone));

  const list = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/^\+/, '');
    const all = [...members, ...pending.filter((p) => !members.some((m) => m.phone === p.phone))];
    return s ? all.filter((m) => `${m.name} ${m.phone}`.toLowerCase().includes(s)) : all;
  }, [members, pending, q]);

  function apply(next: GroupMember[]) {
    setMembers(next);
    onMembers?.(next);
  }

  function noteIssues(res: MemberTargetResult[], labels: Map<string, string>, targets: Map<string, MemberTargets>) {
    const bad = res.filter((r) => !r.ok && r.error);
    setIssues(
      bad.map((r) => ({
        key: r.key,
        label: labels.get(r.key) || (r.phone ? showPhone(r.phone) : r.key),
        error: r.error!,
        target: targets.get(r.key) ?? { phones: r.phone && !r.key.includes(':') ? [r.phone] : [], refs: r.key.includes(':') ? [r.key] : [] },
      })),
    );
    return bad.length;
  }

  /** Hacer admin, quitar como admin o quitar: se ve ya, y vuelve atrás si WhatsApp no lo acepta. */
  async function change(m: GroupMember, action: 'promote' | 'demote' | 'remove') {
    const before = members;
    if (action === 'remove') apply(members.filter((x) => x !== m));
    else apply(members.map((x) => (x === m ? { ...x, role: action === 'promote' ? 'admin' : 'member' } : x)));
    setIssues([]);
    setBusy(true);
    const res = await run(action, targetOf(m));
    setBusy(false);
    if (!res.ok) {
      apply(before);
      if (res.error === 'not_group_admin') setForcedNotAdmin(true);
      toast(errText(res.error), true);
      return;
    }
    apply(res.members);
    const key = m.masked && m.ref ? m.ref : m.phone;
    const mine = res.results.find((r) => r.key === key) ?? res.results[0];
    if (mine && !mine.ok) {
      noteIssues(res.results, new Map([[key, nameOf(m)]]), new Map([[key, targetOf(m)]]));
      return;
    }
    toast(t(action === 'promote' ? 'promoted' : action === 'demote' ? 'dismissed' : 'removed', { name: nameOf(m) }));
  }

  async function add(picked: MemberContact[]) {
    setAdding(false);
    setIssues([]);
    const labels = new Map<string, string>();
    const targets = new Map<string, MemberTargets>();
    const phones: string[] = [];
    const refs: string[] = [];
    for (const c of picked) {
      const key = c.phone ? c.phone : c.ref!;
      labels.set(key, c.name || c.phoneLabel);
      if (c.phone) {
        phones.push(c.phone);
        targets.set(key, { phones: [c.phone], refs: [] });
      } else if (c.ref) {
        refs.push(c.ref);
        targets.set(key, { phones: [], refs: [c.ref] });
      }
    }
    // Se ven enseguida, como "Agregando…", y se reemplazan por lo que diga WhatsApp.
    setPending(picked.map((c) => ({ phone: c.phone || c.key, name: c.name || c.phoneLabel, role: 'member', picture: c.pictureUrl })));
    setBusy(true);
    const res = await run('add', { phones, refs });
    setBusy(false);
    setPending([]);
    if (!res.ok) {
      if (res.error === 'not_group_admin') setForcedNotAdmin(true);
      toast(errText(res.error), true);
      return;
    }
    apply(res.members);
    const okN = res.results.filter((r) => r.ok).length;
    noteIssues(res.results, labels, targets);
    if (okN) toast(t('added', { n: okN }));
  }

  async function invite(revoke = false) {
    if (!getInviteLink) return;
    setLinkBusy(true);
    const res = await getInviteLink(revoke);
    setLinkBusy(false);
    if ('error' in res) {
      if (res.error === 'not_group_admin') setForcedNotAdmin(true);
      toast(errText(res.error), true);
      return;
    }
    setLink(res.link);
    if (revoke) toast(t('linkReset'));
    else if (!res.link.startsWith('sample:')) {
      void navigator.clipboard?.writeText(res.link).catch(() => null);
      toast(t('linkCopied'));
    }
  }

  async function sendLinks(list: Issue[]) {
    if (!sendInvite) return;
    const targets: MemberTargets = { phones: list.flatMap((i) => i.target.phones), refs: list.flatMap((i) => i.target.refs) };
    setBusy(true);
    const res = await sendInvite(targets, t('inviteText', { group: groupName }));
    setBusy(false);
    if ('error' in res) {
      toast(errText(res.error), true);
      return;
    }
    const sent = res.results.filter((r) => r.ok).length;
    if (sent) toast(t('inviteSent', { n: sent }));
    const sentKeys = new Set(res.results.filter((r) => r.ok).map((r) => r.key));
    setIssues((all) => all.filter((i) => !list.includes(i) || !sentKeys.has(i.target.phones[0] ?? i.target.refs[0] ?? '')));
    if (sent < list.length) toast(errText('send_failed'), true);
  }

  const privacy = issues.filter((i) => i.error === 'privacy');
  const total = Math.max(size ?? 0, members.length);
  const lockHint = notAdmin ? t('notAdmin') : undefined;

  return (
    <div className="wa-gm" data-testid="group-members" aria-busy={busy || undefined}>
      <h3 className="wa-gm-title">{t('title', { n: total })}</h3>
      {!canManage ? (
        unsupported && <p className="wa-gm-note">{unsupported}</p>
      ) : (
        <>
          <div className="wa-gm-actions">
            <button type="button" ref={addBtn} className="wa-gm-action" data-testid="group-add-members" data-focus-target="add-members" disabled={locked} onClick={() => setAdding(true)}>
              <span className="wa-gm-action-icon" aria-hidden="true">
                <UserPlus size={18} />
              </span>
              {t('add')}
            </button>
            {getInviteLink && (
              <button type="button" className="wa-gm-action" data-testid="group-invite-link" disabled={locked || linkBusy} onClick={() => void invite(false)}>
                <span className="wa-gm-action-icon" aria-hidden="true">
                  <LinkIcon size={18} />
                </span>
                {t('invite')}
              </button>
            )}
          </div>
          {notAdmin && (
            <p className="wa-gm-note is-warn" role="note" data-testid="group-not-admin">
              {t('notAdmin')}
            </p>
          )}
          {link && !locked && (
            link.startsWith('sample:') ? (
              <p className="wa-gm-note" role="status">
                {t('sampleInvite')}
              </p>
            ) : (
              <div className="wa-gm-link">
                <input className="input" readOnly value={link} aria-label={t('invite')} onFocus={(e) => e.target.select()} data-testid="group-invite-value" />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(link).catch(() => null);
                    toast(t('linkCopied'));
                  }}
                >
                  <CopyIcon size={14} /> {t('copy')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={linkBusy} onClick={() => void invite(true)}>
                  {t('reset')}
                </button>
              </div>
            )
          )}
          {issues.length > 0 && (
            <div className="wa-gm-issues" role="alert" data-testid="group-member-issues">
              <div className="wa-gm-issues-head">
                <strong>{t('issuesTitle')}</strong>
                <button type="button" className="wa-icon-btn" aria-label={t('dismiss')} title={t('dismiss')} onClick={() => setIssues([])}>
                  <Close size={16} />
                </button>
              </div>
              <ul>
                {issues.map((i) => (
                  <li key={i.key} data-error={i.error}>
                    <span className="wa-gm-issue-who">{i.label}</span>
                    <span className="wa-gm-issue-why">{t(`errors.${i.error}`)}</span>
                  </li>
                ))}
              </ul>
              {privacy.length > 0 && sendInvite && (
                <button type="button" className="btn btn-secondary btn-sm" data-testid="group-send-invite" disabled={busy} onClick={() => void sendLinks(privacy)}>
                  {t('sendInvite', { n: privacy.length })}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {members.length > 8 && (
        <label className="wa-gm-search">
          <Search size={16} />
          <span className="sr-only">{t('search')}</span>
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} data-clearable="" />
          <SearchClear shown={q !== ''} onClear={() => setQ('')} label={tw('clearSearch')} />
        </label>
      )}

      <ul className="wa-gm-list">
        {list.slice(0, shown).map((m) => {
          const isPending = pending.includes(m);
          const name = nameOf(m);
          const items: MenuItem[] = [];
          if (onMessage && !m.masked) items.push({ key: 'message', label: t('message', { name }), glyph: <ChatIcon size={16} />, onSelect: () => onMessage(m) });
          if (canManage && m.role !== 'superadmin') {
            items.push(
              m.role === 'admin'
                ? { key: 'demote', label: t('dismissAdmin'), disabled: locked, hint: lockHint, onSelect: () => void change(m, 'demote') }
                : { key: 'promote', label: t('makeAdmin'), disabled: locked, hint: lockHint, onSelect: () => void change(m, 'promote') },
              { key: 'remove', label: t('remove', { name }), danger: true, disabled: locked, hint: lockHint, onSelect: () => void change(m, 'remove') },
            );
          }
          const who = (
            <>
              <Avatar name={name} kind="dm" src={m.picture || undefined} size={40} seed={m.phone} />
              <span className="wa-gm-who">
                <span className="wa-gm-name" dir="auto">
                  {name}
                </span>
                {isPending ? (
                  <span className="wa-gm-sub">{t('adding')}</span>
                ) : (
                  !m.me && m.name && <span className="wa-gm-sub wa-gm-phone">{showPhone(m.phone)}</span>
                )}
              </span>
            </>
          );
          return (
            <li key={`${m.phone}-${isPending ? 'p' : 'm'}`} className={`wa-gm-row${isPending ? ' is-pending' : ''}`} data-testid="group-member" data-phone={m.phone} data-role={m.role} data-me={m.me ? '1' : undefined}>
              {onOpen && !m.me && !m.masked && !isPending ? (
                <button type="button" className="wa-gm-open" data-testid="wa-member" onClick={() => onOpen(m)}>
                  {who}
                </button>
              ) : (
                <span className="wa-gm-open">{who}</span>
              )}
              {m.role !== 'member' && !isPending && (
                <span className="wa-gm-badge" data-testid="group-admin-badge">
                  {t('admin')}
                </span>
              )}
              {!m.me && !isPending && items.length > 0 && (
                <MessageMenu label={t('options', { name })} items={items} className="wa-icon-btn wa-gm-more" align="right" />
              )}
            </li>
          );
        })}
      </ul>
      {list.length > shown && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShown((n) => n + 200)}>
          {t('showMore', { n: list.length - shown })}
        </button>
      )}
      {more && !q && more(members.length)}
      {children}

      {adding && (
        <AddMembersDialog
          existing={new Set(members.map((m) => m.phone))}
          searchContacts={searchContacts}
          onClose={() => setAdding(false)}
          onAdd={(picked) => void add(picked)}
        />
      )}
    </div>
  );
}

/** "Agregar miembros": buscar en los contactos o escribir un número, elegir varios y agregar. */
function AddMembersDialog({
  existing,
  searchContacts,
  onClose,
  onAdd,
}: {
  existing: Set<string>;
  searchContacts: (q: string) => Promise<MemberContact[]>;
  onClose: () => void;
  onAdd: (picked: MemberContact[]) => void;
}) {
  const t = useTranslations('groups.wa.members');
  const tw = useTranslations('groups.wa');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<MemberContact[] | null>(null);
  const [picked, setPicked] = useState<MemberContact[]>([]);

  useEffect(() => {
    let live = true;
    const id = setTimeout(async () => {
      const r = await searchContacts(q.trim());
      if (live) setResults(r);
    }, q ? 200 : 0);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [q, searchContacts]);

  const typed = parseNewChatPhone(q);
  const typedEntry: MemberContact | null = typed.ok ? { key: `phone:${typed.phone}`, name: '', phoneLabel: `+${typed.phone}`, phone: typed.phone } : null;
  const isPicked = (c: MemberContact) => picked.some((p) => p.key === c.key || (!!p.phone && p.phone === c.phone));
  const toggle = (c: MemberContact) => setPicked((all) => (isPicked(c) ? all.filter((p) => p.key !== c.key && !(p.phone && p.phone === c.phone)) : [...all, c]));
  const rows = (results ?? []).filter((c) => c.phone || c.ref);

  return (
    <Modal
      open
      title={t('addTitle')}
      onClose={onClose}
      onSubmit={() => picked.length && onAdd(picked)}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={picked.length === 0} data-testid="group-add-confirm">
            {t('addN', { n: picked.length })}
          </button>
        </>
      }
    >
      <div className="wa-gm-dialog">
        <label className="wa-gm-search">
          <Search size={16} />
          <span className="sr-only">{t('searchContacts')}</span>
          <input
            className="input"
            type="search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              // Enter con un número escrito lo suma a la lista (no envía el formulario).
              if (e.key === 'Enter' && typedEntry && !existing.has(typedEntry.phone)) {
                e.preventDefault();
                if (!isPicked(typedEntry)) toggle(typedEntry);
                setQ('');
              }
            }}
            placeholder={t('searchContacts')}
            data-testid="group-add-search"
            data-clearable=""
          />
          <SearchClear shown={q !== ''} onClear={() => setQ('')} label={tw('clearSearch')} />
        </label>
        {picked.length > 0 && (
          <ul className="wa-gm-chips" aria-label={t('selected', { n: picked.length })}>
            {picked.map((c) => (
              <li key={c.key}>
                <span>{c.name || c.phoneLabel}</span>
                <button type="button" aria-label={t('unpick', { name: c.name || c.phoneLabel })} onClick={() => toggle(c)}>
                  <Close size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <ul className="wa-gm-pick" role="list">
          {typedEntry && !rows.some((r) => r.phone === typedEntry.phone) && (
            <li>
              <label className="wa-gm-pick-row">
                <input type="checkbox" checked={isPicked(typedEntry)} disabled={existing.has(typedEntry.phone)} onChange={() => toggle(typedEntry)} data-testid="group-add-typed" />
                <Avatar name={typedEntry.phoneLabel} kind="dm" size={36} seed={typedEntry.phone} />
                <span className="wa-gm-who">
                  <span className="wa-gm-name">{t('addPhone', { phone: typedEntry.phoneLabel })}</span>
                  {existing.has(typedEntry.phone) && <span className="wa-gm-sub">{t('alreadyIn')}</span>}
                </span>
              </label>
            </li>
          )}
          {rows.map((c) => {
            const inGroup = !!c.phone && existing.has(c.phone);
            return (
              <li key={c.key}>
                <label className="wa-gm-pick-row">
                  <input type="checkbox" checked={isPicked(c)} disabled={inGroup} onChange={() => toggle(c)} data-testid="group-add-contact" />
                  <Avatar name={c.name || c.phoneLabel} kind="dm" src={c.pictureUrl || undefined} size={36} seed={c.phone || c.key} />
                  <span className="wa-gm-who">
                    <span className="wa-gm-name" dir="auto">
                      {c.name || c.phoneLabel}
                    </span>
                    <span className="wa-gm-sub">{inGroup ? t('alreadyIn') : c.name ? c.phoneLabel : ''}</span>
                  </span>
                </label>
              </li>
            );
          })}
          {results !== null && rows.length === 0 && !typedEntry && <li className="wa-gm-sub wa-gm-empty">{t('noResults')}</li>}
          {results === null && <li className="ui-skeleton ui-skeleton-row" aria-hidden="true" />}
        </ul>
        <p className="wa-gm-sub">{t('addHelp')}</p>
      </div>
    </Modal>
  );
}

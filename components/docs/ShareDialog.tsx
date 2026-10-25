'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Icon from '@/components/app/icons';
import AdvancedSection from '@/components/ui/AdvancedSection';
import { Link } from '@/i18n/navigation';
import type { DocsMentionableUser, DocsPage, DocsPageShare, DocsShareRole } from '@/lib/docs-types';
import type { DocsGuestInvite } from '@/lib/docs-guests';

const ROLES: DocsShareRole[] = ['full', 'edit', 'comment', 'view'];

export interface ShareRequest {
  kind: 'team' | 'user';
  targetId?: string | null;
  email?: string;
  role: DocsShareRole;
}

interface ShareDialogProps {
  page: DocsPage;
  shares: DocsPageShare[];
  /** Invitaciones pendientes a emails sin cuenta. */
  invites?: DocsGuestInvite[];
  /** Miembro con acceso total: rol de los miembros, publicar e IA (un invitado con acceso total no). */
  canManageWorkspace?: boolean;
  /** Rol que hereda la página si no fija uno (Ajustes o teamspace). */
  memberRoleDefault?: DocsShareRole;
  onRevokeInvite?: (inviteId: string) => void;
  /** Ruta pública del centro de ayuda del workspace (/<locale>/h/<handle>) o null si no hay handle. */
  helpBase: string | null;
  feedback?: { yes: number; no: number } | null;
  onUpdate: (patch: Partial<DocsPage>) => Promise<void> | void;
  onShare: (req: ShareRequest) => Promise<string | null>;
  onRoleChange: (shareId: string, role: DocsShareRole) => void;
  onUnshare: (shareId: string) => void;
  onClose: () => void;
}

interface TeamOption {
  id: string;
  name: string;
}

type Option = { kind: 'team' | 'user'; id: string; label: string; sub: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Compartir, en dos grupos:
 * - Personas: invitar miembros, teams o un email con "Puede ver" / "Puede editar".
 * - Publicar: la página en el centro de ayuda (web pública) y su link. Que la
 *   IA del Chat la use como conocimiento va en Avanzado.
 * Es un <dialog> nativo con showModal(): foco atrapado y Esc sin código propio.
 */
export default function ShareDialog({
  page,
  shares,
  invites = [],
  canManageWorkspace = true,
  memberRoleDefault = 'full',
  onRevokeInvite,
  helpBase,
  feedback,
  onUpdate,
  onShare,
  onRoleChange,
  onUnshare,
  onClose,
}: ShareDialogProps) {
  const t = useTranslations('docs');
  const uid = useId();
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [members, setMembers] = useState<DocsMentionableUser[]>([]);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Option | null>(null);
  const [role, setRole] = useState<DocsShareRole>('view');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let alive = true;
    fetch('/api/teams')
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows?: TeamOption[] }) => alive && setTeams(d.rows ?? []))
      .catch(() => {});
    fetch('/api/docs/members')
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows?: DocsMentionableUser[] }) => alive && setMembers((d.rows ?? []).filter((m) => m.id !== page.user_id)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [page.user_id]);

  const sharedKeys = new Set(shares.map((s) => `${s.kind}:${s.target_id}`));
  // Propios arriba (se editan acá); los heredados abajo, con la página de donde vienen.
  const ownShares = shares.filter((s) => !s.inherited_from);
  const inheritedShares = shares.filter((s) => s.inherited_from);
  const inherits = page.inherit_shares !== false;
  const options: Option[] = useMemo(() => {
    const all: Option[] = [
      ...members.map((m) => ({ kind: 'user' as const, id: m.id, label: m.name || m.email, sub: m.email })),
      ...teams.map((x) => ({ kind: 'team' as const, id: x.id, label: x.name, sub: t('share.kinds.team') })),
    ];
    const q = query.trim().toLowerCase();
    return all
      .filter((o) => !sharedKeys.has(`${o.kind}:${o.id}`))
      .filter((o) => !q || o.label.toLowerCase().includes(q) || o.sub.toLowerCase().includes(q))
      .slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, teams, query, shares]);

  useEffect(() => setActiveIdx(0), [query]);

  const labelFor = (share: DocsPageShare): { label: string; sub: string } => {
    if (share.kind === 'team') {
      return { label: teams.find((x) => x.id === share.target_id)?.name ?? t('share.kinds.team'), sub: t('share.kinds.team') };
    }
    if (share.kind === 'user') {
      const m = members.find((x) => x.id === share.target_id);
      if (m) return { label: m.name || m.email, sub: m.email };
      const email = share.target_email ?? '';
      return { label: share.target_name || email || t('share.kinds.user'), sub: share.guest ? `${t('share.guest')} · ${email}` : email };
    }
    return { label: t('share.kinds.public'), sub: t('share.publicHelp') };
  };

  const roleOptions = (current?: DocsShareRole) =>
    ROLES.map((r) => (
      <option key={r} value={r} disabled={r === 'full' && !canManageWorkspace && current !== 'full'}>
        {t(`share.roles.${r}`)}
      </option>
    ));

  const canInvite = Boolean(picked) || EMAIL_RE.test(query.trim());
  const listOpen = suggestOpen && !picked && options.length > 0;
  const listId = `${uid}-suggest`;

  function pick(o: Option) {
    setPicked(o);
    setSuggestOpen(false);
    setError(null);
  }

  async function invite() {
    if (!canInvite || busy) return;
    setBusy(true);
    setError(null);
    const req: ShareRequest = picked
      ? { kind: picked.kind, targetId: picked.id, role }
      : { kind: 'user', email: query.trim().toLowerCase(), role };
    const code = await onShare(req);
    setBusy(false);
    if (code) {
      setError(
        code === 'user_not_found'
          ? t('share.userNotFound')
          : code === 'guests_disabled'
            ? t('share.guestsDisabled')
            : code === 'invite_limit'
              ? t('share.inviteLimit')
              : t('share.error'),
      );
      return;
    }
    setQuery('');
    setPicked(null);
    inputRef.current?.focus();
  }

  const publicPath = helpBase && page.slug ? `${helpBase}/${page.slug}` : null;
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* sin permiso de portapapeles */
    }
  }

  const titleId = `${uid}-title`;
  const peopleId = `${uid}-people`;
  const publishId = `${uid}-publish`;
  const errorId = `${uid}-error`;

  return (
    <dialog
      ref={dialogRef}
      className="ui-modal docs-share"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        // Esc con la lista de sugerencias abierta cierra solo la lista.
        if (listOpen) {
          e.preventDefault();
          setSuggestOpen(false);
        }
      }}
      onMouseDown={(e) => {
        // Clic en el telón (fuera de la caja) cierra.
        if (e.target === e.currentTarget) dialogRef.current?.close();
      }}
    >
      <div className="ui-modal-head">
        <h2 className="ui-modal-title" id={titleId}>
          {t('share.title')}
        </h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon"
          onClick={() => dialogRef.current?.close()}
          aria-label={t('share.close')}
          title={t('share.close')}
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="ui-modal-body docs-share-body">
        <section className="docs-share-group" aria-labelledby={peopleId}>
          <h3 className="docs-share-h" id={peopleId}>
            {t('share.people')}
          </h3>
          <form
            className="docs-invite"
            onSubmit={(e) => {
              e.preventDefault();
              invite();
            }}
          >
            <div className="docs-invite-field">
              <input
                ref={inputRef}
                className="input"
                type="text"
                role="combobox"
                aria-expanded={listOpen}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={listOpen ? `${listId}-${activeIdx}` : undefined}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                autoComplete="off"
                value={picked ? picked.label : query}
                onChange={(e) => {
                  setPicked(null);
                  setQuery(e.target.value);
                  setSuggestOpen(true);
                  setError(null);
                }}
                onFocus={() => setSuggestOpen(true)}
                onBlur={() => setTimeout(() => setSuggestOpen(false), 120)}
                onKeyDown={(e) => {
                  if (listOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                    e.preventDefault();
                    const n = options.length;
                    setActiveIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
                    return;
                  }
                  if (e.key === 'Enter' && listOpen && !EMAIL_RE.test(query.trim())) {
                    e.preventDefault();
                    pick(options[activeIdx] ?? options[0]);
                    return;
                  }
                  if (e.key === 'Backspace' && picked) {
                    e.preventDefault();
                    setPicked(null);
                    setQuery('');
                  }
                }}
                placeholder={t('share.invitePlaceholder')}
                aria-label={t('share.invitePlaceholder')}
              />
              {listOpen && (
                <ul className="docs-menu docs-invite-suggest" role="listbox" id={listId} aria-label={t('share.suggestions')}>
                  {options.map((o, i) => (
                    <li
                      key={`${o.kind}:${o.id}`}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === activeIdx}
                      className={`docs-menu-item docs-invite-option${i === activeIdx ? ' sel' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => pick(o)}
                    >
                      <span className="docs-invite-label">{o.label}</span>
                      <span className="docs-invite-sub">{o.sub}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <select
              className="select docs-invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as DocsShareRole)}
              aria-label={t('share.role')}
            >
              {roleOptions()}
            </select>
            <button type="submit" className="btn btn-primary" disabled={!canInvite || busy} aria-busy={busy || undefined}>
              {t('share.invite')}
            </button>
          </form>
          {error && (
            <p className="ui-error" id={errorId} role="alert">
              {error}
            </p>
          )}

          <ul className="docs-access-list">
            <li className="docs-access-row">
              <span className="docs-access-who">
                <span className="docs-access-name">{t('share.workspace')}</span>
                <span className="docs-invite-sub">{t('share.workspaceHelp')}</span>
              </span>
              {canManageWorkspace ? (
                // "Todos en el workspace": el rol de los miembros (no admins) en esta página y sus subpáginas.
                <select
                  className="select docs-access-select"
                  value={page.member_role ?? ''}
                  onChange={(e) => onUpdate({ member_role: (e.target.value || null) as DocsShareRole | null })}
                  aria-label={`${t('share.role')}: ${t('share.workspace')}`}
                  data-testid="docs-member-role"
                >
                  <option value="">{t('share.inheritRole', { role: t(`share.roles.${memberRoleDefault}`) })}</option>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`share.roles.${r}`)}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="docs-access-role">{t(`share.roles.${page.member_role ?? memberRoleDefault}`)}</span>
              )}
            </li>
            {invites.map((inv) => (
              <li key={inv.id} className="docs-access-row" data-testid="docs-access-invite">
                <span className="docs-access-who">
                  <span className="docs-access-name">{inv.email}</span>
                  <span className="docs-invite-sub">{t('share.invitePending')}</span>
                </span>
                <span className="docs-access-role">{t(`share.roles.${inv.role}`)}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-icon"
                  onClick={() => onRevokeInvite?.(inv.id)}
                  aria-label={`${t('share.revokeInvite')}: ${inv.email}`}
                  title={t('share.revokeInvite')}
                >
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
            {ownShares.map((share) => {
              const who = labelFor(share);
              return (
                <li key={share.id} className="docs-access-row" data-testid="docs-access-own">
                  <span className="docs-access-who">
                    <span className="docs-access-name">{who.label}</span>
                    <span className="docs-invite-sub">{who.sub}</span>
                  </span>
                  {share.kind === 'public' ? (
                    <span className="docs-access-role">{t('share.roles.view')}</span>
                  ) : (
                    <select
                      className="select docs-access-select"
                      value={share.role}
                      onChange={(e) => onRoleChange(share.id, e.target.value as DocsShareRole)}
                      aria-label={`${t('share.role')}: ${who.label}`}
                    >
                      {roleOptions(share.role)}
                    </select>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-icon"
                    onClick={() => onUnshare(share.id)}
                    aria-label={`${t('share.remove')}: ${who.label}`}
                    title={t('share.remove')}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </li>
              );
            })}
            {inheritedShares.map((share) => {
              const who = labelFor(share);
              const from = share.inherited_from!;
              return (
                <li key={share.id} className="docs-access-row docs-access-inherited" data-testid="docs-access-inherited">
                  <span className="docs-access-who">
                    <span className="docs-access-name">{who.label}</span>
                    <span className="docs-invite-sub">
                      {t.rich('share.inheritedFrom', {
                        page: from.title || t('untitled'),
                        link: (chunks) => (
                          <Link href={`/app/docs/${from.id}`} className="docs-inline-link">
                            {chunks}
                          </Link>
                        ),
                      })}
                    </span>
                  </span>
                  {share.kind === 'public' ? (
                    <span className="docs-access-role">{t('share.roles.view')}</span>
                  ) : (
                    // Cambiar el rol acá crea un share propio de esta página que
                    // pisa al heredado (la página padre no se toca).
                    <select
                      className="select docs-access-select"
                      value={share.role}
                      onChange={(e) =>
                        onShare({
                          kind: share.kind as 'team' | 'user',
                          targetId: share.target_id,
                          role: e.target.value as DocsShareRole,
                        })
                      }
                      aria-label={`${t('share.role')}: ${who.label}`}
                      title={t('share.overrideHelp')}
                    >
                      {roleOptions(share.role)}
                    </select>
                  )}
                  {/* Se quita desde la página de origen o cortando la herencia. */}
                  <span className="docs-access-spacer" aria-hidden="true" />
                </li>
              );
            })}
          </ul>

          {page.parent_id && canManageWorkspace && (
            <label className="ui-switch docs-switch-row docs-inherit-row">
              <input
                type="checkbox"
                role="switch"
                checked={inherits}
                onChange={(e) => onUpdate({ inherit_shares: e.target.checked })}
                data-testid="docs-inherit-switch"
              />
              <span className="docs-switch-text">
                <span className="docs-switch-label">{t('share.inherit')}</span>
                <span className="ui-help">{inherits ? t('share.inheritOnHelp') : t('share.inheritOffHelp')}</span>
              </span>
            </label>
          )}
        </section>

        {canManageWorkspace && (
        <section className="docs-share-group" aria-labelledby={publishId}>
          <h3 className="docs-share-h" id={publishId}>
            {t('share.publishSection')}
          </h3>
          <label className="ui-switch docs-switch-row">
            <input
              type="checkbox"
              role="switch"
              checked={Boolean(page.published)}
              disabled={!helpBase}
              onChange={(e) => onUpdate({ published: e.target.checked })}
            />
            <span className="docs-switch-text">
              <span className="docs-switch-label">{t('share.publish')}</span>
              <span className="ui-help">{helpBase ? t('share.publishHelp') : t('share.publishNoHandle')}</span>
            </span>
          </label>

          {page.published && publicPath && (
            <div className="ui-field docs-public">
              <label className="label" htmlFor={`${uid}-url`}>
                {t('share.publicLink')}
              </label>
              <div className="ui-input-group">
                <input
                  id={`${uid}-url`}
                  className="input data"
                  readOnly
                  value={`${origin}${publicPath}`}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  type="button"
                  className="btn btn-secondary docs-public-copy"
                  onClick={() => copy(`${window.location.origin}${publicPath}`)}
                >
                  {copied ? t('share.copied') : t('share.copyPublic')}
                </button>
              </div>
              <span className="ui-help docs-public-meta">
                <a href={publicPath} target="_blank" rel="noopener noreferrer" className="docs-inline-link">
                  {t('share.openPublic')}
                </a>
                {feedback && feedback.yes + feedback.no > 0 && <span>{t('share.feedbackStats', feedback)}</span>}
              </span>
            </div>
          )}

          <AdvancedSection storageKey="docs.share" hint={page.is_public ? t('share.aiHintOn') : t('share.aiHintOff')}>
            <label className="ui-switch docs-switch-row">
              <input
                type="checkbox"
                role="switch"
                checked={page.is_public}
                onChange={(e) => onUpdate({ is_public: e.target.checked })}
              />
              <span className="docs-switch-text">
                <span className="docs-switch-label">{t('share.ai')}</span>
                <span className="ui-help">{t('share.aiHelp')}</span>
              </span>
            </label>
          </AdvancedSection>
        </section>
        )}
      </div>

      {/* Publicada, "Abrir" ya lleva al artículo: el pie solo aparece sin publicar. */}
      {helpBase && !(page.published && publicPath) && (
        <div className="ui-modal-foot">
          <a href={helpBase} target="_blank" rel="noopener noreferrer" className="ui-foot-note docs-inline-link">
            {t('share.openHelpCenter')}
          </a>
        </div>
      )}
    </dialog>
  );
}

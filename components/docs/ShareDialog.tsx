'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Icon from '@/components/app/icons';
import AdvancedSection from '@/components/ui/AdvancedSection';
import type { DocsMentionableUser, DocsPage, DocsPageShare, DocsShareRole } from '@/lib/docs-types';

export interface ShareRequest {
  kind: 'team' | 'user';
  targetId?: string | null;
  email?: string;
  role: DocsShareRole;
}

interface ShareDialogProps {
  page: DocsPage;
  shares: DocsPageShare[];
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
  const [copied, setCopied] = useState<'public' | 'internal' | null>(null);
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
      return m ? { label: m.name || m.email, sub: m.email } : { label: t('share.kinds.user'), sub: share.target_id ?? '' };
    }
    return { label: t('share.kinds.public'), sub: t('share.publicHelp') };
  };

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
      setError(code === 'user_not_found' ? t('share.userNotFound') : t('share.error'));
      return;
    }
    setQuery('');
    setPicked(null);
    inputRef.current?.focus();
  }

  const publicPath = helpBase && page.slug ? `${helpBase}/${page.slug}` : null;
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  async function copy(text: string, which: 'public' | 'internal') {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
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
              <option value="view">{t('share.roles.view')}</option>
              <option value="edit">{t('share.roles.edit')}</option>
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
              <span className="docs-access-role">{t('share.roles.owner')}</span>
            </li>
            {shares.map((share) => {
              const who = labelFor(share);
              return (
                <li key={share.id} className="docs-access-row">
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
                      <option value="view">{t('share.roles.view')}</option>
                      <option value="edit">{t('share.roles.edit')}</option>
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
          </ul>
        </section>

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
                  onClick={() => copy(`${window.location.origin}${publicPath}`, 'public')}
                >
                  {copied === 'public' ? t('share.copied') : t('share.copyPublic')}
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

          <AdvancedSection storageKey="docs.share" hint={t('share.aiHint')}>
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
      </div>

      <div className="ui-modal-foot">
        {helpBase && (
          <a href={helpBase} target="_blank" rel="noopener noreferrer" className="ui-foot-note docs-inline-link">
            {t('share.openHelpCenter')}
          </a>
        )}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(window.location.href, 'internal')}>
          {copied === 'internal' ? t('share.copied') : t('share.copyLink')}
        </button>
      </div>
    </dialog>
  );
}

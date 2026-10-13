'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
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
 * Diálogo de compartir (como Notion / Google Docs):
 * - Invitar miembros o teams (o una persona por email) con "Puede ver" / "Puede editar".
 * - Publicar en el centro de ayuda (página web pública) y copiar el link.
 * - Permitir que la IA del Chat la use (antes "pública").
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
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [members, setMembers] = useState<DocsMentionableUser[]>([]);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Option | null>(null);
  const [role, setRole] = useState<DocsShareRole>('view');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<'public' | 'internal' | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

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
    inputRef.current?.focus();
    return () => {
      alive = false;
    };
  }, [page.user_id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
  }

  const publicUrl = helpBase && page.slug ? `${helpBase}/${page.slug}` : null;

  async function copy(text: string, which: 'public' | 'internal') {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* sin permiso de portapapeles */
    }
  }

  return (
    <div className="docs-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="docs-dialog" role="dialog" aria-modal="true" aria-labelledby="docs-share-title" ref={dialogRef}>
        <div className="docs-dialog-head">
          <h2 id="docs-share-title">{t('share.title')}</h2>
          <button type="button" className="docs-dialog-close" onClick={onClose} aria-label={t('editor.closePanel')}>
            ×
          </button>
        </div>

        <section className="docs-dialog-section">
          <div className="docs-invite">
            <div className="docs-invite-field">
              <input
                ref={inputRef}
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
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (!picked && options.length > 0 && !EMAIL_RE.test(query.trim())) {
                      setPicked(options[0]);
                      setSuggestOpen(false);
                    } else invite();
                  }
                  if (e.key === 'Backspace' && picked) {
                    setPicked(null);
                    setQuery('');
                  }
                }}
                placeholder={t('share.invitePlaceholder')}
                aria-label={t('share.invitePlaceholder')}
              />
              {suggestOpen && !picked && options.length > 0 && (
                <ul className="docs-invite-suggest" role="listbox">
                  {options.map((o) => (
                    <li key={`${o.kind}:${o.id}`}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setPicked(o);
                          setSuggestOpen(false);
                        }}
                      >
                        <span>{o.label}</span>
                        <span className="docs-invite-sub">{o.sub}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <select value={role} onChange={(e) => setRole(e.target.value as DocsShareRole)} aria-label={t('share.role')}>
              <option value="view">{t('share.roles.view')}</option>
              <option value="edit">{t('share.roles.edit')}</option>
            </select>
            <button type="button" className="btn btn-solid btn-small" onClick={invite} disabled={!canInvite || busy}>
              {t('share.invite')}
            </button>
          </div>
          {error && <p className="docs-dialog-error">{error}</p>}

          <ul className="docs-access-list">
            <li className="docs-access-row">
              <span className="docs-access-who">
                <span>{t('share.workspace')}</span>
                <span className="docs-invite-sub">{t('share.workspaceHelp')}</span>
              </span>
              <span className="docs-access-role">{t('share.roles.owner')}</span>
            </li>
            {shares.map((share) => {
              const who = labelFor(share);
              return (
                <li key={share.id} className="docs-access-row">
                  <span className="docs-access-who">
                    <span>{who.label}</span>
                    <span className="docs-invite-sub">{who.sub}</span>
                  </span>
                  {share.kind === 'public' ? (
                    <span className="docs-access-role">{t('share.roles.view')}</span>
                  ) : (
                    <select
                      value={share.role}
                      onChange={(e) => onRoleChange(share.id, e.target.value as DocsShareRole)}
                      aria-label={t('share.role')}
                    >
                      <option value="view">{t('share.roles.view')}</option>
                      <option value="edit">{t('share.roles.edit')}</option>
                    </select>
                  )}
                  <button
                    type="button"
                    className="docs-access-remove"
                    onClick={() => onUnshare(share.id)}
                    aria-label={t('share.remove')}
                    title={t('share.remove')}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="docs-dialog-section">
          <label className="docs-switch-row">
            <span className="docs-switch-text">
              <span>{t('share.publish')}</span>
              <span className="docs-invite-sub">
                {helpBase ? t('share.publishHelp') : t('share.publishNoHandle')}
              </span>
            </span>
            <input
              type="checkbox"
              className="docs-switch"
              checked={Boolean(page.published)}
              disabled={!helpBase}
              onChange={(e) => onUpdate({ published: e.target.checked })}
            />
          </label>
          {page.published && publicUrl && (
            <div className="docs-public-link">
              <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="docs-public-url mono">
                {publicUrl}
              </a>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => copy(`${window.location.origin}${publicUrl}`, 'public')}
              >
                {copied === 'public' ? t('share.copied') : t('share.copyPublic')}
              </button>
            </div>
          )}
          {page.published && feedback && feedback.yes + feedback.no > 0 && (
            <p className="docs-invite-sub docs-feedback-stats">{t('share.feedbackStats', feedback)}</p>
          )}

          <label className="docs-switch-row">
            <span className="docs-switch-text">
              <span>{t('share.ai')}</span>
              <span className="docs-invite-sub">{t('share.aiHelp')}</span>
            </span>
            <input
              type="checkbox"
              className="docs-switch"
              checked={page.is_public}
              onChange={(e) => onUpdate({ is_public: e.target.checked })}
            />
          </label>
        </section>

        <div className="docs-dialog-foot">
          {helpBase && (
            <a href={helpBase} target="_blank" rel="noopener noreferrer" className="docs-dialog-link">
              {t('share.openHelpCenter')}
            </a>
          )}
          <button type="button" className="btn btn-small" onClick={() => copy(window.location.href, 'internal')}>
            {copied === 'internal' ? t('share.copied') : t('share.copyLink')}
          </button>
        </div>
      </div>
    </div>
  );
}

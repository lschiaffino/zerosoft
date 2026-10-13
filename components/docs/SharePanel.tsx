'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DocsMentionableUser, DocsPage, DocsPageShare } from '@/lib/docs-types';

interface SharePanelProps {
  page: DocsPage;
  shares: DocsPageShare[];
  onUpdate: (patch: Partial<DocsPage>) => void;
  onShare: (kind: 'public' | 'team' | 'user', targetId?: string | null) => void;
  onUnshare: (shareId: string) => void;
}

interface TeamOption {
  id: string;
  name: string;
}

/**
 * Compartir: en vez de pedir IDs a mano (antes: input "Team ID"), lista los
 * teams propios y los miembros del workspace en un solo selector.
 */
export default function SharePanel({ page, shares, onUpdate, onShare, onUnshare }: SharePanelProps) {
  const t = useTranslations('docs');
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [members, setMembers] = useState<DocsMentionableUser[]>([]);
  const [target, setTarget] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/teams')
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows?: TeamOption[] }) => alive && setTeams(d.rows ?? []))
      .catch(() => {});
    fetch('/api/docs/members')
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows?: DocsMentionableUser[] }) =>
        alive && setMembers((d.rows ?? []).filter((m) => m.id !== page.user_id)),
      )
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [page.user_id]);

  const labelFor = (share: DocsPageShare): string => {
    if (share.kind === 'team') return teams.find((x) => x.id === share.target_id)?.name ?? share.target_id ?? '';
    if (share.kind === 'user') {
      const m = members.find((x) => x.id === share.target_id);
      return m ? m.name || m.email : share.target_id ?? '';
    }
    return t('share.public');
  };

  const sharedIds = new Set(shares.map((s) => `${s.kind}:${s.target_id}`));
  const teamOptions = teams.filter((x) => !sharedIds.has(`team:${x.id}`));
  const memberOptions = members.filter((x) => !sharedIds.has(`user:${x.id}`));

  const submit = () => {
    const [kind, id] = target.split(':') as ['team' | 'user', string];
    if (!kind || !id) return;
    onShare(kind, id);
    setTarget('');
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* sin permiso de portapapeles */
    }
  };

  return (
    <div className="docs-share">
      <p className="section-label">{t('share.title')}</p>

      <label className="docs-share-row">
        <input
          type="checkbox"
          checked={page.is_public}
          onChange={(e) => onUpdate({ is_public: e.target.checked })}
        />
        <span>
          {t('share.public')}
          <small className="docs-share-help">{t('share.publicHelp')}</small>
        </span>
      </label>

      {(teamOptions.length > 0 || memberOptions.length > 0) && (
        <div className="docs-share-form">
          <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label={t('share.with')}>
            <option value="">{t('share.with')}</option>
            {teamOptions.length > 0 && (
              <optgroup label={t('share.team')}>
                {teamOptions.map((x) => (
                  <option key={x.id} value={`team:${x.id}`}>
                    {x.name}
                  </option>
                ))}
              </optgroup>
            )}
            {memberOptions.length > 0 && (
              <optgroup label={t('share.user')}>
                {memberOptions.map((m) => (
                  <option key={m.id} value={`user:${m.id}`}>
                    {m.name || m.email}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <button type="button" className="btn btn-small" onClick={submit} disabled={!target}>
            {t('share.share')}
          </button>
        </div>
      )}

      {shares.length > 0 ? (
        <ul className="docs-share-list">
          {shares.map((share) => (
            <li key={share.id} className="docs-share-item">
              <span className="docs-share-kind">{t(`share.kinds.${share.kind}`)}</span>
              <span className="docs-share-target">{labelFor(share)}</span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => onUnshare(share.id)}
                aria-label={t('share.remove')}
                title={t('share.remove')}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        teamOptions.length === 0 && memberOptions.length === 0 && <p className="docs-share-help">{t('share.noTargets')}</p>
      )}

      <button type="button" className="btn btn-small docs-share-copy" onClick={copyLink}>
        {copied ? t('share.copied') : t('share.copyLink')}
      </button>
    </div>
  );
}

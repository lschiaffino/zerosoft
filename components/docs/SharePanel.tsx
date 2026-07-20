'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DocsPage, DocsPageShare } from '@/lib/docs-types';

interface SharePanelProps {
  page: DocsPage;
  shares: DocsPageShare[];
  onUpdate: (patch: Partial<DocsPage>) => void;
  onShare: (kind: 'public' | 'team' | 'user', targetId?: string | null) => void;
  onUnshare: (shareId: string) => void;
}

export default function SharePanel({ page, shares, onUpdate, onShare, onUnshare }: SharePanelProps) {
  const t = useTranslations('docs');
  const [kind, setKind] = useState<'public' | 'team' | 'user'>('team');
  const [targetId, setTargetId] = useState('');

  const publicShare = shares.find((s) => s.kind === 'public');

  return (
    <div className="docs-share panel">
      <p className="section-label">{t('share.title')}</p>

      <label className="docs-share-row">
        <input
          type="checkbox"
          checked={page.is_public}
          onChange={(e) => onUpdate({ is_public: e.target.checked })}
        />
        <span>{t('share.public')}</span>
      </label>

      <div className="docs-share-list">
        {shares.map((share) => (
          <div key={share.id} className="docs-share-item">
            <span className="docs-share-kind">{share.kind}</span>
            {share.target_id && <span className="docs-share-target mono">{share.target_id}</span>}
            <button type="button" className="icon-btn" onClick={() => onUnshare(share.id)}>
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="docs-share-form">
        <select value={kind} onChange={(e) => setKind(e.target.value as 'public' | 'team' | 'user')}>
          <option value="team">{t('share.team')}</option>
          <option value="user">{t('share.user')}</option>
        </select>
        {kind !== 'public' && (
          <input
            className="input"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            placeholder={kind === 'team' ? t('share.teamId') : t('share.userId')}
          />
        )}
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            onShare(kind, kind === 'public' ? null : targetId || null);
            setTargetId('');
          }}
        >
          {t('share.share')}
        </button>
      </div>

      {publicShare && (
        <p className="docs-share-url mono">{`${typeof window !== 'undefined' ? window.location.origin : ''}/app/docs/${page.id}`}</p>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DocsPage } from '@/lib/docs-types';
import DocsBlocksView from './DocsBlocksView';
import VersionsPanel from './VersionsPanel';

/** Página compartida con permiso de lectura: sin editor, con export y versiones (solo ver). */
export default function DocsReadOnlyView({ page, sharedBy }: { page: DocsPage; sharedBy: string | null }) {
  const t = useTranslations('docs');
  const [versions, setVersions] = useState(false);

  return (
    <div className={`docs-editor-wrap${versions ? ' has-side' : ''}`}>
      <div className="docs-editor docs-readonly">
        <div className="docs-top-bar">
          <p className="docs-readonly-note">
            {sharedBy ? t('share.readOnlyBanner', { name: sharedBy }) : t('share.readOnly')}
          </p>
          <div className="docs-page-actions">
            <button type="button" className={`docs-top-btn${versions ? ' on' : ''}`} onClick={() => setVersions((v) => !v)}>
              {t('versions.title')}
            </button>
            <a className="docs-top-btn" href={`/api/docs/pages/${page.id}/export?format=md`} download>
              {t('export.markdownShort')}
            </a>
            <button type="button" className="docs-top-btn" onClick={() => window.print()}>
              {t('export.pdfShort')}
            </button>
          </div>
        </div>
        <div className="docs-page-header">
          <h1 className="docs-readonly-title">
            {page.icon && <span aria-hidden>{page.icon} </span>}
            {page.title || t('untitled')}
          </h1>
        </div>
        <DocsBlocksView blocks={page.content} className="docs-readonly-body" />
      </div>
      <div className="docs-side" hidden={!versions}>
        <button type="button" className="docs-side-close" onClick={() => setVersions(false)} aria-label={t('editor.closePanel')}>
          ×
        </button>
        {versions && <VersionsPanel pageId={page.id} canEdit={false} onRestored={() => {}} />}
      </div>
    </div>
  );
}

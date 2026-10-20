'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Icon from '@/components/app/icons';
import type { DocsPage } from '@/lib/docs-types';
import DocsBlocksView from './DocsBlocksView';
import VersionsPanel from './VersionsPanel';

/** Página compartida con permiso de lectura: sin editor, con export y versiones (solo ver). */
export default function DocsReadOnlyView({
  page,
  sharedBy,
  showVersions = true,
}: {
  page: DocsPage;
  sharedBy: string | null;
  /** Falso cuando el acceso viene solo de estar publicada en el centro de ayuda. */
  showVersions?: boolean;
}) {
  const t = useTranslations('docs');
  const [versions, setVersions] = useState(false);

  return (
    <div className={`docs-editor-wrap${versions ? ' has-side' : ''}`}>
      <div className={`docs-editor docs-readonly${page.small_text ? ' docs-editor-small' : ''}${page.full_width ? ' docs-editor-full' : ''}`}>
        <div className="docs-top-bar">
          <p className="docs-readonly-note">
            <span className="badge">{t('share.readOnly')}</span>
            {sharedBy && <span>{t('sidebar.sharedBy', { name: sharedBy })}</span>}
          </p>
          <div className="docs-page-actions">
            {showVersions && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-pressed={versions}
                onClick={() => setVersions((v) => !v)}
              >
                {t('versions.title')}
              </button>
            )}
            <a className="btn btn-ghost btn-sm" href={`/api/docs/pages/${page.id}/export?format=md`} download>
              {t('export.markdownShort')}
            </a>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.print()}>
              {t('export.pdfShort')}
            </button>
          </div>
        </div>
        <div className="docs-page-header">
          {page.icon && <span className="docs-icon" aria-hidden="true">{page.icon}</span>}
          <h1 className="docs-title docs-readonly-title">{page.title || t('untitled')}</h1>
        </div>
        <DocsBlocksView blocks={page.content} pageId={page.id} className="docs-prose docs-readonly-body" />
      </div>
      <aside className="docs-side" hidden={!versions} aria-label={t('versions.title')}>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon docs-side-close"
          onClick={() => setVersions(false)}
          aria-label={t('editor.closePanel')}
          title={t('editor.closePanel')}
        >
          <Icon name="close" size={16} />
        </button>
        {versions && showVersions && <VersionsPanel pageId={page.id} canEdit={false} onRestored={() => {}} />}
      </aside>
    </div>
  );
}

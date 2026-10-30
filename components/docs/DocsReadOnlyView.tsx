'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import Icon from '@/components/app/icons';
import type { DocsPage } from '@/lib/docs-types';
import DocsBlocksView from './DocsBlocksView';
import DocsPageIcon from './DocsPageIcon';
import { DocsStaticCover } from './DocsStaticCover';
import VersionsPanel from './VersionsPanel';
import { useDocsCoedit } from './useDocsCoedit';
import type { DocsEditorApi } from './useDocsCollab';
import type { DocsBlock } from '@/lib/docs-types';

/**
 * Lectura en vivo (como Notion): lo que escriben las demás personas aparece
 * tecla por tecla, y si se le quita el acceso deja de ver la página en el acto.
 * Solo con acceso interno (no si la ve porque está publicada).
 */
function useLiveBlocks(pageId: string, initial: DocsBlock[], enabled: boolean) {
  const [blocks, setBlocks] = useState(initial);
  const [revoked, setRevoked] = useState(false);
  const ref = useRef(blocks);
  ref.current = blocks;
  const api = useRef<DocsEditorApi | null>(null);
  api.current = {
    blockText: (id: string) => ref.current.find((b) => b.id === id)?.content ?? null,
    busy: () => false,
    applyBlockText: (changes: Record<string, string>) => {
      const next = ref.current.map((b) => (b.id in changes ? { ...b, content: changes[b.id] } : b));
      ref.current = next;
      setBlocks(next);
    },
  } as unknown as DocsEditorApi;
  const session = useRef('');
  if (!session.current) session.current = `v${Math.random().toString(36).slice(2, 14)}`;
  const coedit = useDocsCoedit({
    pageId,
    session: session.current,
    canSend: false,
    enabled: enabled && !revoked,
    editorApi: api,
    bypassLock: () => false,
    selfUserId: null,
    onCursor: () => {},
    onLeave: () => {},
    // Otra persona cambió la estructura (bloques nuevos, borrados, movidos): se trae la página.
    onSaved: () => {
      void fetch(`/api/docs/pages/${pageId}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((p: { content?: DocsBlock[] } | null) => {
          if (!p?.content) return;
          ref.current = p.content;
          setBlocks(p.content);
          coedit.register(p.content, true);
        })
        .catch(() => undefined);
    },
    onAccess: () => {},
    onRevoked: () => setRevoked(true),
  });
  const register = coedit.register;
  useEffect(() => {
    register(initial, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);
  return { blocks, revoked };
}

/** Página compartida con permiso de lectura: sin editor, con export y versiones (solo ver). */
export default function DocsReadOnlyView({
  page,
  sharedBy,
  showVersions = true,
  people,
  allowExport = true,
  coedit = true,
}: {
  /** Exportar habilitado (Ajustes › Seguridad). */
  allowExport?: boolean;
  /** Edición simultánea prendida (ajuste del workspace y DOCS_COEDIT): ve escribir en vivo. */
  coedit?: boolean;
  page: DocsPage;
  sharedBy: string | null;
  /** Miembros del workspace dueño (propiedades persona de las bases). */
  people?: Record<string, string>;
  /** Falso cuando el acceso viene solo de estar publicada en el centro de ayuda. */
  showVersions?: boolean;
}) {
  const t = useTranslations('docs');
  const locale = useLocale();
  const [versions, setVersions] = useState(false);
  const live = useLiveBlocks(page.id, page.content, showVersions && coedit);

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
            {allowExport && (
              <>
                <a className="btn btn-ghost btn-sm" href={`/api/docs/pages/${page.id}/export?format=md`} download>
                  {t('export.markdownShort')}
                </a>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.print()}>
                  {t('export.pdfShort')}
                </button>
              </>
            )}
          </div>
        </div>
        {page.cover_url && <DocsStaticCover pageId={page.id} value={page.cover_url} position={page.cover_position} />}
        <div className="docs-page-header">
          {page.icon && (
            <span className="docs-icon" aria-hidden="true">
              <DocsPageIcon icon={page.icon} pageId={page.id} size={56} />
            </span>
          )}
          <h1 className="docs-title docs-readonly-title">{page.title || t('untitled')}</h1>
        </div>
        {live.revoked && (
          <div className="docs-banner docs-banner-bad" role="alert" data-testid="docs-access-revoked">
            <span>{t('coedit.revokedView')}</span>
            <a href={`/${locale}/app/docs`} className="btn btn-secondary btn-sm">
              {t('coedit.backToDocs')}
            </a>
          </div>
        )}
        {!live.revoked && <DocsBlocksView blocks={live.blocks} pageId={page.id} people={people} locale={locale} syncedNoAccess={t('editor.synced.noAccess')} className="docs-prose docs-readonly-body" />}
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

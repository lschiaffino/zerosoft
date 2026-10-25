'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { DOC_TEMPLATE_CATEGORIES, getDocTemplates, type DocTemplate, type DocTemplateCategory } from '@/lib/docs-templates';
import type { DocsWorkspaceTemplate } from '@/lib/docs-types';
import DocsBlocksView from './DocsBlocksView';
import DocsGlyph from './DocsGlyphs';
// Estilos de la vista de solo lectura (.dbv: listas con sangría y viñeta): la
// galería también se abre desde /app/docs, que no los cargaba.
import '@/styles/help.css';

type Section = DocTemplateCategory | 'workspace';

/**
 * Galería de plantillas (como la de Notion): secciones a la izquierda, la
 * lista y una vista previa del contenido. "Usar" crea una página nueva o,
 * desde una página vacía, la llena con la plantilla.
 */
export default function DocsTemplateGallery({
  open,
  onClose,
  workspaceTemplates = [],
  onUseBuiltIn,
  onUseWorkspace,
}: {
  open: boolean;
  onClose: () => void;
  workspaceTemplates?: DocsWorkspaceTemplate[];
  onUseBuiltIn: (tpl: DocTemplate) => void | Promise<void>;
  onUseWorkspace?: (templateId: string) => void | Promise<void>;
}) {
  const t = useTranslations('docs');
  const locale = useLocale();
  const ref = useRef<HTMLDialogElement | null>(null);
  const templates = useMemo(() => getDocTemplates(locale), [locale]);
  const [section, setSection] = useState<Section>('work');
  const [selected, setSelected] = useState<string>('meeting');
  const [pending, startTransition] = useTransition();
  const sections: Section[] = [...DOC_TEMPLATE_CATEGORIES, ...(workspaceTemplates.length ? (['workspace'] as const) : [])];

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const list = section === 'workspace' ? [] : templates.filter((x) => x.category === section);
  const current = section === 'workspace' ? null : templates.find((x) => x.key === selected) ?? list[0] ?? null;
  const currentWs = section === 'workspace' ? workspaceTemplates.find((x) => x.id === selected) ?? workspaceTemplates[0] ?? null : null;
  // La vista previa se arma una vez por plantilla elegida.
  const preview = useMemo(() => (current ? current.makeBlocks() : []), [current]);

  const use = () => {
    startTransition(async () => {
      if (current) await onUseBuiltIn(current);
      else if (currentWs && onUseWorkspace) await onUseWorkspace(currentWs.id);
      onClose();
    });
  };

  return (
    <dialog
      ref={ref}
      className="docs-template-gallery"
      aria-label={t('templates.gallery')}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="docs-template-gallery"
    >
      {open && (
        <div className="docs-tg">
          <nav className="docs-tg-sections" aria-label={t('templates.sections')}>
            <p className="docs-tg-heading">{t('templates.gallery')}</p>
            {sections.map((s) => (
              <button
                key={s}
                type="button"
                className={`docs-tg-section${section === s ? ' active' : ''}`}
                aria-current={section === s ? 'true' : undefined}
                onClick={() => {
                  setSection(s);
                  setSelected(s === 'workspace' ? workspaceTemplates[0]?.id ?? '' : templates.find((x) => x.category === s)?.key ?? '');
                }}
              >
                {t(`templates.categories.${s}`)}
              </button>
            ))}
          </nav>
          <div className="docs-tg-list" role="listbox" aria-label={t(`templates.categories.${section}`)}>
            {section === 'workspace'
              ? workspaceTemplates.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    role="option"
                    aria-selected={currentWs?.id === w.id}
                    className={`docs-tg-item${currentWs?.id === w.id ? ' active' : ''}`}
                    onClick={() => setSelected(w.id)}
                    onDoubleClick={use}
                  >
                    <span className="docs-tg-item-title">{w.title || t('templates.untitled')}</span>
                    {w.description && <span className="docs-tg-item-desc">{w.description}</span>}
                  </button>
                ))
              : list.map((x) => (
                  <button
                    key={x.key}
                    type="button"
                    role="option"
                    aria-selected={current?.key === x.key}
                    className={`docs-tg-item${current?.key === x.key ? ' active' : ''}`}
                    onClick={() => setSelected(x.key)}
                    onDoubleClick={use}
                    data-testid={`docs-template-${x.key}`}
                  >
                    <span className="docs-tg-item-title">{x.title || t('templates.blank')}</span>
                    <span className="docs-tg-item-desc">{x.description}</span>
                  </button>
                ))}
          </div>
          <div className="docs-tg-preview">
            <div className="docs-tg-preview-bar">
              <span className="docs-tg-preview-title">{current ? current.title || t('templates.blank') : currentWs?.title || t('templates.untitled')}</span>
              <button type="button" className="btn btn-primary btn-sm" onClick={use} disabled={pending || (!current && !currentWs)} data-testid="docs-template-use">
                {pending ? t('templates.using') : t('templates.useThis')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label={t('templates.close')} title={t('templates.close')}>
                <DocsGlyph name="close" size={16} />
              </button>
            </div>
            <div className="docs-tg-preview-body" aria-label={t('templates.preview')}>
              {current ? (
                <>
                  <h1 className="docs-tg-preview-h1">{current.title || t('templates.blank')}</h1>
                  <DocsBlocksView blocks={preview} className="docs-prose" />
                </>
              ) : currentWs ? (
                <p className="docs-tg-preview-note">{currentWs.description || t('templates.workspaceDesc')}</p>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}

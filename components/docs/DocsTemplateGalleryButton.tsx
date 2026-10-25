'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DocsWorkspaceTemplate } from '@/lib/docs-types';
import DocsTemplateGallery from './DocsTemplateGallery';
import DocsGlyph from './DocsGlyphs';

/** "Plantillas": abre la galería y crea una página nueva con la elegida (server actions). */
export default function DocsTemplateGalleryButton({
  createFromTemplate,
  createFromWorkspace,
  workspaceTemplates,
  className = 'btn',
}: {
  createFromTemplate: (key: string) => Promise<void>;
  createFromWorkspace: (id: string) => Promise<void>;
  workspaceTemplates: DocsWorkspaceTemplate[];
  className?: string;
}) {
  const t = useTranslations('docs');
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-haspopup="dialog" data-testid="docs-templates-open">
        <DocsGlyph name="template" size={15} />
        {t('templates.browse')}
      </button>
      <DocsTemplateGallery
        open={open}
        onClose={() => setOpen(false)}
        workspaceTemplates={workspaceTemplates}
        onUseBuiltIn={(tpl) => createFromTemplate(tpl.key)}
        onUseWorkspace={(id) => createFromWorkspace(id)}
      />
    </>
  );
}

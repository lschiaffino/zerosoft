import type { TourDef } from './index';

/**
 * Tour de Docs (como Notion). Textos en common.json › tour.docs.
 * Arranca en el inicio de Docs (/app/docs) y sigue en la página que se abre:
 * el paso "abrí una página" se cumple con el clic en una fila de la lista, y
 * el motor sigue montado en el layout de Docs al cambiar de página.
 * Mismos pasos para todos: compartir sirve igual sola o con un equipo.
 * Anclajes `data-tour`:
 *   docs-new        app/[locale]/app/docs/(home)/page.tsx (Nueva página del inicio)
 *   docs-templates  components/docs/DocsTemplateGalleryButton.tsx (galería de plantillas)
 *   docs-pages      components/docs/DocsSidebar.tsx (árbol de páginas sin Buscar, o el aviso sin páginas; en el teléfono, el botón Páginas)
 *   docs-search     components/docs/DocsSidebar.tsx (Buscar, Cmd+P)
 *   docs-item       app/[locale]/app/docs/(home)/page.tsx (cada página de Recientes; gana la primera)
 *   docs-title      components/docs/DocsEditor.tsx (título de la página)
 *   docs-comments   components/docs/DocsEditorClient.tsx (Comentarios)
 *   docs-share      components/docs/DocsEditorClient.tsx (Compartir)
 *   docs-page-menu  components/docs/DocsEditor.tsx (menú de la página: versiones, exportar, bloquear)
 * En el teléfono la búsqueda vive en el cajón de páginas: ese paso se saltea.
 * Sin páginas, abrir una y los pasos de la página se saltean.
 */
export const DOCS_TOUR = {
  key: 'docs',
  startPath: '/app/docs',
  paths: ['/app/docs'],
  steps: [
    { id: 'intro' },
    { id: 'newPage', targets: ['docs-new'] },
    { id: 'templates', targets: ['docs-templates'] },
    { id: 'pages', targets: ['docs-pages'] },
    { id: 'search', targets: ['docs-search'] },
    { id: 'openPage', targets: ['docs-item'], advanceOn: 'click' },
    { id: 'write', targets: ['docs-title'] },
    { id: 'comments', targets: ['docs-comments'] },
    { id: 'share', targets: ['docs-share'] },
    { id: 'pageMenu', targets: ['docs-page-menu'] },
    { id: 'shortcuts', keyboard: true },
    { id: 'done' },
  ],
} as const satisfies TourDef;

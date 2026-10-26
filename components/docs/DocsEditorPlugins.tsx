'use client';

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import type { DocsBlock } from '@/lib/docs-types';
import { htmlToFlatText } from '@/lib/docs-richtext';
import DocsAiMenu from './DocsAiMenu';
import DocsSyncDialog from './DocsSyncDialog';

/**
 * Lo que el editor le presta a los agregados de la tanda D4 (IA del editor y
 * bases sincronizadas), para que vivan aparte de DocsEditor.tsx.
 */
export interface DocsPluginApi {
  pageId: string;
  getTitle: () => string;
  getBlocks: () => DocsBlock[];
  /** Inserta bloques debajo del bloque `index` (o en su lugar si es una línea vacía). */
  insertBlocks: (index: number, blocks: DocsBlock[], opts?: { replaceEmpty?: boolean }) => void;
  /** Reemplaza el texto [start, end) del bloque `index` por los bloques (un párrafo queda en línea). */
  replaceSelection: (index: number, start: number, end: number, blocks: DocsBlock[]) => void;
  /** Devuelve el cursor al final del bloque (al cerrar sin aceptar). */
  focusBlock: (index: number) => void;
}

export interface DocsPluginHandle {
  /** "Ask AI": sobre la selección del bloque `index` (start/end) o en su línea. */
  openAi: (opts: { index: number; start?: number; end?: number }) => void;
  /** "Base sincronizada": diálogo para elegir el origen; el bloque va en `index`. */
  openSync: (index: number) => void;
  isOpen: () => boolean;
}

function anchorFor(index: number): { top: number; left: number } {
  const el = document.querySelector<HTMLElement>(`.docs-block[data-index="${index}"]`);
  const rect = el?.getBoundingClientRect();
  if (!rect) return { top: 120, left: 80 };
  return { top: Math.min(rect.bottom + 6, window.innerHeight - 160), left: rect.left };
}

const DocsEditorPlugins = forwardRef<DocsPluginHandle, { api: DocsPluginApi }>(({ api }, ref) => {
  const [ai, setAi] = useState<{ index: number; start: number; end: number; selection: string | null; anchor: { top: number; left: number } } | null>(null);
  const [syncAt, setSyncAt] = useState<number | null>(null);
  const accepted = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      openAi: ({ index, start, end }) => {
        const block = api.getBlocks()[index];
        const text = block ? htmlToFlatText(block.content ?? '') : '';
        const hasRange = start !== undefined && end !== undefined && end > start;
        accepted.current = false;
        setAi({
          index,
          start: start ?? 0,
          end: end ?? 0,
          selection: hasRange ? text.slice(start, end) : null,
          anchor: anchorFor(index),
        });
      },
      openSync: (index) => setSyncAt(index),
      isOpen: () => ai !== null || syncAt !== null,
    }),
    [api, ai, syncAt],
  );

  const pageText = useCallback(
    () =>
      api
        .getBlocks()
        .map((b) => htmlToFlatText(b.content ?? ''))
        .filter(Boolean)
        .join('\n'),
    [api],
  );

  return (
    <>
      {ai && (
        <DocsAiMenu
          pageId={api.pageId}
          pageTitle={api.getTitle()}
          pageText={pageText}
          selection={ai.selection}
          before={api
            .getBlocks()
            .slice(0, ai.index + 1)
            .map((b) => htmlToFlatText(b.content ?? ''))
            .filter(Boolean)
            .join('\n')}
          anchor={ai.anchor}
          onReplace={
            ai.selection
              ? (blocks) => {
                  accepted.current = true;
                  api.replaceSelection(ai.index, ai.start, ai.end, blocks);
                }
              : undefined
          }
          onInsert={(blocks) => {
            accepted.current = true;
            api.insertBlocks(ai.index, blocks, { replaceEmpty: !ai.selection });
          }}
          onClose={(reason) => {
            const at = ai.index;
            setAi(null);
            // Sin aceptar (Esc, descartar): el cursor vuelve a la línea. Con un clic afuera, queda donde se hizo clic.
            if (!accepted.current && reason !== 'outside') api.focusBlock(at);
          }}
        />
      )}
      {syncAt !== null && (
        <DocsSyncDialog
          pageId={api.pageId}
          onCreated={(block) => api.insertBlocks(syncAt, [block, { id: crypto.randomUUID(), type: 'paragraph', content: '' }], { replaceEmpty: true })}
          onClose={() => setSyncAt(null)}
        />
      )}
    </>
  );
});
DocsEditorPlugins.displayName = 'DocsEditorPlugins';

export default DocsEditorPlugins;

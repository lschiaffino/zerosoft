'use client';

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { renderTex, texFromContent, texToContent } from '@/lib/docs-math';
import 'katex/dist/katex.min.css';
import type { DocsBlock, DocsButtonConfig } from '@/lib/docs-types';
import type { TocEntry } from '@/lib/docs-toc';
import { Link } from '@/i18n/navigation';
import DocsGlyph from './DocsGlyphs';
import DocsPageIcon from './DocsPageIcon';

export { renderTex, texFromContent } from '@/lib/docs-math';

interface CardProps {
  block: DocsBlock;
  index: number;
  focused: boolean;
  onChange: (index: number, patch: Partial<DocsBlock>) => void;
  onKeyDown: (index: number, e: React.KeyboardEvent<HTMLElement>) => void;
  onFocus: (index: number) => void;
}

function useCardRef(ref: React.ForwardedRef<HTMLDivElement>) {
  return (node: HTMLDivElement | null) => {
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };
}

/** Bloque ecuación (KaTeX). Enter o clic edita el LaTeX con vista previa; Esc o Cmd+Enter termina. */
export const EquationBlock = forwardRef<HTMLDivElement, CardProps>(({ block, index, focused, onChange, onKeyDown, onFocus }, ref) => {
  const t = useTranslations('docs');
  const tex = texFromContent(block.content);
  const [editing, setEditing] = useState(!tex);
  const [draft, setDraft] = useState(tex);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const setRef = useCardRef(ref);
  const html = useMemo(() => renderTex(editing ? draft : tex, true), [editing, draft, tex]);

  useEffect(() => {
    if (editing && focused) areaRef.current?.focus();
  }, [editing, focused]);

  const done = () => {
    onChange(index, { content: texToContent(draft) });
    setEditing(false);
  };

  return (
    <div
      ref={setRef}
      className={`docs-block docs-equation-block${focused ? ' focused' : ''}`}
      data-index={index}
      data-testid="docs-equation-block"
      tabIndex={0}
      role="group"
      aria-label={t('editor.equation.label')}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          setDraft(tex);
          setEditing(true);
          return;
        }
        onKeyDown(index, e);
      }}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onFocus(index);
      }}
    >
      <button
        type="button"
        className="docs-equation-render"
        onClick={() => {
          setDraft(tex);
          setEditing(true);
        }}
        aria-label={t('editor.equation.edit')}
        tabIndex={-1}
      >
        {tex || editing ? (
          <span dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span className="docs-equation-empty">{t('editor.equation.empty')}</span>
        )}
      </button>
      {editing && (
        <div className="docs-equation-editor">
          <textarea
            ref={areaRef}
            className="input docs-equation-input"
            value={draft}
            rows={Math.min(8, Math.max(2, draft.split('\n').length))}
            placeholder="E = mc^2"
            aria-label={t('editor.equation.input')}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
                e.preventDefault();
                done();
                (e.currentTarget.closest('.docs-equation-block') as HTMLElement | null)?.focus();
              }
            }}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={done}>
            {t('editor.equation.done')}
          </button>
        </div>
      )}
    </div>
  );
});
EquationBlock.displayName = 'EquationBlock';

/** Índice de la página: un link a cada título (salta al bloque). */
export const TocBlock = forwardRef<HTMLDivElement, CardProps & { toc: TocEntry[] }>(({ block, index, focused, onKeyDown, onFocus, toc }, ref) => {
  const t = useTranslations('docs');
  const setRef = useCardRef(ref);
  return (
    <div
      ref={setRef}
      className={`docs-block docs-toc-block${focused ? ' focused' : ''}`}
      data-index={index}
      data-testid="docs-toc-block"
      tabIndex={0}
      role="navigation"
      aria-label={t('editor.toc.label')}
      onKeyDown={(e) => onKeyDown(index, e)}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onFocus(index);
      }}
      data-block-id={block.id}
    >
      {toc.length === 0 ? (
        <p className="docs-toc-empty">{t('editor.toc.empty')}</p>
      ) : (
        <ul className="docs-toc-list">
          {toc.map((e) => (
            <li key={e.blockId} className={`docs-toc-item docs-toc-l${e.level}`}>
              <a
                href={`#${e.anchor}`}
                onClick={(ev) => {
                  ev.preventDefault();
                  const el = document.querySelector<HTMLElement>(`[data-block-anchor="${e.blockId}"]`);
                  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  el?.querySelector<HTMLElement>('.docs-editable')?.focus();
                }}
              >
                {e.text}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
TocBlock.displayName = 'TocBlock';

/** Breadcrumb: la ruta de la página (ancestros y título). */
export const BreadcrumbBlock = forwardRef<HTMLDivElement, CardProps & { trail: Array<{ id: string; title: string; icon: string | null }> }>(
  ({ index, focused, onKeyDown, onFocus, trail }, ref) => {
    const t = useTranslations('docs');
    const setRef = useCardRef(ref);
    return (
      <div
        ref={setRef}
        className={`docs-block docs-breadcrumb-block${focused ? ' focused' : ''}`}
        data-index={index}
        data-testid="docs-breadcrumb-block"
        tabIndex={0}
        role="navigation"
        aria-label={t('editor.breadcrumb')}
        onKeyDown={(e) => onKeyDown(index, e)}
        onFocus={(e) => {
          if (e.target === e.currentTarget) onFocus(index);
        }}
      >
        <ol>
          {trail.map((p, i) => (
            <li key={p.id}>
              {i < trail.length - 1 ? (
                <Link href={`/app/docs/${p.id}`} tabIndex={-1}>
                  <DocsPageIcon icon={p.icon} pageId={p.id} size={14} />
                  <span>{p.title || t('untitled')}</span>
                </Link>
              ) : (
                <span aria-current="page">
                  <DocsPageIcon icon={p.icon} pageId={p.id} size={14} />
                  <span>{p.title || t('untitled')}</span>
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    );
  },
);
BreadcrumbBlock.displayName = 'BreadcrumbBlock';

/**
 * Botón (como los de Notion): inserta bloques debajo (escritos en Markdown en
 * su configuración) o abre un link. El engranaje abre la configuración.
 */
export const ButtonBlock = forwardRef<HTMLDivElement, CardProps & { onRun: (index: number, button: DocsButtonConfig) => void }>(
  ({ block, index, focused, onChange, onKeyDown, onFocus, onRun }, ref) => {
    const t = useTranslations('docs');
    const setRef = useCardRef(ref);
    const button: DocsButtonConfig = block.button ?? { label: '', action: 'insert', markdown: '' };
    const [configOpen, setConfigOpen] = useState(!block.button);
    const [draft, setDraft] = useState<DocsButtonConfig>(button);
    const labelRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
      if (configOpen && focused) labelRef.current?.focus();
    }, [configOpen, focused]);

    const save = () => {
      onChange(index, { button: { ...draft, label: draft.label.trim() } });
      setConfigOpen(false);
    };

    return (
      <div
        ref={setRef}
        className={`docs-block docs-button-block${focused ? ' focused' : ''}`}
        data-index={index}
        data-testid="docs-button-block"
        tabIndex={0}
        role="group"
        aria-label={t('editor.button.label')}
        onKeyDown={(e) => onKeyDown(index, e)}
        onFocus={(e) => {
          if (e.target === e.currentTarget) onFocus(index);
        }}
      >
        <div className="docs-button-row">
          <button
            type="button"
            className="btn btn-secondary btn-sm docs-button-run"
            onClick={() => onRun(index, button)}
            disabled={!block.button}
            data-testid="docs-button-run"
          >
            {button.label || t('editor.button.defaultLabel')}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            aria-label={t('editor.button.configure')}
            title={t('editor.button.configure')}
            aria-expanded={configOpen}
            onClick={() => {
              setDraft(button);
              setConfigOpen((v) => !v);
            }}
          >
            <DocsGlyph name="more" size={14} />
          </button>
        </div>
        {configOpen && (
          <form
            className="docs-button-config"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') {
                e.preventDefault();
                setConfigOpen(false);
                (e.currentTarget.closest('.docs-button-block') as HTMLElement | null)?.focus();
              }
            }}
          >
            <label className="docs-button-field">
              <span>{t('editor.button.name')}</span>
              <input
                ref={labelRef}
                className="input"
                value={draft.label}
                maxLength={200}
                placeholder={t('editor.button.defaultLabel')}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </label>
            <fieldset className="docs-button-field">
              <legend>{t('editor.button.action')}</legend>
              <label className="docs-radio">
                <input type="radio" name={`btn-${block.id}`} checked={draft.action === 'insert'} onChange={() => setDraft({ ...draft, action: 'insert' })} />
                {t('editor.button.insert')}
              </label>
              <label className="docs-radio">
                <input type="radio" name={`btn-${block.id}`} checked={draft.action === 'link'} onChange={() => setDraft({ ...draft, action: 'link' })} />
                {t('editor.button.link')}
              </label>
            </fieldset>
            {draft.action === 'insert' ? (
              <label className="docs-button-field">
                <span>{t('editor.button.blocks')}</span>
                <textarea
                  className="input docs-button-md"
                  rows={4}
                  value={draft.markdown ?? ''}
                  placeholder={t('editor.button.blocksPlaceholder')}
                  onChange={(e) => setDraft({ ...draft, markdown: e.target.value })}
                />
              </label>
            ) : (
              <label className="docs-button-field">
                <span>{t('editor.button.url')}</span>
                <input
                  className="input"
                  type="url"
                  value={draft.url ?? ''}
                  placeholder="https://"
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                />
              </label>
            )}
            <div className="docs-button-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfigOpen(false)}>
                {t('templates.cancel')}
              </button>
              <button type="submit" className="btn btn-primary btn-sm">
                {t('editor.button.save')}
              </button>
            </div>
          </form>
        )}
      </div>
    );
  },
);
ButtonBlock.displayName = 'ButtonBlock';

/** Editor flotante de una ecuación en línea: LaTeX con vista previa. Enter guarda, Esc cancela. */
export function InlineEquationEditor({
  tex,
  style,
  onSave,
  onCancel,
}: {
  tex: string;
  style: React.CSSProperties;
  onSave: (tex: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('docs');
  const [draft, setDraft] = useState(tex);
  const html = useMemo(() => (draft.trim() ? renderTex(draft, false) : ''), [draft]);
  return (
    <div className="docs-menu docs-inline-eq-editor" style={style} role="dialog" aria-label={t('editor.equation.inline')}>
      <input
        className="input"
        autoFocus
        value={draft}
        placeholder="x^2 + y^2"
        aria-label={t('editor.equation.input')}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            onSave(draft);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="docs-inline-eq-preview" aria-live="polite">
        {html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <span className="docs-equation-empty">{t('editor.equation.empty')}</span>}
      </div>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => onSave(draft)}>
        {t('editor.equation.done')}
      </button>
    </div>
  );
}

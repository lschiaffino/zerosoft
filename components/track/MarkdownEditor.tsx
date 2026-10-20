'use client';

import { useId, useMemo, useRef, useState, type RefObject, type TextareaHTMLAttributes } from 'react';
import { applyMarkdownAction, renderTrackMarkdown, type MarkdownAction } from '@/lib/track-markdown';
import TrackIcon from './TrackIcon';

export interface MarkdownLabels {
  write: string;
  preview: string;
  toolbar: string;
  bold: string;
  italic: string;
  code: string;
  list: string;
  link: string;
  /** Texto que se inserta cuando no hay selección (negrita, link…). */
  placeholderText: string;
  emptyPreview: string;
  hint: string;
}

/** Markdown ya renderizado (sanitizado en lib/track-markdown) en un div. */
export function MarkdownView({ source, className = '' }: { source: string; className?: string }) {
  const html = useMemo(() => renderTrackMarkdown(source), [source]);
  return <div className={`track-markdown ${className}`.trim()} dangerouslySetInnerHTML={{ __html: html }} />;
}

const ACTIONS: Array<{ action: MarkdownAction; icon: 'bold' | 'italic' | 'code' | 'list' | 'link'; keys?: string }> = [
  { action: 'bold', icon: 'bold', keys: 'Meta+B' },
  { action: 'italic', icon: 'italic', keys: 'Meta+I' },
  { action: 'code', icon: 'code' },
  { action: 'list', icon: 'list' },
  { action: 'link', icon: 'link' },
];

interface MarkdownEditorProps {
  value: string;
  onValueChange: (value: string) => void;
  labels: MarkdownLabels;
  /** Ref del textarea (las menciones del composer lo usan para el cursor). */
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  textareaProps?: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
    [data: `data-${string}`]: string | undefined;
  };
  /** El foco salió del editor entero (no al pasar a la barra o a la vista previa). */
  onBlurOutside?: () => void;
  /** Contenido extra dentro del área de escritura (p. ej. el menú de menciones). */
  children?: React.ReactNode;
  className?: string;
}

/**
 * Editor de Markdown liviano: textarea con barra (negrita, itálica, código,
 * lista, link) y pestañas Escribir / Vista previa. La vista previa usa el
 * mismo render seguro que la lectura.
 */
export default function MarkdownEditor({
  value,
  onValueChange,
  labels,
  textareaRef,
  textareaProps = {},
  onBlurOutside,
  children,
  className = '',
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = (textareaRef ?? ownRef) as RefObject<HTMLTextAreaElement | null>;
  const rootRef = useRef<HTMLDivElement>(null);

  function run(action: MarkdownAction) {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = applyMarkdownAction(value, start, end, action, labels.placeholderText);
    onValueChange(next.value);
    window.requestAnimationFrame(() => {
      const t = ref.current;
      if (!t) return;
      t.focus();
      t.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    textareaProps.onKeyDown?.(e);
    if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'b' || key === 'i') {
      e.preventDefault();
      run(key === 'b' ? 'bold' : 'italic');
    }
  }

  // El foco nunca queda en la nada al cambiar de pestaña: así "salir del
  // editor" (onBlurOutside) se detecta igual en escritura y en vista previa.
  function switchMode(next: 'write' | 'preview') {
    setMode(next);
    window.requestAnimationFrame(() => (next === 'write' ? ref.current : panelRef.current)?.focus());
  }

  const tabId = `md-${useId().replace(/:/g, '')}`;
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={rootRef}
      className={`track-md ${className}`.trim()}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && rootRef.current?.contains(next)) return;
        onBlurOutside?.();
      }}
    >
      <div className="track-md-bar">
        <div className="ui-tabs track-md-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            id={`${tabId}-write`}
            aria-selected={mode === 'write'}
            aria-controls={`${tabId}-panel`}
            className="ui-tab"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => switchMode('write')}
          >
            {labels.write}
          </button>
          <button
            type="button"
            role="tab"
            id={`${tabId}-preview`}
            aria-selected={mode === 'preview'}
            aria-controls={`${tabId}-panel`}
            className="ui-tab"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => switchMode('preview')}
            data-testid="track-md-preview-tab"
          >
            {labels.preview}
          </button>
        </div>
        {mode === 'write' && (
          <div className="track-md-tools" role="toolbar" aria-label={labels.toolbar}>
            {ACTIONS.map((a) => (
              <button
                key={a.action}
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                aria-label={labels[a.action]}
                title={labels[a.action]}
                aria-keyshortcuts={a.keys}
                // Sin robar el foco: la selección del textarea se mantiene.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(a.action)}
              >
                <TrackIcon name={a.icon} size={14} />
              </button>
            ))}
          </div>
        )}
      </div>
      <div
        ref={panelRef}
        id={`${tabId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabId}-${mode}`}
        className="track-md-panel"
        tabIndex={mode === 'preview' ? -1 : undefined}
      >
        {mode === 'write' ? (
          <div className="track-md-write">
            <textarea
              {...textareaProps}
              ref={ref as RefObject<HTMLTextAreaElement>}
              className={textareaProps.className ?? 'textarea'}
              value={value}
              onChange={(e) => onValueChange(e.target.value)}
              onKeyDown={onKeyDown}
            />
            {children}
          </div>
        ) : value.trim() ? (
          <MarkdownView source={value} className="track-md-preview" />
        ) : (
          <p className="track-md-preview is-empty">{labels.emptyPreview}</p>
        )}
      </div>
      {mode === 'write' && <p className="track-md-hint">{labels.hint}</p>}
    </div>
  );
}

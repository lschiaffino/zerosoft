'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Icon from '@/components/app/icons';

export type DocsExportFormat = 'md' | 'html' | 'pdf';
const FORMATS: DocsExportFormat[] = ['md', 'html', 'pdf'];

/** Baja un export por fetch (así se ve el progreso y el error) y lo guarda con el nombre del servidor. */
export async function downloadExport(url: string): Promise<string | null> {
  const res = await fetch(url).catch(() => null);
  if (!res) return 'network';
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return data?.error ?? 'failed';
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1] ?? /filename="([^"]+)"/i.exec(cd)?.[1] ?? 'export';
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = decodeURIComponent(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return null;
}

/**
 * Exportar (como Notion): Markdown, HTML o PDF, con o sin subpáginas (zip con
 * el árbol y los adjuntos). Imprimir sigue en el menú para el PDF del navegador.
 */
export default function DocsExportDialog({ pageId, onClose, onPrint }: { pageId: string; onClose: () => void; onPrint: () => void }) {
  const t = useTranslations('docs.export');
  const uid = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [format, setFormat] = useState<DocsExportFormat>('md');
  const [subpages, setSubpages] = useState(false);
  const [state, setState] = useState<'idle' | 'working' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  async function run() {
    setState('working');
    setError(null);
    const err = await downloadExport(`/api/docs/pages/${encodeURIComponent(pageId)}/export?format=${format}${subpages ? '&subpages=1' : ''}`);
    if (err) {
      setError(err);
      setState('idle');
      return;
    }
    setState('done');
  }

  return (
    <dialog
      ref={ref}
      className="ui-modal docs-export-dialog"
      aria-labelledby={`${uid}-title`}
      onClose={onClose}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
      data-testid="docs-export-dialog"
    >
      <div className="ui-modal-head">
        <h2 className="ui-modal-title" id={`${uid}-title`}>
          {t('title')}
        </h2>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => ref.current?.close()} aria-label={t('close')} title={t('close')}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div className="ui-modal-body ui-fields">
          <fieldset className="ximp-fieldset ui-field">
            <legend className="label">{t('format')}</legend>
            <div className="docs-export-formats">
              {FORMATS.map((f) => (
                <label key={f} className="docs-export-format">
                  <input type="radio" name={`${uid}-format`} value={f} checked={format === f} onChange={() => setFormat(f)} />
                  <span>
                    <strong>{t(`formats.${f}`)}</strong>
                    <span className="ui-help">{t(`formatHelp.${f}`)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="ui-switch docs-switch-row">
            <input type="checkbox" role="switch" checked={subpages} onChange={(e) => setSubpages(e.target.checked)} data-testid="docs-export-subpages" />
            <span className="docs-switch-text">
              <span className="docs-switch-label">{t('subpages')}</span>
              <span className="ui-help">{t('subpagesHelp')}</span>
            </span>
          </label>
          {error && (
            <p className="ui-error" role="alert">
              {t.has(`errors.${error}`) ? t(`errors.${error}`) : t('errors.failed')}
            </p>
          )}
          {state === 'done' && (
            <p className="ui-help" role="status">
              {t('done')}
            </p>
          )}
        </div>
        <div className="ui-modal-foot">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              ref.current?.close();
              onPrint();
            }}
          >
            {t('print')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={state === 'working'} aria-busy={state === 'working' || undefined} data-testid="docs-export-run">
            {state === 'working' ? t('working') : t('run')}
          </button>
        </div>
      </form>
    </dialog>
  );
}

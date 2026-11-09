'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import LocalText from '@/components/ui/LocalText';
import { AttachmentUploadError, getAttachmentConfig, uploadAttachment, type AttachmentConfig } from '@/lib/file-attachments-client';
import type { TrackIssueAttachmentWithAuthor } from '@/lib/track-data';
import { relDate } from '@/lib/utils';
import { Modal } from './planning/shared';
import TrackIcon from './TrackIcon';

type Row = TrackIssueAttachmentWithAuthor;

interface Upload {
  key: string;
  name: string;
  size: number;
  loaded: number;
  error: string | null;
  controller: AbortController;
}

type Preview = 'image' | 'pdf' | null;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;
const IMAGE_TYPE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i;

/** Lo que se abre en el visor: imágenes raster y PDF (el servidor decide igual al servirlo). */
export function attachmentPreview(a: Pick<Row, 'filename' | 'content_type'>): Preview {
  const unsafe = /(html|svg|xml|javascript)/i.test(a.content_type ?? '');
  if (unsafe) return null;
  const hasExt = /\.[A-Za-z0-9]{1,8}$/.test(a.filename);
  if (hasExt ? IMAGE_EXT.test(a.filename) : IMAGE_TYPE.test(a.content_type ?? '')) return 'image';
  if (hasExt ? /\.pdf$/i.test(a.filename) : a.content_type === 'application/pdf') return 'pdf';
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Link de descarga: los adjuntos privados van por la ruta autorizada con ?download=1. */
function downloadHref(url: string): string {
  return url.startsWith('/api/') ? `${url}${url.includes('?') ? '&' : '?'}download=1` : url;
}

function extLabel(name: string): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name);
  return m ? m[1].toUpperCase() : '';
}

function isEditable(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  return Boolean(node && (node.isContentEditable || node.closest?.('input, textarea, select, [contenteditable="true"], dialog')));
}

/**
 * Adjuntos del issue, como Linear: se suben archivos de cualquier tipo y
 * tamaño (botón del clip, soltar sobre la página o pegar fuera de un editor),
 * cada subida con nombre, tamaño, progreso y cancelar; después la lista con
 * vista previa de imágenes y PDF, descarga y quitar (con confirmación).
 */
export default function IssueAttachments({
  issueId,
  userId,
  locale,
  attachments,
  onChange,
  pickSignal,
  onBusyChange,
}: {
  issueId: string;
  userId: string;
  locale: string;
  attachments: Row[];
  /** Después de subir o quitar: recargar adjuntos y actividad. */
  onChange: () => Promise<void> | void;
  /** Cambia → abre el selector de archivos (botón del clip). */
  pickSignal: number;
  onBusyChange?: (busy: boolean) => void;
}) {
  const t = useTranslations('track.attachments');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<Row | null>(null);
  const [confirm, setConfirm] = useState<Row | null>(null);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const base = `/api/track/issues/${issueId}/attachments`;
  // Modo y tope del servidor: en modo 'legacy' (sin store privado) el tope es chico y se avisa antes de subir.
  const [config, setConfig] = useState<AttachmentConfig | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    getAttachmentConfig(`${base}/upload`, ctrl.signal).then(setConfig, () => undefined);
    return () => ctrl.abort();
  }, [base]);
  const limitHint = config?.mode === 'legacy' ? t('limitHint', { limit: formatBytes(config.maxBytes) }) : null;

  useEffect(() => {
    if (pickSignal > 0) inputRef.current?.click();
  }, [pickSignal]);

  const busy = uploads.some((u) => !u.error);
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);

  const patch = useCallback((key: string, p: Partial<Upload>) => {
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...p } : u)));
  }, []);

  const start = useCallback(
    (files: File[]) => {
      setError(null);
      for (const file of files) {
        const key = crypto.randomUUID();
        const controller = new AbortController();
        setUploads((list) => [...list, { key, name: file.name || 'file', size: file.size, loaded: 0, error: null, controller }]);
        void uploadAttachment<Row>(file, {
          uploadUrl: `${base}/upload`,
          finalizeUrl: `${base}/finalize`,
          signal: controller.signal,
          config: config ?? undefined,
          onProgress: (loaded) => patch(key, { loaded }),
        })
          .then(async () => {
            setUploads((list) => list.filter((u) => u.key !== key));
            await onChange();
          })
          .catch((err: unknown) => {
            const code = err instanceof AttachmentUploadError ? err.code : 'generic';
            const max = err instanceof AttachmentUploadError ? err.maxBytes : undefined;
            if (code === 'aborted') {
              setUploads((list) => list.filter((u) => u.key !== key));
              return;
            }
            const message =
              code === 'storage_not_configured'
                ? t('storageNotConfigured')
                : code === 'too_large'
                  ? max
                    ? t('tooLargeLimit', { limit: formatBytes(max) })
                    : t('tooLargeAny')
                  : code === 'type_not_allowed'
                    ? t('typeNotAllowed')
                    : t('uploadError');
            patch(key, { error: message });
          });
      }
    },
    [base, config, onChange, patch, t],
  );

  // Soltar archivos en cualquier parte de la página (fuera de los editores,
  // que los suben como imagen en el texto) y pegar con el foco fuera de un campo.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e) || isEditable(e.target)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (e: DragEvent) => {
      depth = 0;
      setDragging(false);
      if (!hasFiles(e) || isEditable(e.target) || e.defaultPrevented) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) start(files);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target) || isEditable(document.activeElement)) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      start(files);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, [start]);

  async function remove(row: Row) {
    setRemoving(true);
    const res = await fetch(`${base}?fileId=${encodeURIComponent(row.id)}`, { method: 'DELETE' }).catch(() => null);
    setRemoving(false);
    setConfirm(null);
    if (!res?.ok) {
      setError(t('removeError'));
      return;
    }
    if (preview?.id === row.id) setPreview(null);
    await onChange();
  }

  const show = attachments.length > 0 || uploads.length > 0;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="track-attach-input"
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = '';
          if (files.length) start(files);
        }}
      />

      {dragging && (
        <div className="track-attach-drop" aria-hidden>
          <span>{t('dropHere')}</span>
        </div>
      )}

      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}

      {show && (
        <section className="track-detail-section track-issue-block" data-testid="track-attachments" aria-label={t('title')}>
          <div className="track-attach-head">
            <h2 className="track-section-title">{t('title')}</h2>
            {limitHint && (
              <span className="track-attachment-meta track-attach-limit" data-testid="track-attach-limit">
                {limitHint}
              </span>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => inputRef.current?.click()}>
              <TrackIcon name="plus" size={12} />
              <span>{t('upload')}</span>
            </button>
          </div>
          <ul className="track-attachment-list">
            {uploads.map((u) => {
              const pct = u.size > 0 ? Math.min(100, Math.round((u.loaded / u.size) * 100)) : 0;
              return (
                <li key={u.key} className={`track-attachment is-upload${u.error ? ' is-error' : ''}`} data-testid="track-attachment-upload">
                  <span className="track-attach-icon" aria-hidden>
                    {extLabel(u.name) || <TrackIcon name="paperclip" size={14} />}
                  </span>
                  <span className="track-attach-main">
                    <span className="track-attachment-name">{u.name}</span>
                    {u.error ? (
                      <span className="track-attach-error" role="alert">
                        {u.error}
                      </span>
                    ) : (
                      <span className="track-attach-progress">
                        <span
                          className="track-attach-bar"
                          role="progressbar"
                          aria-label={t('uploadingName', { name: u.name })}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={pct}
                        >
                          <span style={{ width: `${pct}%` }} />
                        </span>
                        <span className="track-attachment-meta">
                          {t('progress', { loaded: formatBytes(u.loaded), total: formatBytes(u.size), pct })}
                        </span>
                      </span>
                    )}
                  </span>
                  {u.error ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUploads((l) => l.filter((x) => x.key !== u.key))}>
                      {t('dismiss')}
                    </button>
                  ) : (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => u.controller.abort()}>
                      {t('cancel')}
                    </button>
                  )}
                </li>
              );
            })}
            {attachments.map((a) => {
              const kind = attachmentPreview(a);
              return (
                <li key={a.id} className="track-attachment" data-testid="track-attachment">
                  {kind === 'image' ? (
                    <button type="button" className="track-attach-thumb" onClick={() => setPreview(a)} aria-label={t('previewName', { name: a.filename })}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.url} alt="" loading="lazy" />
                    </button>
                  ) : (
                    <span className="track-attach-icon" aria-hidden>
                      {extLabel(a.filename) || <TrackIcon name="paperclip" size={14} />}
                    </span>
                  )}
                  <span className="track-attach-main">
                    {kind ? (
                      <button type="button" className="track-attachment-name is-button" onClick={() => setPreview(a)}>
                        {a.filename}
                      </button>
                    ) : (
                      <a href={downloadHref(a.url)} download={a.filename} className="track-attachment-name">
                        {a.filename}
                      </a>
                    )}
                    <span className="track-attachment-meta">
                      {formatBytes(a.size)} · {a.user_name ?? a.user_email} · <LocalText>{relDate(a.created_at, locale)}</LocalText>
                    </span>
                  </span>
                  <span className="track-attach-actions">
                    <a className="btn btn-ghost btn-sm" href={downloadHref(a.url)} download={a.filename} data-testid="track-attachment-download">
                      {t('download')}
                    </a>
                    {a.user_id === userId && (
                      <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => setConfirm(a)}>
                        {t('delete')}
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <Modal
        open={Boolean(preview)}
        title={preview?.filename ?? ''}
        onClose={() => setPreview(null)}
        testId="track-attachment-preview"
        footer={
          preview && (
            <>
              <a className="btn btn-ghost btn-sm" href={preview.url} target="_blank" rel="noreferrer">
                {t('openNewTab')}
              </a>
              <a className="btn btn-secondary btn-sm" href={downloadHref(preview.url)} download={preview.filename}>
                {t('download')}
              </a>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setPreview(null)} autoFocus>
                {t('close')}
              </button>
            </>
          )
        }
      >
        {preview &&
          (attachmentPreview(preview) === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="track-attach-preview-img" src={preview.url} alt={preview.filename} />
          ) : (
            <iframe className="track-attach-preview-pdf" src={preview.url} title={preview.filename} />
          ))}
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={t('removeTitle', { name: confirm?.filename ?? '' })}
        body={t('removeBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        danger
        busy={removing}
        onConfirm={() => confirm && void remove(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}

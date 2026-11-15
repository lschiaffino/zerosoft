'use client';

import { memo, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { formatFileSize } from '@/lib/docs-files';
import { canRetry, type PendingUpload } from '@/lib/docs-upload-queue';
import DocsGlyph from './DocsGlyphs';

interface Props {
  upload: PendingUpload;
  /** Sangría visual del lugar (la misma que va a tener el bloque). */
  indent: number;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}

/** Lo más chico que se reserva para una imagen: debajo de esto el progreso no entra. */
const MIN_W = 160;
const MIN_H = 96;

/**
 * Esqueleto de una subida en curso, en el lugar y con el tamaño que va a
 * tener el bloque: imagen y video con su proporción (gris claro con un brillo
 * que pasa, quieto con movimiento reducido), PDF con la altura del visor, y
 * archivo y audio como la ficha del archivo. Muestra el porcentaje y
 * Cancelar; si falla, el error con Reintentar y Quitar.
 */
function DocsUploadPlaceholder({ upload: u, indent, onCancel, onRetry, onRemove }: Props) {
  const t = useTranslations('docs');
  const media = u.kind === 'image' || u.kind === 'video' || u.kind === 'pdf';
  const outerStyle = indent ? ({ '--docs-indent': indent } as CSSProperties) : undefined;

  if (u.status === 'error') {
    return (
      <div className="docs-block-outer" style={outerStyle} data-indent={indent || undefined}>
        <div className="docs-block docs-upload-error" role="alert" data-testid="docs-upload-placeholder" data-status="error" data-kind={u.kind}>
          <span className="docs-file-icon" aria-hidden="true">
            <DocsGlyph name="alert" size={16} />
          </span>
          <span className="docs-upload-error-text">{t(`editor.upload.${u.error ?? 'failed'}`, { name: u.name, max: formatFileSize(u.max ?? 0) })}</span>
          <span className="docs-upload-actions">
            {canRetry(u) && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onRetry(u.id)} aria-label={t('editor.upload.retryNamed', { name: u.name })}>
                {t('editor.upload.retry')}
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRemove(u.id)} aria-label={t('editor.upload.removeNamed', { name: u.name })}>
              {t('editor.upload.remove')}
            </button>
          </span>
        </div>
      </div>
    );
  }

  const percent = u.status === 'queued' ? 0 : u.progress;
  const statusText = u.status === 'queued' ? t('editor.upload.queued') : t('editor.upload.percent', { percent });
  const progress = (
    <span
      className="docs-upload-bar"
      role="progressbar"
      aria-label={t('editor.upload.progressLabel', { name: u.name })}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <span className="docs-upload-bar-fill" style={{ width: `${percent}%` }} />
    </span>
  );
  const cancel = (
    <button
      type="button"
      className="docs-upload-cancel"
      onClick={() => onCancel(u.id)}
      aria-label={t('editor.upload.cancelNamed', { name: u.name })}
      title={t('editor.upload.cancel')}
    >
      <DocsGlyph name="close" size={12} />
    </button>
  );

  // Imagen: el ancho natural (hasta el de la columna) y su proporción, como la va a mostrar el bloque.
  // Video y PDF: todo el ancho, como el bloque recién subido.
  let frameStyle: CSSProperties | undefined;
  let boxStyle: CSSProperties | undefined;
  if (u.kind === 'image') {
    frameStyle = { width: u.width ? `min(100%, ${Math.max(u.width, MIN_W)}px)` : '100%' };
    boxStyle = u.width && u.height ? { aspectRatio: `${u.width} / ${u.height}`, minHeight: MIN_H } : undefined;
  } else if (u.kind === 'video') {
    frameStyle = { width: '100%' };
    // Sin medidas (un formato que el navegador no lee): el alto con el que se dibuja un <video> sin metadatos.
    boxStyle = u.width && u.height ? { aspectRatio: `${u.width} / ${u.height}`, height: 'auto' } : undefined;
  } else if (u.kind === 'pdf') {
    frameStyle = { width: '100%' };
  }

  const center = (
    <span className="docs-upload-center">
      <span className="docs-upload-name">{u.name}</span>
      {progress}
      <span className="docs-upload-meta">
        <span className="docs-upload-percent">{statusText}</span>
        <button type="button" className="docs-upload-cancel-text" onClick={() => onCancel(u.id)} aria-label={t('editor.upload.cancelNamed', { name: u.name })}>
          {t('editor.upload.cancel')}
        </button>
      </span>
    </span>
  );

  return (
    <>
      <div className="docs-block-outer" style={outerStyle} data-indent={indent || undefined}>
      <div
        className={`docs-block docs-file-block docs-file-block-${u.kind} docs-media-align-center docs-upload-ph`}
        role="group"
        aria-busy="true"
        aria-label={t('editor.upload.uploadingNamed', { name: u.name })}
        data-testid="docs-upload-placeholder"
        data-status={u.status}
        data-kind={u.kind}
      >
        {media ? (
          <div className="docs-media-frame" style={frameStyle}>
            {u.kind === 'pdf' ? (
              // Como el bloque: el visor y, debajo, el renglón del link para abrirlo.
              <div className="docs-pdf">
                <div className="docs-skel docs-upload-box docs-upload-box-pdf">{center}</div>
                <span className="docs-pdf-open docs-upload-ghost" aria-hidden="true">
                  {u.name}
                </span>
              </div>
            ) : (
              <div className={`docs-skel docs-upload-box docs-upload-box-${u.kind}`} style={boxStyle}>
                {center}
              </div>
            )}
          </div>
        ) : u.kind === 'audio' ? (
          // Como el bloque de audio: el nombre y, debajo, el lugar del reproductor.
          <div className="docs-audio docs-skel docs-upload-card">
            <span className="docs-audio-name">{u.name}</span>
            <span className="docs-upload-audio">
              <span className="docs-file-size">{statusText}</span>
              {cancel}
            </span>
            {progress}
          </div>
        ) : (
          <div className="docs-file-card docs-skel docs-upload-card">
            <span className="docs-file-icon" aria-hidden="true">
              <DocsGlyph name="file" size={18} />
            </span>
            <span className="docs-file-name">{u.name}</span>
            {/* Solo el estado: con el tamaño al lado, en el teléfono el nombre partía en dos renglones y la ficha saltaba. */}
            <span className="docs-file-size">{statusText}</span>
            {cancel}
            {progress}
          </div>
        )}
      </div>
      </div>
      {/* El mismo espacio que queda debajo de cada bloque. */}
      <div className="docs-gap" aria-hidden="true" />
    </>
  );
}

export default memo(DocsUploadPlaceholder);

/**
 * Medidas de una imagen o un video local, para que el esqueleto tenga la forma
 * del bloque. Lo que el navegador no sabe leer (o tarda) se queda sin medidas.
 */
export function localMediaSize(file: Blob, kind: 'image' | 'video'): Promise<{ width: number; height: number } | null> {
  if (typeof URL === 'undefined' || !URL.createObjectURL) return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (size: { width: number; height: number } | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(size && size.width > 0 && size.height > 0 ? size : null);
    };
    const timer = window.setTimeout(() => finish(null), 4000);
    if (kind === 'image') {
      const img = new Image();
      img.onload = () => finish({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => finish(null);
      img.src = url;
    } else {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.onloadedmetadata = () => {
        const size = { width: v.videoWidth, height: v.videoHeight };
        // Se suelta el archivo (si no, el <video> suelto lo retiene).
        v.removeAttribute('src');
        v.load();
        finish(size);
      };
      v.onerror = () => finish(null);
      v.src = url;
    }
  });
}

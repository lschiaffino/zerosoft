'use client';
/* eslint-disable @next/next/no-img-element -- miniaturas de adjuntos: object URLs locales y subidas propias, no pasan por el optimizador. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatAttachment } from './client';

export const MAX_ATTACHMENTS = 5;

export interface PendingAttachment {
  key: string;
  name: string;
  mime: string;
  size: number;
  /** Vista previa local de una imagen (object URL). */
  preview: string | null;
  status: 'uploading' | 'ready' | 'error';
  file?: ChatAttachment;
  error?: string;
}

const UPLOAD_ERRORS = new Set(['file_too_large', 'file_type_not_allowed', 'too_many_files', 'upload_failed', 'storage_unavailable', 'invalid_input', 'rate_limited']);

function sizeLabel(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function extLabel(name: string, mime: string): string {
  const ext = name.includes('.') ? name.split('.').pop()! : mime.split('/').pop() ?? '';
  return ext.slice(0, 4).toUpperCase() || 'FILE';
}

/** Archivos para el próximo mensaje: se suben al elegirlos; el mensaje manda solo los ids. */
export function useAttachments() {
  const [items, setItems] = useState<PendingAttachment[]>([]);
  const [limitHit, setLimitHit] = useState(false);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const add = useCallback((files: File[] | FileList) => {
    const list = Array.from(files).filter((f) => f.size >= 0);
    if (!list.length) return;
    const room = MAX_ATTACHMENTS - itemsRef.current.length;
    setLimitHit(list.length > room);
    for (const file of list.slice(0, Math.max(0, room))) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const name = file.name || (file.type.startsWith('image/') ? `pasted.${file.type.split('/')[1] || 'png'}` : 'file');
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      setItems((prev) => [...prev, { key, name, mime: file.type || 'application/octet-stream', size: file.size, preview, status: 'uploading' }]);
      const form = new FormData();
      form.append('file', file, name);
      void fetch('/api/assistant/files', { method: 'POST', body: form })
        .then(async (res) => {
          const data = (await res.json().catch(() => null)) as { files?: ChatAttachment[]; error?: string; errors?: Array<{ error: string }> } | null;
          const uploaded = data?.files?.[0];
          setItems((prev) =>
            prev.map((it) =>
              it.key !== key
                ? it
                : uploaded
                  ? { ...it, status: 'ready', file: uploaded, mime: uploaded.mime }
                  : { ...it, status: 'error', error: UPLOAD_ERRORS.has(data?.error ?? '') ? data!.error : 'upload_failed' },
            ),
          );
        })
        .catch(() => setItems((prev) => prev.map((it) => (it.key === key ? { ...it, status: 'error', error: 'upload_failed' } : it))));
    }
  }, []);

  const remove = useCallback((key: string) => {
    setItems((prev) => {
      const gone = prev.find((it) => it.key === key);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return prev.filter((it) => it.key !== key);
    });
    setLimitHit(false);
  }, []);

  /** Después de mandar: la bandeja queda vacía (las vistas previas se sueltan). */
  const clear = useCallback(() => {
    for (const it of itemsRef.current) if (it.preview) URL.revokeObjectURL(it.preview);
    setItems([]);
    setLimitHit(false);
  }, []);

  useEffect(() => () => {
    for (const it of itemsRef.current) if (it.preview) URL.revokeObjectURL(it.preview);
  }, []);

  const ready = items.filter((it) => it.status === 'ready' && it.file).map((it) => it.file!);
  const uploading = items.some((it) => it.status === 'uploading');
  return { items, ready, uploading, limitHit, add, remove, clear };
}

/** Bandeja sobre el campo: miniaturas o chips, cada uno con quitar. */
export function PendingTray({ items, limitHit, onRemove }: { items: PendingAttachment[]; limitHit: boolean; onRemove: (key: string) => void }) {
  const t = useTranslations('assistant.attach');
  if (!items.length && !limitHit) return null;
  return (
    <div className="asst-tray" data-testid="assistant-attachments">
      {items.length > 0 && (
        <ul className="asst-tray-list" aria-label={t('list')}>
          {items.map((it) => (
            <li key={it.key} className={`asst-file is-${it.status}`} data-testid="assistant-attachment" data-status={it.status} title={it.name}>
              {it.preview ? <img src={it.preview} alt="" className="asst-file-thumb" /> : <span className="asst-file-ext" aria-hidden="true">{extLabel(it.name, it.mime)}</span>}
              <span className="asst-file-meta">
                <span className="asst-file-name">{it.name}</span>
                <span className={`asst-file-sub${it.status === 'error' ? ' is-error' : ''}`} role={it.status === 'error' ? 'alert' : undefined}>
                  {it.status === 'uploading' ? t('uploading') : it.status === 'error' ? t(`errors.${it.error ?? 'upload_failed'}`) : sizeLabel(it.size)}
                </span>
              </span>
              <button type="button" className="asst-file-remove" aria-label={t('remove', { name: it.name })} onClick={() => onRemove(it.key)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {limitHit && <p className="asst-file-limit muted" role="status">{t('limit', { max: MAX_ATTACHMENTS })}</p>}
    </div>
  );
}

/** Adjuntos de un mensaje ya mandado. */
export function MessageAttachments({ files }: { files: ChatAttachment[] }) {
  const t = useTranslations('assistant.attach');
  if (!files.length) return null;
  return (
    <ul className="asst-msg-files" aria-label={t('list')}>
      {files.map((f) => (
        <li key={f.id}>
          <a href={f.url} target="_blank" rel="noreferrer" className="asst-file is-ready" aria-label={t('open', { name: f.name })} data-testid="assistant-sent-attachment">
            {f.kind === 'image' ? <img src={f.url} alt="" className="asst-file-thumb" /> : <span className="asst-file-ext" aria-hidden="true">{extLabel(f.name, f.mime)}</span>}
            <span className="asst-file-meta">
              <span className="asst-file-name">{f.name}</span>
              <span className="asst-file-sub">{sizeLabel(f.size)}</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

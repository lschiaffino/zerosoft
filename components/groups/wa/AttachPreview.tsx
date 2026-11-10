'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { TrayItem } from './attachments';
import { extensionOf, fileSize, posterFrame } from './format';
import { Close, DocIcon, Plus, SendIcon } from './icons';

/** Errores que no se arreglan reintentando la subida (tamaño o tipo). */
const PERMANENT = new Set(['file_too_large', 'file_too_large_local', 'file_type_not_allowed', 'media_too_large', 'invalid_media']);

/**
 * Vista previa de los archivos antes de mandar, como en WhatsApp Web: el
 * archivo elegido grande, su comentario, la tira de miniaturas (con el avance
 * de cada subida, reintentar y sacar), "+" para sumar más y mandar todo.
 */
export default function AttachPreview({
  items,
  errText,
  onCaption,
  onRemove,
  onRetry,
  onAdd,
  onSend,
  onClose,
  sending,
}: {
  items: TrayItem[];
  errText: (code?: string) => string;
  onCaption: (key: string, caption: string) => void;
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
  onAdd: () => void;
  onSend: () => void;
  onClose: () => void;
  sending: boolean;
}) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const [current, setCurrent] = useState(items[0]?.key ?? '');
  const captionRef = useRef<HTMLInputElement>(null);
  const it = items.find((x) => x.key === current) ?? items[0];

  useEffect(() => {
    if (!items.some((x) => x.key === current) && items[0]) setCurrent(items[0].key);
  }, [items, current]);
  useEffect(() => captionRef.current?.focus(), [current]);

  if (!it) return null;
  const uploading = items.some((x) => x.status === 'uploading');
  const broken = items.filter((x) => x.status === 'error').length;
  return (
    <div className="wa-attach-pane" data-voice-off role="dialog" aria-label={t('wa.attachments')} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}>
      <header className="wa-attach-head">
        <button type="button" className="wa-icon-btn" onClick={onClose} aria-label={t('common.cancel')} title={t('common.cancel')}>
          <Close />
        </button>
        <span className="wa-attach-name" title={it.name}>
          {it.name}
        </span>
      </header>
      <div className="wa-attach-stage">
        {it.preview && it.type.startsWith('image/') ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={it.preview} alt={it.name} />
        ) : it.preview && it.type.startsWith('video/') ? (
          <video src={it.preview} controls playsInline />
        ) : (
          <div className="wa-attach-doc">
            <DocIcon size={72} />
            <strong>{it.name}</strong>
            <span>{[extensionOf(it.name, it.type), fileSize(it.size, locale)].filter(Boolean).join(' · ')}</span>
          </div>
        )}
        {it.status === 'error' && (
          <p className="wa-attach-err" role="alert">
            {errText(it.error)}
            {!PERMANENT.has(it.error ?? '') && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onRetry(it.key)}>
                {t('common.retry')}
              </button>
            )}
          </p>
        )}
      </div>
      <div className="wa-attach-caption">
        <input
          ref={captionRef}
          className="input"
          value={it.caption ?? ''}
          onChange={(e) => onCaption(it.key, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={t('wa.addCaption')}
          aria-label={t('wa.addCaption')}
          maxLength={1024}
          disabled={it.type.startsWith('audio/')}
        />
      </div>
      <div className="wa-attach-foot">
        <ul className="wa-attach-strip" aria-label={t('wa.attachments')}>
          {items.map((f) => (
            <li key={f.key} className={`wa-attach-thumb is-${f.status}${f.key === it.key ? ' is-on' : ''}`}>
              <button type="button" className="wa-attach-pick" onClick={() => setCurrent(f.key)} aria-label={f.name} aria-current={f.key === it.key || undefined}>
                {f.preview && f.type.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.preview} alt="" />
                ) : f.preview && f.type.startsWith('video/') ? (
                  <video src={posterFrame(f.preview)} muted preload="metadata" tabIndex={-1} aria-hidden="true" />
                ) : (
                  <span className="wa-tray-doc" aria-hidden="true">
                    <DocIcon size={18} />
                    <b>{extensionOf(f.name, f.type)}</b>
                  </span>
                )}
              </button>
              {f.status === 'uploading' && (
                <span className="wa-tray-bar" role="progressbar" aria-label={t('wa.uploading', { name: f.name })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f.progress * 100)}>
                  <i style={{ width: `${Math.max(4, f.progress * 100)}%` }} />
                </span>
              )}
              <button type="button" className="wa-tray-x" onClick={() => onRemove(f.key)} aria-label={t('wa.removeFile', { name: f.name })} title={t('common.remove')}>
                <Close size={12} />
              </button>
            </li>
          ))}
          <li className="wa-attach-thumb is-add">
            <button type="button" className="wa-attach-pick" onClick={onAdd} aria-label={t('wa.addMore')} title={t('wa.addMore')}>
              <Plus size={22} />
            </button>
          </li>
        </ul>
        <button
          type="button"
          className="wa-send wa-attach-send"
          onClick={onSend}
          disabled={sending || uploading || broken === items.length}
          aria-busy={sending || uploading || undefined}
          aria-label={t('wa.sendFiles', { n: items.length - broken })}
          title={t('wa.sendFiles', { n: items.length - broken })}
        >
          <SendIcon />
          {items.length > 1 && <span className="wa-attach-count">{items.length - broken}</span>}
        </button>
      </div>
    </div>
  );
}

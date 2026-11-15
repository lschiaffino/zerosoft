'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MessageMenu, type MenuItem } from './Menu';
import { Plus } from './icons';
import { AttachAudioIcon, AttachCameraIcon, AttachContactIcon, AttachDocIcon, AttachMediaIcon, AttachPollIcon, AttachStickerIcon } from './attach-icons';
import CameraCapture from './CameraCapture';
import '@/styles/wa-attach.css';

export interface AttachMenuHandle {
  /** Abre el selector de archivos (el "+" de la vista previa suma más). */
  pickFiles: () => void;
}

/**
 * El "+" del composer, en Lines y en Inbox, como el menú de adjuntar de
 * WhatsApp: Documento, Fotos y videos, Cámara, Audio, Contacto, Encuesta y
 * Sticker nuevo, en ese orden y con sus íconos de color. Solo aparece lo que
 * el chat puede mandar (cada app pasa lo que tiene). Debajo, separado, lo
 * nuestro (escribir con AI, dictar, comandos...), que cada app pasa en `extra`.
 * Cámara: en el teléfono abre la del sistema; en la computadora, la cámara en
 * vivo (CameraCapture). La foto va a la vista previa como cualquier imagen.
 */
const AttachMenu = forwardRef<
  AttachMenuHandle,
  {
    onFiles: (files: File[]) => void;
    onContact?: () => void;
    onPoll?: () => void;
    /** Sticker nuevo: la imagen elegida (cada app lo crea y lo manda). */
    onNewSticker?: (file: File) => void;
    extra?: MenuItem[];
    disabled?: boolean;
    className?: string;
  }
>(function AttachMenu({ onFiles, onContact, onPoll, onNewSticker, extra = [], disabled, className }, ref) {
  const t = useTranslations('groups.wa');
  const tp = useTranslations('groups.polls');
  const tt = useTranslations('groups.thread');
  const docs = useRef<HTMLInputElement>(null);
  const media = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLInputElement>(null);
  const sticker = useRef<HTMLInputElement>(null);
  const [cam, setCam] = useState<'' | 'native' | 'live'>('');
  const [liveOpen, setLiveOpen] = useState(false);

  useEffect(() => {
    // Teléfono o tableta: la cámara del sistema. Computadora con cámara posible: la cámara en vivo.
    if (window.matchMedia('(pointer: coarse)').matches) setCam('native');
    else if (typeof navigator.mediaDevices?.getUserMedia === 'function') setCam('live');
  }, []);

  const pick = (input: HTMLInputElement | null) => {
    if (!input) return;
    input.value = '';
    input.click();
  };
  useImperativeHandle(ref, () => ({ pickFiles: () => pick(docs.current) }), []);

  // Lo nuestro va abajo, separado, con íconos de línea grises (los de color son los de WhatsApp).
  const extras = extra.map((it, i): MenuItem => ({ ...it, icon: undefined, glyph: it.glyph ?? it.icon, divider: i === 0 }));
  const items: MenuItem[] = [
    { key: 'doc', label: t('document'), icon: <AttachDocIcon />, onSelect: () => pick(docs.current) },
    { key: 'photo', label: t('photos'), icon: <AttachMediaIcon />, onSelect: () => pick(media.current) },
    ...(cam ? [{ key: 'camera', label: t('camera'), icon: <AttachCameraIcon />, onSelect: () => (cam === 'native' ? pick(camera.current) : setLiveOpen(true)) }] : []),
    { key: 'audio', label: t('audio'), icon: <AttachAudioIcon />, onSelect: () => pick(audio.current) },
    ...(onContact ? [{ key: 'contact', label: t('contact'), icon: <AttachContactIcon />, onSelect: onContact }] : []),
    ...(onPoll ? [{ key: 'poll', label: tp('button'), icon: <AttachPollIcon />, onSelect: onPoll }] : []),
    ...(onNewSticker ? [{ key: 'sticker', label: t('newSticker'), icon: <AttachStickerIcon />, onSelect: () => pick(sticker.current) }] : []),
    ...extras,
  ];
  const files = (input: HTMLInputElement) => {
    const list = [...(input.files ?? [])];
    input.value = '';
    if (list.length) onFiles(list);
  };

  return (
    <span className={`wa-attach-wrap${className ? ` ${className}` : ''}`}>
      {disabled ? (
        <button type="button" className="wa-icon-btn" disabled aria-label={tt('attach')}>
          <Plus size={24} />
        </button>
      ) : (
        <MessageMenu label={tt('attach')} trigger={<Plus size={24} />} className="wa-icon-btn wa-attach" listClassName="is-attach" align="left" items={items} />
      )}
      <input ref={docs} type="file" multiple hidden onChange={(e) => files(e.currentTarget)} aria-hidden="true" tabIndex={-1} data-attach="doc" />
      <input ref={media} type="file" multiple hidden accept="image/*,video/*" onChange={(e) => files(e.currentTarget)} aria-hidden="true" tabIndex={-1} data-attach="media" />
      <input ref={camera} type="file" hidden accept="image/*" capture="environment" onChange={(e) => files(e.currentTarget)} aria-hidden="true" tabIndex={-1} data-attach="camera" />
      <input ref={audio} type="file" multiple hidden accept="audio/*" onChange={(e) => files(e.currentTarget)} aria-hidden="true" tabIndex={-1} data-attach="audio" />
      <input
        ref={sticker}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) onNewSticker?.(f);
        }}
        aria-hidden="true"
        tabIndex={-1}
        data-attach="sticker"
      />
      {liveOpen && (
        <CameraCapture
          onClose={() => setLiveOpen(false)}
          onPhoto={(f) => {
            setLiveOpen(false);
            onFiles([f]);
          }}
        />
      )}
    </span>
  );
});

export default AttachMenu;

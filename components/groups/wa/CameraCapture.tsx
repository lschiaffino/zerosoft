'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Close } from './icons';

/**
 * "Cámara" del menú + en la computadora, como WhatsApp Web: la imagen de la
 * cámara en vivo, el botón para sacar la foto y, con la foto, "Repetir" o
 * usarla (va a la vista previa, donde se puede editar y comentar antes de
 * mandar). En el teléfono el menú usa la cámara del sistema (input con
 * capture), no esto. Esc cierra; Enter saca la foto o la usa.
 */
export default function CameraCapture({ onClose, onPhoto }: { onClose: () => void; onPhoto: (file: File) => void }) {
  const t = useTranslations('groups.wa.cameraCapture');
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<'starting' | 'live' | 'denied' | 'none'>('starting');
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const shotRef = useRef(shot);
  shotRef.current = shot;
  const snapRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState('none');
        return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (!alive) {
          s.getTracks().forEach((tr) => tr.stop());
          return;
        }
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => undefined);
        }
        setState('live');
        requestAnimationFrame(() => snapRef.current?.focus());
      } catch (err) {
        if (alive) setState((err as DOMException)?.name === 'NotFoundError' ? 'none' : 'denied');
      }
    })();
    return () => {
      alive = false;
      stream.current?.getTracks().forEach((tr) => tr.stop());
      if (shotRef.current) URL.revokeObjectURL(shotRef.current.url);
    };
  }, []);

  function snap() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    // La vista en vivo va espejada (como un espejo); la foto sale como la ve el otro.
    ctx.drawImage(v, 0, 0);
    c.toBlob((b) => b && setShot({ blob: b, url: URL.createObjectURL(b) }), 'image/jpeg', 0.92);
  }

  function retake() {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
    requestAnimationFrame(() => snapRef.current?.focus());
  }

  function use() {
    if (!shot) return;
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    onPhoto(new File([shot.blob], `photo-${stamp}.jpg`, { type: 'image/jpeg' }));
  }

  return (
    <div
      className="wa-camera"
      role="dialog"
      aria-modal="true"
      aria-label={t('title')}
      data-voice-off
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault();
          if (shot) use();
          else snap();
        }
      }}
    >
      <header className="wa-camera-head">
        <button type="button" className="wa-icon-btn" onClick={onClose} aria-label={t('close')} title={t('close')}>
          <Close />
        </button>
        <span>{t('title')}</span>
      </header>
      <div className="wa-camera-stage">
        <video ref={video} className={`wa-camera-live${shot ? ' is-hidden' : ''}`} playsInline muted aria-hidden="true" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {shot && <img src={shot.url} alt={t('preview')} className="wa-camera-shot" />}
        {state === 'starting' && <p className="wa-camera-msg">{t('starting')}</p>}
        {state === 'denied' && (
          <p className="wa-camera-msg" role="alert">
            {t('denied')}
          </p>
        )}
        {state === 'none' && (
          <p className="wa-camera-msg" role="alert">
            {t('none')}
          </p>
        )}
      </div>
      <footer className="wa-camera-foot">
        {shot ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={retake}>
              {t('retake')}
            </button>
            <button type="button" className="btn btn-primary" onClick={use} data-testid="camera-use" autoFocus>
              {t('use')}
            </button>
          </>
        ) : (
          <button ref={snapRef} type="button" className="wa-camera-snap" onClick={snap} disabled={state !== 'live'} aria-label={t('snap')} title={t('snap')} data-testid="camera-snap" />
        )}
      </footer>
    </div>
  );
}

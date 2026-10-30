'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import SignaturePad from '@/components/esign/SignaturePad';
import { SignDialog } from './ui';

export type SignatureKind = 'typed' | 'drawn' | 'upload';
type Mode = SignatureKind;

const CURSIVE = '"Brush Script MT", "Segoe Script", "Snell Roundhand", "Apple Chancery", cursive';

/** Texto escrito → JPEG con fondo blanco (lo que valida el servidor, igual que la firma dibujada). */
function typedToJpeg(text: string, height = 120): string {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  const font = `italic ${Math.round(height * 0.5)}px ${CURSIVE}`;
  ctx.font = font;
  const w = Math.min(1200, Math.max(120, Math.ceil(ctx.measureText(text).width + 40)));
  c.width = w;
  c.height = height;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, height);
  ctx.font = font;
  ctx.fillStyle = '#111111';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 20, height / 2);
  return c.toDataURL('image/jpeg', 0.9);
}

/** Imagen subida → JPEG chico con fondo blanco. */
async function uploadToJpeg(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, 600 / img.width, 240 / img.height);
    const c = document.createElement('canvas');
    c.width = Math.max(20, Math.round(img.width * scale));
    c.height = Math.max(10, Math.round(img.height * scale));
    const ctx = c.getContext('2d');
    if (!ctx) return '';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase())
    .slice(0, 3)
    .join('');
}

/** Adoptar la firma (o las iniciales): escribirla, dibujarla o subir una imagen. */
export default function AdoptSignature({
  open,
  kind,
  defaultText,
  onClose,
  onAdopt,
}: {
  open: boolean;
  kind: 'signature' | 'initials';
  defaultText: string;
  onClose: () => void;
  onAdopt: (image: string, how: SignatureKind) => void;
}) {
  const t = useTranslations('sign.adopt');
  const [mode, setMode] = useState<Mode>('typed');
  const [text, setText] = useState(defaultText);
  const [drawn, setDrawn] = useState('');
  const [uploaded, setUploaded] = useState('');
  const [error, setError] = useState('');
  const preview = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (open) {
      setText(defaultText);
      setError('');
    }
  }, [open, defaultText]);

  const adopt = () => {
    setError('');
    let image = '';
    if (mode === 'typed') image = text.trim() ? typedToJpeg(text.trim()) : '';
    if (mode === 'drawn') image = drawn;
    if (mode === 'upload') image = uploaded;
    if (!image) return setError(t('empty'));
    if (image.length > 250_000) return setError(t('tooLarge'));
    onAdopt(image, mode);
  };

  return (
    <SignDialog open={open} title={kind === 'signature' ? t('titleSignature') : t('titleInitials')} onClose={onClose} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          adopt();
        }}
      >
        <div className="ui-modal-body ui-fields">
          <div className="ui-tabs" role="tablist" aria-label={t('how')}>
            {(['typed', 'drawn', 'upload'] as Mode[]).map((m) => (
              <button key={m} type="button" role="tab" className="ui-tab" aria-selected={mode === m} onClick={() => setMode(m)}>
                {t(`mode.${m}`)}
              </button>
            ))}
          </div>
          {mode === 'typed' && (
            <>
              <label className="ui-field">
                <span className="label">{kind === 'signature' ? t('typeName') : t('typeInitials')}</span>
                <input className="input" maxLength={kind === 'signature' ? 80 : 5} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
              </label>
              <p ref={preview} className="sg-typed-preview" aria-hidden style={{ fontFamily: CURSIVE }}>
                {text || ' '}
              </p>
            </>
          )}
          {mode === 'drawn' && <SignaturePad label={t('drawHint')} clearLabel={t('clear')} onChange={setDrawn} />}
          {mode === 'upload' && (
            <label className="ui-field">
              <span className="label">{t('uploadLabel')}</span>
              <input
                className="input"
                type="file"
                accept="image/png,image/jpeg"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 4 * 1024 * 1024) return setError(t('tooLarge'));
                  setUploaded(await uploadToJpeg(f).catch(() => ''));
                }}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {uploaded && <img src={uploaded} alt={t('uploadPreview')} className="sg-sig-preview" />}
            </label>
          )}
          <p className="ui-help">{t('legal')}</p>
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="ui-modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="btn btn-primary">
            {t('adopt')}
          </button>
        </div>
      </form>
    </SignDialog>
  );
}

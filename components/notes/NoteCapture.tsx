'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { DocsBlock } from '@/lib/docs-types';
import { fileBlockFromUpload, type DocsUploadResult } from '@/lib/docs-files';
import { defaultQuad, enhanceDocument, outputSize, warpQuad, type Pt } from '@/lib/notes-scan';
import { NotesModal } from './NotesModal';
import NotesIcon from './NotesIcon';

/** Sube un archivo a la nota y devuelve el bloque listo para insertar. */
export async function uploadToNote(noteId: string, file: File, kind?: 'audio' | 'image'): Promise<DocsBlock | null> {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(`/api/notes/${encodeURIComponent(noteId)}/files`, { method: 'POST', body }).catch(() => null);
  if (!res?.ok) return null;
  return fileBlockFromUpload((await res.json()) as DocsUploadResult, kind);
}

function pickMime(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const [mime, ext] of [
    ['audio/webm;codecs=opus', 'weba'],
    ['audio/webm', 'weba'],
    ['audio/mp4', 'm4a'],
    ['audio/ogg;codecs=opus', 'ogg'],
  ] as const) {
    if (MediaRecorder.isTypeSupported?.(mime)) return { mime, ext };
  }
  return { mime: '', ext: 'weba' };
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * Grabar audio en la nota (como Evernote): el botón empieza a grabar con el
 * micrófono, "Parar y agregar" sube la grabación y la deja como bloque de
 * audio al final de la nota.
 */
export function AudioRecordButton({
  noteId,
  onInsert,
  onError,
}: {
  noteId: string;
  onInsert: (blocks: DocsBlock[]) => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations('notes.capture');
  const format = useFormatter();
  const [state, setState] = useState<'idle' | 'recording' | 'uploading'>('idle');
  const [secs, setSecs] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const discard = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (state !== 'recording') return;
    const h = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(h);
  }, [state]);

  useEffect(
    () => () => {
      discard.current = true;
      recRef.current?.state === 'recording' && recRef.current.stop();
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
    },
    [],
  );

  async function start() {
    const kind = pickMime();
    if (!kind || !navigator.mediaDevices?.getUserMedia) return onError(t('unsupported'));
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return onError(t('micDenied'));
    }
    streamRef.current = stream;
    const rec = new MediaRecorder(stream, kind.mime ? { mimeType: kind.mime } : undefined);
    chunks.current = [];
    discard.current = false;
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop());
      if (discard.current) {
        setState('idle');
        return;
      }
      setState('uploading');
      const type = rec.mimeType || kind.mime || 'audio/webm';
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : kind.ext;
      const name = `${t('recordingName', { date: format.dateTime(new Date(), { dateStyle: 'medium', timeStyle: 'short' }) }).replace(/[/:\\]/g, '-')}.${ext}`;
      const block = await uploadToNote(noteId, new File(chunks.current, name, { type: type.split(';')[0] }), 'audio');
      setState('idle');
      if (block) onInsert([block, { id: crypto.randomUUID(), type: 'paragraph', content: '' }]);
      else onError(t('uploadError'));
    };
    recRef.current = rec;
    rec.start(1000);
    setSecs(0);
    setState('recording');
  }

  if (state === 'recording') {
    return (
      <span className="note-recording" role="status">
        <span className="note-recording-dot" aria-hidden="true" />
        <span className="note-recording-time num">{t('recording', { time: fmt(secs) })}</span>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => recRef.current?.stop()}>
          {t('stop')}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => {
            discard.current = true;
            recRef.current?.stop();
          }}
        >
          {t('cancel')}
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm btn-icon"
      onClick={() => void start()}
      disabled={state === 'uploading'}
      aria-busy={state === 'uploading'}
      aria-label={state === 'uploading' ? t('uploading') : t('record')}
      title={state === 'uploading' ? t('uploading') : t('record')}
    >
      <NotesIcon name="mic" size={15} />
    </button>
  );
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = url;
  });
}

/**
 * Escanear un documento: foto (cámara trasera en el teléfono), las cuatro
 * esquinas de la hoja (arrastrables o con flechas), enderezado y limpieza
 * para leer. El resultado entra como imagen al final de la nota.
 */
export function ScanDialog({
  noteId,
  onInsert,
  onClose,
  onError,
}: {
  noteId: string;
  onInsert: (blocks: DocsBlock[]) => void;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations('notes.capture');
  const format = useFormatter();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [quad, setQuad] = useState<Pt[]>([]);
  const [enhance, setEnhance] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    try {
      const loaded = await loadImage(file);
      setImg(loaded);
      setQuad(defaultQuad(loaded.naturalWidth, loaded.naturalHeight));
    } catch {
      onError(t('uploadError'));
    }
  }

  function toImage(e: React.PointerEvent): Pt | null {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box || !img) return null;
    return {
      x: Math.min(img.naturalWidth, Math.max(0, ((e.clientX - box.left) / box.width) * img.naturalWidth)),
      y: Math.min(img.naturalHeight, Math.max(0, ((e.clientY - box.top) / box.height) * img.naturalHeight)),
    };
  }

  async function add() {
    if (!img || busy) return;
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.drawImage(img, 0, 0);
      const src = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { w, h } = outputSize(quad);
      let out = warpQuad(src, quad, w, h);
      if (enhance) out = enhanceDocument(out);
      const outCanvas = document.createElement('canvas');
      outCanvas.width = w;
      outCanvas.height = h;
      outCanvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(out.data), w, h), 0, 0);
      const blob = await new Promise<Blob | null>((r) => outCanvas.toBlob(r, 'image/jpeg', 0.88));
      if (!blob) throw new Error('blob');
      const name = `${t('scanName', { date: format.dateTime(new Date(), { dateStyle: 'medium', timeStyle: 'short' }) }).replace(/[/:\\]/g, '-')}.jpg`;
      const block = await uploadToNote(noteId, new File([blob], name, { type: 'image/jpeg' }), 'image');
      if (!block) throw new Error('upload');
      onInsert([block, { id: crypto.randomUUID(), type: 'paragraph', content: '' }]);
      onClose();
    } catch {
      onError(t('uploadError'));
    } finally {
      setBusy(false);
    }
  }

  const pct = (p: Pt) => (img ? { left: `${(p.x / img.naturalWidth) * 100}%`, top: `${(p.y / img.naturalHeight) * 100}%` } : {});

  return (
    <NotesModal
      title={t('scanTitle')}
      onClose={onClose}
      closeLabel={t('close')}
      wide
      className="notes-scan"
      footer={
        img ? (
          <>
            <label className="notes-scan-enhance">
              <input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} />
              {t('enhance')}
            </label>
            <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
              {t('retake')}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void add()} aria-busy={busy} disabled={busy}>
              {busy ? t('uploading') : t('add')}
            </button>
          </>
        ) : undefined
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          void choose(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {!img ? (
        <div className="notes-scan-start">
          <p className="notes-field-hint">{t('scanHint')}</p>
          <button type="button" className="btn btn-primary" autoFocus onClick={() => fileRef.current?.click()}>
            <NotesIcon name="scan" size={15} />
            {t('takePhoto')}
          </button>
        </div>
      ) : (
        <>
          <p className="notes-field-hint">{t('cropHint')}</p>
          <div
            ref={boxRef}
            className="notes-scan-stage"
            style={{ aspectRatio: `${img.naturalWidth} / ${img.naturalHeight}` }}
            onPointerMove={(e) => {
              if (drag.current === null) return;
              const p = toImage(e);
              if (p) setQuad((q) => q.map((c, i) => (i === drag.current ? p : c)));
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerLeave={() => (drag.current = null)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.src} alt="" draggable={false} />
            <svg className="notes-scan-outline" viewBox={`0 0 ${img.naturalWidth} ${img.naturalHeight}`} preserveAspectRatio="none" aria-hidden="true">
              <polygon points={quad.map((p) => `${p.x},${p.y}`).join(' ')} />
            </svg>
            {quad.map((p, i) => (
              <button
                key={i}
                type="button"
                className="notes-scan-handle"
                style={pct(p)}
                aria-label={t('corner', { n: i + 1 })}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  drag.current = i;
                }}
                onPointerMove={(e) => {
                  if (drag.current !== i) return;
                  const pt = toImage(e);
                  if (pt) setQuad((q) => q.map((c, j) => (j === i ? pt : c)));
                }}
                onPointerUp={() => (drag.current = null)}
                onKeyDown={(e) => {
                  const step = (img.naturalWidth / 100) * (e.shiftKey ? 5 : 1);
                  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
                  if (!d) return;
                  e.preventDefault();
                  setQuad((q) =>
                    q.map((c, j) =>
                      j === i
                        ? { x: Math.min(img.naturalWidth, Math.max(0, c.x + d[0])), y: Math.min(img.naturalHeight, Math.max(0, c.y + d[1])) }
                        : c,
                    ),
                  );
                }}
              />
            ))}
          </div>
        </>
      )}
    </NotesModal>
  );
}

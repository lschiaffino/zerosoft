'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { DocsBlock } from '@/lib/docs-types';
import { fileBlockFromUpload, type DocsUploadResult } from '@/lib/docs-files';
import { defaultQuad, detectQuad, enhanceDocument, outputSize, warpQuad, type Pt } from '@/lib/notes-scan';
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

/** Tope de una grabación: 15 minutos a 48 kbps (unos 5,4 MB, por debajo de los 10 MB por archivo). */
export const RECORDING_MAX_SECONDS = 15 * 60;
const RECORDING_BITS = 48_000;
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

let recordingActive = false;
/** ¿Hay una grabación en curso? (Notes pregunta antes de cambiar de nota.) */
export function isRecordingActive(): boolean {
  return recordingActive;
}

/**
 * Grabar audio en la nota (como Evernote): el botón empieza a grabar con el
 * micrófono, con el tiempo y el tope a la vista (se corta solo a los 15 min).
 * "Parar y agregar" sube la grabación y la deja como bloque de audio. Sin red,
 * o si se cambia de nota mientras se graba, la grabación no se pierde: queda
 * en el dispositivo y se agrega a su nota cuando se puede (onPending).
 */
export function AudioRecordButton({
  noteId,
  offline = false,
  onInsert,
  onPending,
  onNotice,
  onError,
}: {
  noteId: string;
  offline?: boolean;
  onInsert: (blocks: DocsBlock[]) => void;
  onPending?: (noteId: string, file: File) => Promise<'added' | 'saved' | 'failed'>;
  onNotice?: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations('notes.capture');
  const format = useFormatter();
  const [state, setState] = useState<'idle' | 'recording' | 'uploading'>('idle');
  const [secs, setSecs] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const discard = useRef(false);
  /** Se desmontó (cambio de nota) con la grabación en curso: va por onPending. */
  const unmounted = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const offlineRef = useRef(offline);
  offlineRef.current = offline;
  const pendingRef = useRef(onPending);
  pendingRef.current = onPending;

  useEffect(() => {
    if (state !== 'recording') return;
    const h = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(h);
  }, [state]);

  // Tope: se corta sola y se agrega.
  useEffect(() => {
    if (state === 'recording' && secs >= RECORDING_MAX_SECONDS) recRef.current?.stop();
  }, [state, secs]);

  useEffect(
    () => () => {
      unmounted.current = true;
      if (recRef.current?.state === 'recording') recRef.current.stop();
      else streamRef.current?.getTracks().forEach((tr) => tr.stop());
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
    const rec = new MediaRecorder(stream, { ...(kind.mime ? { mimeType: kind.mime } : {}), audioBitsPerSecond: RECORDING_BITS });
    chunks.current = [];
    discard.current = false;
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = async () => {
      recordingActive = false;
      stream.getTracks().forEach((tr) => tr.stop());
      if (discard.current) {
        if (!unmounted.current) setState('idle');
        return;
      }
      const type = rec.mimeType || kind.mime || 'audio/webm';
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : kind.ext;
      const name = `${t('recordingName', { date: format.dateTime(new Date(), { dateStyle: 'medium', timeStyle: 'short' }) }).replace(/[/:\\]/g, '-')}.${ext}`;
      const file = new File(chunks.current, name, { type: type.split(';')[0] });
      if (file.size > UPLOAD_MAX_BYTES) {
        if (!unmounted.current) setState('idle');
        return onError(t('tooBig'));
      }
      // Cambió de nota o no hay red: la sube el padre (o queda en el dispositivo).
      if (unmounted.current || offlineRef.current) {
        const res = await pendingRef.current?.(noteId, file);
        if (!unmounted.current) setState('idle');
        if (res === 'saved') onNotice?.(t('savedLocal'));
        else if (res === 'added') onNotice?.(t('addedLater'));
        else onError(t('uploadError'));
        return;
      }
      setState('uploading');
      const block = await uploadToNote(noteId, file, 'audio');
      if (block) {
        setState('idle');
        onInsert([block, { id: crypto.randomUUID(), type: 'paragraph', content: '' }]);
        return;
      }
      // Falló la subida (red caída en el medio): no se pierde.
      const res = await pendingRef.current?.(noteId, file);
      setState('idle');
      if (res === 'saved') onNotice?.(t('savedLocal'));
      else if (res === 'added') onNotice?.(t('addedLater'));
      else onError(t('uploadError'));
    };
    recRef.current = rec;
    rec.start(1000);
    recordingActive = true;
    setSecs(0);
    setState('recording');
  }

  if (state === 'recording') {
    return (
      <span className="note-recording" role="status">
        <span className="note-recording-dot" aria-hidden="true" />
        <span className="note-recording-time num">{t('recording', { time: fmt(secs), max: fmt(RECORDING_MAX_SECONDS) })}</span>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => recRef.current?.stop()}>
          {t('stop')}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => {
            if (!confirm(t('confirmDiscard'))) return;
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
/** Busca los bordes de la hoja en una copia chica de la foto. */
function detectedQuad(img: HTMLImageElement): Pt[] | null {
  const scale = Math.min(1, 320 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const quad = detectQuad(ctx.getImageData(0, 0, c.width, c.height));
  return quad ? quad.map((p) => ({ x: p.x / scale, y: p.y / scale })) : null;
}

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
  const [pages, setPages] = useState<Blob[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    try {
      const loaded = await loadImage(file);
      setImg(loaded);
      setQuad(detectedQuad(loaded) ?? defaultQuad(loaded.naturalWidth, loaded.naturalHeight));
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

  /** La foto actual, enderezada y limpia. */
  async function currentPage(): Promise<Blob> {
    if (!img) throw new Error('image');
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
    return blob;
  }

  /** Guarda esta página y pide la siguiente. */
  async function addPage() {
    if (!img || busy) return;
    setBusy(true);
    try {
      const blob = await currentPage();
      setPages((p) => [...p, blob]);
      setImg(null);
      setQuad([]);
      fileRef.current?.click();
    } catch {
      onError(t('uploadError'));
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if ((!img && !pages.length) || busy) return;
    setBusy(true);
    try {
      const all = img ? [...pages, await currentPage()] : pages;
      const stem = t('scanName', { date: format.dateTime(new Date(), { dateStyle: 'medium', timeStyle: 'short' }) }).replace(/[/:\\]/g, '-');
      let block: DocsBlock | null;
      if (all.length === 1) {
        block = await uploadToNote(noteId, new File([all[0]], `${stem}.jpg`, { type: 'image/jpeg' }), 'image');
      } else {
        // Varias páginas: un solo PDF.
        const { PDFDocument } = await import('pdf-lib');
        const pdf = await PDFDocument.create();
        for (const page of all) {
          const image = await pdf.embedJpg(await page.arrayBuffer());
          pdf.addPage([image.width, image.height]).drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
        }
        const uploaded = await uploadToNote(noteId, new File([(await pdf.save()) as BlobPart], `${stem}.pdf`, { type: 'application/pdf' }));
        block = uploaded ? { ...uploaded, type: 'pdf' } : null;
      }
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
        img || pages.length ? (
          <>
            {pages.length > 0 && <span className="notes-scan-count num">{t('scanPages', { count: pages.length + (img ? 1 : 0) })}</span>}
            <label className="notes-scan-enhance">
              <input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} />
              {t('enhance')}
            </label>
            <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
              {t('retake')}
            </button>
            <button type="button" className="btn" onClick={() => void addPage()} disabled={busy || !img}>
              {t('addPage')}
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

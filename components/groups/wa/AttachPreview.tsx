'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { filesFrom, type TrayItem } from './attachments';
import { extensionOf, fileSize, posterFrame } from './format';
import { Close, DocIcon, Plus, SendIcon, Smiley } from './icons';
import ImageEditor from './ImageEditor';
import EmojiPicker from './EmojiPicker';
import { NO_EDITS, SD_MAX_BYTES, SD_MAX_SIDE, hasEdits, needsRender, outputName, renderEdits, sendScale, viewSize, type Ctx2D, type Edits } from '@/lib/wa-image-edit';
import '@/styles/wa-editor.css';
import PdfThumb, { PDF_THUMB_MAX_BYTES } from './PdfThumb';

/** Errores que no se arreglan reintentando la subida (tamaño o tipo). */
const PERMANENT = new Set(['file_too_large', 'file_too_large_local', 'file_type_not_allowed', 'media_too_large', 'invalid_media']);
/** Fotos que se pueden editar (un GIF perdería la animación). */
const EDITABLE = /^image\/(jpeg|png|webp|bmp)$/i;

interface Orig {
  file: File;
  url: string;
  natural: { w: number; h: number } | null;
}
interface EditState {
  edits: Edits;
  history: Edits[];
  hd: boolean;
  /** Lo que había antes del arrastre en curso (para que deshacer vuelva ahí y no a un paso intermedio). */
  pending?: Edits;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = url;
  });
}

/** La foto con sus cambios (y achicada si no es HD), lista para mandar. */
async function renderPhoto(orig: Orig, edits: Edits, hd: boolean): Promise<{ file: File; width: number; height: number } | null> {
  if (!orig.natural) return null;
  try {
    const img = await loadImage(orig.url);
    const images = new Map<string, unknown>();
    await Promise.all(
      edits.overlays
        .filter((o) => o.kind === 'image' && o.src)
        .map((o) =>
          loadImage(o.src!)
            .then((im) => images.set(o.src!, im))
            .catch(() => undefined),
        ),
    );
    const v = viewSize(edits, orig.natural);
    const s = sendScale(v, hd);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(v.w * s));
    c.height = Math.max(1, Math.round(v.h * s));
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const type = hd && orig.file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    // JPEG no tiene transparencia: fondo blanco (un PNG transparente no sale negro).
    if (type === 'image/jpeg') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
    }
    renderEdits(ctx as unknown as Ctx2D, img, orig.natural, edits, s, { images });
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, type, hd ? 0.92 : 0.82));
    if (!blob) return null;
    return { file: new File([blob], outputName(orig.file.name, type), { type, lastModified: Date.now() }), width: c.width, height: c.height };
  } catch {
    return null;
  }
}

/**
 * Vista previa de los archivos antes de mandar, como en WhatsApp Web: el
 * archivo elegido grande, su comentario, la tira de miniaturas (con el avance
 * de cada subida, reintentar y sacar), "+" para sumar más y mandar todo.
 * Las fotos se editan acá (components/groups/wa/ImageEditor.tsx: recortar y
 * rotar, emoji o sticker, texto, lápiz) y llevan el botón HD: sin HD salen en
 * calidad estándar (hasta 1600 px, como WhatsApp); con HD, en tamaño real.
 * Al mandar, cada foto cambiada se dibuja en un canvas y reemplaza a la
 * original (`onReplace`). Esc cierra; Enter manda.
 */
/** La primera página del PDF que se va a mandar (del archivo local, sin subirlo). */
function TrayPdf({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url ? <PdfThumb url={url} /> : null;
}

export default function AttachPreview({
  items,
  errText,
  onCaption,
  onRemove,
  onRetry,
  onAdd,
  onSend,
  onClose,
  onFiles,
  onReplace,
  stickerApi,
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
  /**
   * Pegar (⌘V) más archivos con la vista previa abierta: se suman a la bandeja (los repetidos no). Soltarlos encima
   * llega al chat de abajo, que ya los suma igual.
   */
  onFiles?: (files: File[]) => void;
  /** Cambiar el archivo de un ítem (la foto editada o achicada). Sin esto, las fotos salen como están. */
  onReplace?: (key: string, file: File, size?: { width: number; height: number }) => void;
  /** Stickers de la colección para poner encima de una foto (/api/groups/stickers o /api/inbox/stickers). */
  stickerApi?: string;
  sending: boolean;
}) {
  const t = useTranslations('groups');
  const te = useTranslations('groups.wa.editor');
  const locale = useLocale();
  const [current, setCurrent] = useState(items[0]?.key ?? '');
  const captionRef = useRef<HTMLInputElement>(null);
  const it = items.find((x) => x.key === current) ?? items[0];
  const [captionEmoji, setCaptionEmoji] = useState(false);

  // La foto original de cada ítem (para editar siempre sobre ella) y lo que se le cambió.
  const origs = useRef(new Map<string, Orig>());
  const [, setOrigVersion] = useState(0);
  const [edit, setEdit] = useState<Record<string, EditState>>({});
  const [typing, setTyping] = useState(false);
  const [preparing, setPreparing] = useState(false);
  // Fotos reemplazadas que todavía no llegaron a la bandeja: al llegar, se manda.
  const waiting = useRef<Map<string, File> | null>(null);
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;

  useEffect(() => {
    let changed = false;
    for (const x of items) {
      if (origs.current.has(x.key) || !EDITABLE.test(x.type)) continue;
      const o: Orig = { file: x.file, url: URL.createObjectURL(x.file), natural: null };
      origs.current.set(x.key, o);
      changed = true;
      void loadImage(o.url)
        .then((img) => {
          o.natural = { w: img.naturalWidth, h: img.naturalHeight };
          setOrigVersion((v) => v + 1);
        })
        .catch(() => undefined);
    }
    for (const [key, o] of origs.current) {
      if (items.some((x) => x.key === key)) continue;
      URL.revokeObjectURL(o.url);
      origs.current.delete(key);
      changed = true;
    }
    if (changed) setOrigVersion((v) => v + 1);
    // Llegaron las fotos reemplazadas: ahora sí, mandar (con la bandeja ya al día).
    const w = waiting.current;
    if (w && [...w].every(([key, file]) => !items.some((x) => x.key === key) || items.find((x) => x.key === key)?.file === file)) {
      waiting.current = null;
      setPreparing(false);
      onSendRef.current();
    }
  }, [items]);
  useEffect(
    () => () => {
      origs.current.forEach((o) => URL.revokeObjectURL(o.url));
      origs.current.clear();
    },
    [],
  );

  // Lo que se suma después de abrir (pegar, soltar, "+") queda elegido, como en WhatsApp Web.
  const seen = useRef(new Set(items.map((x) => x.key)));
  useEffect(() => {
    const added = items.filter((x) => !seen.current.has(x.key));
    seen.current = new Set(items.map((x) => x.key));
    if (added.length) setCurrent(added[added.length - 1].key);
    else if (!items.some((x) => x.key === current) && items[0]) setCurrent(items[0].key);
  }, [items, current]);
  useEffect(() => captionRef.current?.focus(), [current]);

  const stateOf = (key: string): EditState => edit[key] ?? { edits: NO_EDITS, history: [], hd: false };
  const setEdits = useCallback((key: string, next: Edits, commit: boolean) => {
    setEdit((m) => {
      const cur = m[key] ?? { edits: NO_EDITS, history: [], hd: false };
      // Un paso para deshacer: lo que había antes del cambio (los movimientos intermedios no cuentan).
      const base = cur.pending ?? cur.edits;
      return { ...m, [key]: { ...cur, edits: next, history: commit ? [...cur.history, base].slice(-50) : cur.history, pending: commit ? undefined : base } };
    });
  }, []);
  const undo = (key: string) =>
    setEdit((m) => {
      const cur = m[key];
      if (!cur?.history.length) return m;
      return { ...m, [key]: { ...cur, edits: cur.history[cur.history.length - 1], history: cur.history.slice(0, -1) } };
    });

  async function send() {
    if (preparing || sending) return;
    if (!onReplace) return onSend();
    setPreparing(true);
    const replaced = new Map<string, File>();
    for (const x of items) {
      const o = origs.current.get(x.key);
      if (!o || x.status === 'error') continue;
      const s = stateOf(x.key);
      if (!needsRender(o.file, o.natural, s.edits, s.hd)) {
        // Sin cambios y en HD (o chica): la original, si antes se había cambiado.
        if (x.file !== o.file) {
          onReplace(x.key, o.file, o.natural ? { width: o.natural.w, height: o.natural.h } : undefined);
          replaced.set(x.key, o.file);
        }
        continue;
      }
      const out = await renderPhoto(o, s.edits, s.hd);
      if (!out) continue;
      onReplace(x.key, out.file, { width: out.width, height: out.height });
      replaced.set(x.key, out.file);
    }
    if (!replaced.size) {
      setPreparing(false);
      onSend();
      return;
    }
    // La bandeja se actualiza en el próximo render; el efecto de arriba manda cuando ya tiene las fotos nuevas.
    waiting.current = replaced;
  }

  if (!it) return null;
  const broken = items.filter((x) => x.status === 'error').length;
  const orig = origs.current.get(it.key);
  const editable = !!onReplace && !!orig?.natural;
  const st = stateOf(it.key);
  // HD solo cuando cambia algo: una foto grande (como WhatsApp, que no lo muestra en las chicas).
  const big = !!orig?.natural && (Math.max(orig.natural.w, orig.natural.h) > SD_MAX_SIDE || orig.file.size > SD_MAX_BYTES);
  const busy = sending || preparing;
  return (
    <div
      className={`wa-attach-pane${editable ? ' is-editing' : ''}`}
      data-voice-off
      role="dialog"
      aria-label={t('wa.attachments')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          if (captionEmoji) setCaptionEmoji(false);
          else onClose();
          return;
        }
        // Enter manda (salvo escribiendo un texto en la foto, o con el foco en un botón).
        const el = e.target as HTMLElement;
        if (e.key === 'Enter' && !e.shiftKey && !typing && !e.nativeEvent.isComposing && !(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLButtonElement) && !(el instanceof HTMLInputElement && el.type !== 'text' && el.type !== 'search')) {
          e.preventDefault();
          void send();
        }
      }}
      onPaste={(e) => {
        // Solo con archivos o imágenes en el portapapeles: pegar texto en el comentario sigue pegando texto.
        const files = onFiles ? filesFrom(e.clipboardData) : [];
        if (!files.length) return;
        e.preventDefault();
        e.stopPropagation();
        onFiles?.(files);
      }}
    >
      <header className="wa-attach-head">
        <button type="button" className="wa-icon-btn" onClick={onClose} aria-label={t('common.cancel')} title={t('common.cancel')}>
          <Close />
        </button>
        <span className="wa-attach-name" title={it.name}>
          {it.name}
        </span>
        {editable && big && (
          <button
            type="button"
            className={`wa-hd${st.hd ? ' is-on' : ''}`}
            aria-pressed={st.hd}
            onClick={() => setEdit((m) => ({ ...m, [it.key]: { ...stateOf(it.key), hd: !st.hd } }))}
            title={st.hd ? te('hdOn') : te('hdOff')}
            aria-label={te('hd')}
            data-testid="edit-hd"
          >
            HD
          </button>
        )}
      </header>
      <div className="wa-attach-stage">
        {editable && orig?.natural ? (
          <ImageEditor
            key={it.key}
            src={orig.url}
            natural={orig.natural}
            edits={st.edits}
            onChange={(e, commit) => setEdits(it.key, e, commit)}
            onUndo={() => undo(it.key)}
            canUndo={st.history.length > 0}
            stickerApi={stickerApi}
            onBusyKey={setTyping}
          />
        ) : it.preview && it.type.startsWith('image/') ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={it.preview} alt={it.name} />
        ) : it.preview && it.type.startsWith('video/') ? (
          <video src={it.preview} controls playsInline />
        ) : (
          <div className="wa-attach-doc">
            {it.type === 'application/pdf' && it.size <= PDF_THUMB_MAX_BYTES ? <TrayPdf key={it.key} file={it.file} /> : null}
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
        <span className="wa-emoji-wrap">
          <button type="button" className="wa-icon-btn" data-emoji-toggle aria-label={t('wa.emoji')} title={t('wa.emoji')} aria-expanded={captionEmoji} onClick={() => setCaptionEmoji((v) => !v)} disabled={it.type.startsWith('audio/')}>
            <Smiley size={22} />
          </button>
          {captionEmoji && (
            <EmojiPicker
              onPick={(emoji) => {
                const el = captionRef.current;
                const v = it.caption ?? '';
                const a = el?.selectionStart ?? v.length;
                const b = el?.selectionEnd ?? v.length;
                onCaption(it.key, (v.slice(0, a) + emoji + v.slice(b)).slice(0, 1024));
                requestAnimationFrame(() => {
                  el?.focus();
                  el?.setSelectionRange(a + emoji.length, a + emoji.length);
                });
              }}
              onClose={() => {
                setCaptionEmoji(false);
                captionRef.current?.focus();
              }}
            />
          )}
        </span>
        <input
          ref={captionRef}
          className="input"
          value={it.caption ?? ''}
          onChange={(e) => onCaption(it.key, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.stopPropagation();
              void send();
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
            <li key={f.key} className={`wa-attach-thumb is-${f.status}${f.key === it.key ? ' is-on' : ''}${hasEdits(edit[f.key]?.edits) ? ' is-edited' : ''}`}>
              <button type="button" className="wa-attach-pick" onClick={() => setCurrent(f.key)} aria-label={f.name} aria-current={f.key === it.key || undefined}>
                {f.preview && f.type.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={origs.current.get(f.key)?.url ?? f.preview} alt="" />
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
          onClick={() => void send()}
          disabled={busy || broken === items.length}
          aria-busy={busy || undefined}
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

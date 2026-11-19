'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import EmojiPicker from './EmojiPicker';
import type { StickerItem } from './StickerPanel';
import { Trash } from './icons';
import { NO_EDITS, cropOf, fromView, rectFromView, renderEdits, rotateLeft, toView, viewSize, EMOJI_FONT, TEXT_FONT, type Ctx2D, type Edits, type Overlay, type Rect } from '@/lib/wa-image-edit';

type Tool = '' | 'draw' | 'crop';
/** Los colores del lápiz y del texto (los de WhatsApp, de claro a oscuro). */
export const EDIT_COLORS = ['#ffffff', '#000000', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00a884', '#007aff', '#af52de', '#ff2d92'];
/** Grosor del lápiz en px de pantalla (chico, mediano, grande). */
const BRUSHES = [4, 9, 18];
const TEXT_PX = 34;
const EMOJI_PX = 72;
const STICKER_PX = 140;
const MIN_CROP = 24;

let seq = 0;
const newId = () => `o${Date.now().toString(36)}${++seq}`;

/** Fotos cargadas por URL (la foto y los stickers que se ponen encima). */
function useImages(urls: string[]) {
  const [map, setMap] = useState(() => new Map<string, HTMLImageElement>());
  useEffect(() => {
    for (const u of urls) {
      if (!u || map.has(u)) continue;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => setMap((m) => new Map(m).set(u, img));
      img.src = u;
    }
  }, [urls.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  return map;
}

/**
 * Editor de la foto en la vista previa, como en WhatsApp: recortar y rotar,
 * emoji o sticker encima, texto (T) con color y lápiz con colores, grosor y
 * deshacer. Lo de encima se mueve arrastrándolo y se agranda o achica con la
 * barra; Suprimir lo saca. Todo queda en `edits` (coordenadas de la foto
 * original, lib/wa-image-edit.ts) y se dibuja en la foto al mandar.
 * La vista es un canvas del tamaño de la pantalla (rápido en el teléfono).
 */
export default function ImageEditor({
  src,
  natural,
  edits,
  onChange,
  onUndo,
  canUndo,
  stickerApi,
  stickerLine,
  onBusyKey,
}: {
  /** La foto original (URL local). */
  src: string;
  natural: { w: number; h: number };
  edits: Edits;
  /** commit: guarda un paso para deshacer (al soltar, no en cada movimiento). */
  onChange: (e: Edits, commit: boolean) => void;
  onUndo: () => void;
  canUndo: boolean;
  /** Para poner stickers de la colección (la pestaña Stickers del panel de emojis). */
  stickerApi?: string;
  /** La línea del chat: los stickers que se ofrecen son los de esa. */
  stickerLine?: string;
  /** Avisa si el editor está usando el teclado (escribiendo un texto): Enter no manda. */
  onBusyKey?: (busy: boolean) => void;
}) {
  const t = useTranslations('groups.wa.editor');
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [tool, setTool] = useState<Tool>('');
  const [color, setColor] = useState(EDIT_COLORS[2]);
  const [brush, setBrush] = useState(BRUSHES[1]);
  const [selected, setSelected] = useState<string | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // Recorte en curso: el rectángulo en px de la vista sin recortar (con la rotación de ese momento).
  const [cropBox, setCropBox] = useState<Rect | null>(null);
  const drag = useRef<null | { kind: 'draw'; stroke: number } | { kind: 'move'; id: string; dx: number; dy: number; moved: boolean } | { kind: 'crop'; handle: string; start: Rect; px: number; py: number }>(null);
  const editsRef = useRef(edits);
  editsRef.current = edits;

  const imageUrls = useMemo(() => [src, ...edits.overlays.filter((o) => o.kind === 'image' && o.src).map((o) => o.src!)], [src, edits.overlays]);
  const images = useImages(imageUrls);
  const photo = images.get(src);

  useEffect(() => onBusyKey?.(!!typing), [typing, onBusyKey]);
  // Al cerrar una herramienta, su botón puede desaparecer: el foco queda en el editor (Esc y Enter siguen andando).
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const a = document.activeElement;
    if (!a || a === document.body || !a.isConnected) rootRef.current?.focus({ preventScroll: true });
  }, [tool, typing, emojiOpen]);

  // Tamaño disponible para la vista.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // En modo recorte se ve la foto entera (rotada), con el marco del recorte encima.
  const shown = useMemo<Edits>(() => (tool === 'crop' ? { ...edits, crop: null } : edits), [tool, edits]);
  const view = viewSize(shown, natural);
  const scale = box.w && box.h ? Math.min(box.w / view.w, box.h / view.h, 4) : 0;
  const cssW = Math.max(1, Math.round(view.w * scale));
  const cssH = Math.max(1, Math.round(view.h * scale));

  // Dibujar la vista (en el próximo cuadro, una vez aunque cambien varias cosas).
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !photo || !scale) return;
    const id = requestAnimationFrame(() => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      renderEdits(ctx as unknown as Ctx2D, photo, natural, shown, scale * dpr, { images, skipOverlay: typing ?? undefined });
    });
    return () => cancelAnimationFrame(id);
  });

  /** Punto de la pantalla → px de la original. */
  const toOrig = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return fromView({ x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }, shown, natural);
  };

  /** Caja en pantalla (px del canvas) de lo de encima, para tocarlo, marcarlo y escribir. */
  const measureCtx = useMemo(() => (typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null), []);
  const overlayBox = useCallback(
    (o: Overlay) => {
      const v = toView({ x: o.x, y: o.y }, shown, natural);
      const cx = v.x * scale;
      const cy = v.y * scale;
      let w = o.size * scale;
      let h = o.size * scale;
      if (o.kind === 'image') h = o.size * (o.ratio || 1) * scale;
      else if (o.kind === 'text') {
        const lines = (o.text || ' ').split('\n');
        if (measureCtx) {
          measureCtx.font = TEXT_FONT.replace('{size}', String(Math.round(o.size * scale)));
          w = Math.max(...lines.map((l) => measureCtx.measureText(l || ' ').width)) + 12;
        }
        h = lines.length * o.size * scale * 1.2;
      } else if (measureCtx) {
        measureCtx.font = EMOJI_FONT.replace('{size}', String(Math.round(o.size * scale)));
        w = Math.max(w, measureCtx.measureText(o.text || '').width);
      }
      return { cx, cy, w, h };
    },
    [shown, natural, scale, measureCtx],
  );

  const hit = (e: { clientX: number; clientY: number }): Overlay | null => {
    const r = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    for (let i = edits.overlays.length - 1; i >= 0; i--) {
      const o = edits.overlays[i];
      const b = overlayBox(o);
      if (Math.abs(px - b.cx) <= b.w / 2 + 6 && Math.abs(py - b.cy) <= b.h / 2 + 6) return o;
    }
    return null;
  };

  const patchOverlay = (id: string, p: Partial<Overlay>, commit: boolean) => onChange({ ...editsRef.current, overlays: editsRef.current.overlays.map((o) => (o.id === id ? { ...o, ...p } : o)) }, commit);

  function finishTyping() {
    if (!typing) return;
    const o = editsRef.current.overlays.find((x) => x.id === typing);
    setTyping(null);
    if (o && !o.text?.trim()) {
      onChange({ ...editsRef.current, overlays: editsRef.current.overlays.filter((x) => x.id !== o.id) }, false);
      setSelected(null);
    } else onChange(editsRef.current, true);
  }

  function addOverlay(o: Omit<Overlay, 'id' | 'x' | 'y'>, at?: { x: number; y: number }) {
    const v = viewSize(edits, natural);
    const center = at ?? fromView({ x: v.w / 2, y: v.h / 2 }, edits, natural);
    const next: Overlay = { ...o, id: newId(), x: center.x, y: center.y };
    onChange({ ...edits, overlays: [...edits.overlays, next] }, o.kind !== 'text');
    setSelected(next.id);
    return next;
  }

  function startText(at?: { x: number; y: number }) {
    finishTyping();
    setTool('');
    const o = addOverlay({ kind: 'text', size: TEXT_PX / (scale || 1), text: '', color }, at);
    setTyping(o.id);
  }

  function onPointerDown(e: RPointerEvent<HTMLCanvasElement>) {
    if (!scale || e.button > 0) return;
    if (typing) finishTyping();
    if (tool === 'draw') {
      e.currentTarget.setPointerCapture(e.pointerId);
      const p = toOrig(e);
      const stroke = { color, width: brush / scale, points: [p.x, p.y] };
      drag.current = { kind: 'draw', stroke: edits.strokes.length };
      onChange({ ...edits, strokes: [...edits.strokes, stroke] }, false);
      return;
    }
    if (tool === 'crop') return;
    const o = hit(e);
    if (o) {
      e.currentTarget.setPointerCapture(e.pointerId);
      const p = toOrig(e);
      drag.current = { kind: 'move', id: o.id, dx: o.x - p.x, dy: o.y - p.y, moved: false };
      setSelected(o.id);
      if (o.kind === 'text') setColor(o.color ?? color);
      return;
    }
    setSelected(null);
  }

  function onPointerMove(e: RPointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    if (!d) return;
    const p = toOrig(e);
    const cur = editsRef.current;
    if (d.kind === 'draw') {
      const strokes = cur.strokes.slice();
      const s = strokes[d.stroke];
      if (!s) return;
      strokes[d.stroke] = { ...s, points: [...s.points, p.x, p.y] };
      onChange({ ...cur, strokes }, false);
    } else if (d.kind === 'move') {
      d.moved = true;
      patchOverlay(d.id, { x: p.x + d.dx, y: p.y + d.dy }, false);
    }
  }

  function onPointerUp(e: RPointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'draw') onChange(editsRef.current, true);
    else if (d.kind === 'move') {
      if (d.moved) onChange(editsRef.current, true);
      // Un toque sobre un texto (sin arrastrar): escribir de nuevo.
      else if (editsRef.current.overlays.find((o) => o.id === d.id)?.kind === 'text') setTyping(d.id);
    }
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  // ---- Recorte ----
  function startCrop() {
    finishTyping();
    setSelected(null);
    setEmojiOpen(false);
    const full = { ...edits, crop: null };
    const c = cropOf(edits, natural);
    const a = toView({ x: c.x, y: c.y }, full, natural);
    const b = toView({ x: c.x + c.w, y: c.y + c.h }, full, natural);
    setCropBox({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
    setTool('crop');
  }

  function rotateCrop() {
    if (!cropBox) return;
    const full = { ...edits, crop: null };
    // El marco actual a la original, rotar, y de vuelta a la vista nueva.
    const orig = rectFromView(cropBox, full, natural);
    const rotated: Edits = { ...edits, rotate: rotateLeft(edits.rotate) };
    const fullR = { ...rotated, crop: null };
    const a = toView({ x: orig.x, y: orig.y }, fullR, natural);
    const b = toView({ x: orig.x + orig.w, y: orig.y + orig.h }, fullR, natural);
    onChange(rotated, true);
    setCropBox({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  }

  function applyCrop() {
    if (!cropBox) return setTool('');
    const full = { ...edits, crop: null };
    const v = viewSize(full, natural);
    const whole = cropBox.x <= 0.5 && cropBox.y <= 0.5 && cropBox.w >= v.w - 1 && cropBox.h >= v.h - 1;
    onChange({ ...edits, crop: whole ? null : rectFromView(cropBox, full, natural) }, true);
    setCropBox(null);
    setTool('');
  }

  function resetCrop() {
    const v = viewSize({ ...edits, crop: null }, natural);
    setCropBox({ x: 0, y: 0, w: v.w, h: v.h });
  }

  function cropDown(e: RPointerEvent<HTMLElement>, handle: string) {
    if (!cropBox) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind: 'crop', handle, start: cropBox, px: e.clientX, py: e.clientY };
  }
  function cropMove(e: RPointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || d.kind !== 'crop' || !scale) return;
    const v = view;
    const dx = (e.clientX - d.px) / scale;
    const dy = (e.clientY - d.py) / scale;
    const min = MIN_CROP / scale;
    let { x, y, w, h } = d.start;
    if (d.handle === 'move') {
      x = Math.min(Math.max(0, x + dx), v.w - w);
      y = Math.min(Math.max(0, y + dy), v.h - h);
    } else {
      if (d.handle.includes('w')) {
        const nx = Math.min(Math.max(0, x + dx), x + w - min);
        w += x - nx;
        x = nx;
      }
      if (d.handle.includes('e')) w = Math.min(Math.max(min, w + dx), v.w - x);
      if (d.handle.includes('n')) {
        const ny = Math.min(Math.max(0, y + dy), y + h - min);
        h += y - ny;
        y = ny;
      }
      if (d.handle.includes('s')) h = Math.min(Math.max(min, h + dy), v.h - y);
    }
    setCropBox({ x, y, w, h });
  }
  function cropUp() {
    if (drag.current?.kind === 'crop') drag.current = null;
  }

  // ---- Teclado ----
  function onKeyDown(e: RKeyboardEvent<HTMLDivElement>) {
    if (e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'Escape') {
      if (tool === 'crop') {
        setCropBox(null);
        setTool('');
      } else if (emojiOpen) setEmojiOpen(false);
      else if (tool) setTool('');
      else if (selected) setSelected(null);
      else return;
      e.preventDefault();
      e.stopPropagation();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      e.stopPropagation();
      onChange({ ...edits, overlays: edits.overlays.filter((o) => o.id !== selected) }, true);
      setSelected(null);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && canUndo) {
      e.preventDefault();
      e.stopPropagation();
      onUndo();
    }
  }

  const sel = selected ? edits.overlays.find((o) => o.id === selected) ?? null : null;
  const typingO = typing ? edits.overlays.find((o) => o.id === typing) ?? null : null;
  const showColors = tool === 'draw' || sel?.kind === 'text' || !!typingO;
  const pickColor = (c: string) => {
    setColor(c);
    const target = typingO ?? (sel?.kind === 'text' ? sel : null);
    if (target) patchOverlay(target.id, { color: c }, !typingO);
  };

  return (
    <div className="wa-edit" ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown} data-tool={tool || undefined}>
      <div className="wa-edit-tools" role="toolbar" aria-label={t('tools')}>
        {tool === 'crop' ? (
          <>
            <button type="button" className="wa-edit-btn" onClick={rotateCrop} aria-label={t('rotate')} title={t('rotate')} data-testid="edit-rotate">
              <RotateIcon />
            </button>
            <button type="button" className="wa-edit-btn is-text" onClick={resetCrop} data-testid="edit-crop-reset">
              {t('reset')}
            </button>
            <button type="button" className="wa-edit-btn is-done" onClick={applyCrop} data-testid="edit-crop-done">
              {t('done')}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="wa-edit-btn" onClick={startCrop} aria-label={t('crop')} title={t('crop')} data-testid="edit-crop">
              <CropIcon />
            </button>
            <span className="wa-edit-emoji-wrap">
              <button
                type="button"
                className={`wa-edit-btn${emojiOpen ? ' is-on' : ''}`}
                data-emoji-toggle
                onClick={() => (finishTyping(), setTool(''), setEmojiOpen((v) => !v))}
                aria-label={t('sticker')}
                title={t('sticker')}
                aria-expanded={emojiOpen}
                data-testid="edit-sticker"
              >
                <StickerIcon />
              </button>
              {emojiOpen && (
                <EmojiPicker
                  onPick={(emoji) => {
                    addOverlay({ kind: 'emoji', size: EMOJI_PX / (scale || 1), text: emoji });
                    setEmojiOpen(false);
                  }}
                  stickers={
                    stickerApi && stickerLine
                      ? {
                          api: stickerApi,
                          line: stickerLine,
                          onSend: async (s: StickerItem) => {
                            addOverlay({ kind: 'image', size: STICKER_PX / (scale || 1), src: s.url, ratio: 1 });
                            setEmojiOpen(false);
                            return true;
                          },
                        }
                      : undefined
                  }
                  onClose={() => setEmojiOpen(false)}
                />
              )}
            </span>
            <button type="button" className="wa-edit-btn" onClick={() => startText()} aria-label={t('text')} title={t('text')} data-testid="edit-text">
              <TextIcon />
            </button>
            <button
              type="button"
              className={`wa-edit-btn${tool === 'draw' ? ' is-on' : ''}`}
              onClick={() => (finishTyping(), setEmojiOpen(false), setSelected(null), setTool(tool === 'draw' ? '' : 'draw'))}
              aria-label={t('draw')}
              title={t('draw')}
              aria-pressed={tool === 'draw'}
              data-testid="edit-draw"
            >
              <PencilIcon />
            </button>
            <button type="button" className="wa-edit-btn" onClick={onUndo} disabled={!canUndo} aria-label={t('undo')} title={t('undo')} data-testid="edit-undo">
              <UndoIcon />
            </button>
          </>
        )}
      </div>
      {(showColors || sel) && tool !== 'crop' && (
        <div className="wa-edit-props">
          {showColors && (
            <div className="wa-edit-colors" role="radiogroup" aria-label={t('color')}>
              {EDIT_COLORS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} className="wa-edit-swatch" style={{ background: c }} onMouseDown={(e) => e.preventDefault()} onClick={() => pickColor(c)} />
              ))}
            </div>
          )}
          {tool === 'draw' && (
            <div className="wa-edit-brushes" role="radiogroup" aria-label={t('brush')}>
              {BRUSHES.map((b, i) => (
                <button key={b} type="button" role="radio" aria-checked={brush === b} aria-label={t(`brushSizes.${i}`)} title={t(`brushSizes.${i}`)} className="wa-edit-brush" onClick={() => setBrush(b)}>
                  <i style={{ width: b, height: b, background: color }} />
                </button>
              ))}
            </div>
          )}
          {sel && tool !== 'draw' && (
            <div className="wa-edit-size">
              <input
                type="range"
                min={0.3}
                max={3}
                step={0.05}
                aria-label={t('size')}
                value={Math.min(3, Math.max(0.3, (sel.size * scale) / (sel.kind === 'text' ? TEXT_PX : sel.kind === 'emoji' ? EMOJI_PX : STICKER_PX)))}
                onChange={(e) => patchOverlay(sel.id, { size: (Number(e.target.value) * (sel.kind === 'text' ? TEXT_PX : sel.kind === 'emoji' ? EMOJI_PX : STICKER_PX)) / scale }, false)}
                onPointerUp={() => onChange(editsRef.current, true)}
                onKeyUp={() => onChange(editsRef.current, true)}
              />
              <button
                type="button"
                className="wa-edit-btn"
                onClick={() => {
                  onChange({ ...edits, overlays: edits.overlays.filter((o) => o.id !== sel.id) }, true);
                  setSelected(null);
                }}
                aria-label={t('remove')}
                title={t('remove')}
              >
                <Trash size={18} />
              </button>
            </div>
          )}
        </div>
      )}
      <div className="wa-edit-stage" ref={wrapRef}>
        <div className="wa-edit-canvas" style={{ width: cssW, height: cssH }}>
          <canvas
            ref={canvasRef}
            style={{ width: cssW, height: cssH }}
            className="wa-edit-photo"
            role="img"
            aria-label={t('photo')}
            data-testid="edit-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={(e) => {
              if (tool) return;
              const o = hit(e);
              if (o?.kind === 'text') setTyping(o.id);
              else if (!o) startText(toOrig(e));
            }}
          />
          {sel && !typingO && tool !== 'crop' && (
            <span
              className="wa-edit-sel"
              aria-hidden="true"
              style={(() => {
                const b = overlayBox(sel);
                return { left: b.cx - b.w / 2 - 4, top: b.cy - b.h / 2 - 4, width: b.w + 8, height: b.h + 8 };
              })()}
            />
          )}
          {typingO &&
            (() => {
              const b = overlayBox(typingO);
              const fs = Math.round(typingO.size * scale);
              return (
                <textarea
                  className="wa-edit-typing"
                  autoFocus
                  rows={Math.max(1, (typingO.text ?? '').split('\n').length)}
                  value={typingO.text ?? ''}
                  placeholder={t('textPlaceholder')}
                  aria-label={t('text')}
                  data-testid="edit-text-input"
                  maxLength={300}
                  style={{ left: 0, width: '100%', top: b.cy - b.h / 2, fontSize: fs, lineHeight: 1.2, color: typingO.color }}
                  onChange={(e) => patchOverlay(typingO.id, { text: e.target.value }, false)}
                  onBlur={finishTyping}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      finishTyping();
                    }
                  }}
                />
              );
            })()}
          {tool === 'crop' && cropBox && (
            <div className="wa-edit-crop" onPointerMove={cropMove} onPointerUp={cropUp} onPointerCancel={cropUp}>
              <div
                className="wa-edit-crop-box"
                data-testid="edit-crop-box"
                style={{ left: cropBox.x * scale, top: cropBox.y * scale, width: cropBox.w * scale, height: cropBox.h * scale }}
                onPointerDown={(e) => cropDown(e, 'move')}
              >
                {['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'].map((h) => (
                  <span key={h} className={`wa-edit-handle is-${h}`} data-handle={h} onPointerDown={(e) => cropDown(e, h)} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** El estado inicial de una foto sin tocar. */
export const emptyEdits = (): Edits => ({ ...NO_EDITS, strokes: [], overlays: [] });

const I = ({ children }: { children: ReactNode }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);
const CropIcon = () => (
  <I>
    <path d="M6 2v14a2 2 0 0 0 2 2h14" />
    <path d="M2 6h14a2 2 0 0 1 2 2v14" />
  </I>
);
const RotateIcon = () => (
  <I>
    <path d="M3 4v6h6" />
    <path d="M3.5 10A8.5 8.5 0 1 1 6 16.5" />
  </I>
);
const StickerIcon = () => (
  <I>
    <path d="M15.5 21H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8.5Z" />
    <path d="M21 15h-3a3 3 0 0 0-3 3v3" />
    <path d="M8.5 13.5c1 1.2 2.2 1.8 3.5 1.8" />
    <path d="M9 9h.01M15 9h.01" />
  </I>
);
const TextIcon = () => (
  <I>
    <path d="M5 6V4h14v2" />
    <path d="M12 4v16" />
    <path d="M9 20h6" />
  </I>
);
const PencilIcon = () => (
  <I>
    <path d="M4 20h4L19 9l-4-4L4 16Z" />
    <path d="m13.5 6.5 4 4" />
  </I>
);
const UndoIcon = () => (
  <I>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </I>
);

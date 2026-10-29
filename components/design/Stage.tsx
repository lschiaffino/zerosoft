'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  bounds,
  clampCrop,
  corners,
  imagePlacement,
  intersects,
  resizeBox,
  resizeImageSide,
  rotationFromPointer,
  snapMove,
  unionBounds,
  type Box,
  type DesignElement,
  type Handle,
  type ImageEl,
  type Point,
  type TextEl,
} from '@/lib/design-model';
import PageSvg, { fileHref } from './PageSvg';
import { fontFamily } from './fonts';
import type { Editor } from './useEditor';

export interface Pin {
  id: string;
  n: number;
  x: number;
  y: number;
  active: boolean;
}

export interface StageView {
  zoom: number;
  panX: number;
  panY: number;
}

type Drag =
  | { kind: 'move'; start: Point; startEls: DesignElement[]; moved: boolean; others: Box[] }
  | { kind: 'resize'; start: Point; handle: Handle; startEls: DesignElement[]; union: Box }
  | { kind: 'rotate'; el: DesignElement }
  | { kind: 'marquee'; start: Point; additive: boolean }
  | { kind: 'pan'; start: { x: number; y: number }; view: StageView }
  | { kind: 'crop'; start: Point; el: ImageEl };

const ACCENT = '#00a5c8';
const GUIDE = '#ff2d95';

const HANDLES: Handle[] = [
  { sx: -1, sy: -1 },
  { sx: 0, sy: -1 },
  { sx: 1, sy: -1 },
  { sx: 1, sy: 0 },
  { sx: 1, sy: 1 },
  { sx: 0, sy: 1 },
  { sx: -1, sy: 1 },
  { sx: -1, sy: 0 },
];

function handlesFor(els: DesignElement[]): Handle[] {
  if (els.length !== 1) return HANDLES.filter((h) => h.sx !== 0 && h.sy !== 0);
  const el = els[0];
  if (el.type === 'line') return HANDLES.filter((h) => h.sy === 0);
  if (el.type === 'text') return HANDLES.filter((h) => h.sy === 0 || h.sx !== 0);
  return HANDLES;
}

function cursorFor(h: Handle, rotation: number): string {
  const angle = ((Math.atan2(h.sy, h.sx) * 180) / Math.PI + rotation + 360) % 180;
  if (angle < 22.5 || angle >= 157.5) return 'ew-resize';
  if (angle < 67.5) return 'nwse-resize';
  if (angle < 112.5) return 'ns-resize';
  return 'nesw-resize';
}

export default function Stage({
  ed,
  view,
  setView,
  tool,
  editingTextId,
  setEditingTextId,
  cropId,
  setCropId,
  pins,
  onPin,
  onCommentAt,
  onDropFiles,
  onDropFileRef,
  readOnly,
  placeholderLabel,
  stageLabel,
}: {
  ed: Editor;
  view: StageView;
  setView: (v: StageView) => void;
  tool: 'select' | 'comment';
  editingTextId: string | null;
  setEditingTextId: (id: string | null) => void;
  cropId: string | null;
  setCropId: (id: string | null) => void;
  pins: Pin[];
  onPin: (id: string) => void;
  onCommentAt: (p: Point) => void;
  onDropFiles: (files: File[], at: Point, targetId: string | null) => void;
  onDropFileRef: (file: { id: string; width: number; height: number }, at: Point, targetId: string | null) => void;
  readOnly: boolean;
  placeholderLabel: string;
  stageLabel: string;
}) {
  const { doc, page, selectedSet } = ed;
  const viewportRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [guides, setGuides] = useState<Array<{ axis: 'x' | 'y'; pos: number }>>([]);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const spaceDown = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  const toPage = useCallback((clientX: number, clientY: number): Point => {
    const r = svgRef.current?.getBoundingClientRect();
    const z = viewRef.current.zoom;
    if (!r) return { x: 0, y: 0 };
    return { x: (clientX - r.left) / z, y: (clientY - r.top) / z };
  }, []);

  // Espacio + arrastrar = mover la vista (como en Canva y Figma).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) spaceDown.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Rueda: desplaza; con Ctrl/Cmd (o pellizco del trackpad), zoom hacia el puntero.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        const r = vp.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        const zoom = Math.min(8, Math.max(0.05, v.zoom * Math.exp(-e.deltaY / 300)));
        const k = zoom / v.zoom;
        setView({ zoom, panX: mx - (mx - v.panX) * k, panY: my - (my - v.panY) * k });
      } else {
        setView({ ...v, panX: v.panX - e.deltaX, panY: v.panY - e.deltaY });
      }
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [setView]);

  const elementAt = (target: EventTarget | null): DesignElement | null => {
    const node = (target as Element | null)?.closest?.('[data-el]');
    const id = node?.getAttribute('data-el');
    return id ? (page.elements.find((e) => e.id === id) ?? null) : null;
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
      drag.current = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, view: viewRef.current };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const pt = toPage(e.clientX, e.clientY);
    const handleAttr = (e.target as Element).closest?.('[data-handle]')?.getAttribute('data-handle');
    // Un pin abre su hilo (también con la herramienta de comentar).
    if ((e.target as Element).closest?.('[data-pin]')) return;
    if (tool === 'comment') {
      if (pt.x >= 0 && pt.y >= 0 && pt.x <= doc.width && pt.y <= doc.height) onCommentAt(pt);
      return;
    }
    if (editingTextId) setEditingTextId(null);
    if (readOnly) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const sel = ed.selectedElements();
    if (handleAttr === 'rotate' && sel.length === 1) {
      ed.beginGesture();
      drag.current = { kind: 'rotate', el: sel[0] };
      return;
    }
    if (handleAttr && sel.length) {
      const [sx, sy] = handleAttr.split(',').map(Number) as [Handle['sx'], Handle['sy']];
      ed.beginGesture();
      drag.current = { kind: 'resize', start: pt, handle: { sx, sy }, startEls: sel, union: unionBounds(sel.map(bounds))! };
      return;
    }
    if (cropId) {
      const el = page.elements.find((x) => x.id === cropId);
      if (el && el.type === 'image' && elementAt(e.target)?.id === cropId) {
        ed.beginGesture();
        drag.current = { kind: 'crop', start: pt, el };
        return;
      }
      setCropId(null);
    }
    const hit = elementAt(e.target);
    if (!hit) {
      drag.current = { kind: 'marquee', start: pt, additive: e.shiftKey };
      if (!e.shiftKey) ed.setSelected([]);
      return;
    }
    if (e.shiftKey) {
      ed.select([hit.id], true);
      return;
    }
    if (!selectedSet.has(hit.id)) ed.select([hit.id]);
    const ids = selectedSet.has(hit.id) ? ed.selRef.current : [...new Set([hit.id, ...page.elements.filter((x) => hit.groupId && x.groupId === hit.groupId).map((x) => x.id)])];
    const startEls = page.elements.filter((x) => ids.includes(x.id));
    if (startEls.every((x) => x.locked)) return;
    ed.beginGesture();
    drag.current = {
      kind: 'move',
      start: pt,
      startEls,
      moved: false,
      others: page.elements.filter((x) => !ids.includes(x.id) && !x.hidden).map(bounds),
    };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) {
      const hit = elementAt(e.target);
      setHoverId(hit && !selectedSet.has(hit.id) ? hit.id : null);
      return;
    }
    if (d.kind === 'pan') {
      setView({ ...d.view, panX: d.view.panX + e.clientX - d.start.x, panY: d.view.panY + e.clientY - d.start.y });
      return;
    }
    const pt = toPage(e.clientX, e.clientY);
    const z = viewRef.current.zoom;
    if (d.kind === 'marquee') {
      setMarquee({ x: Math.min(d.start.x, pt.x), y: Math.min(d.start.y, pt.y), w: Math.abs(pt.x - d.start.x), h: Math.abs(pt.y - d.start.y) });
      return;
    }
    if (d.kind === 'move') {
      let dx = pt.x - d.start.x;
      let dy = pt.y - d.start.y;
      if (!d.moved && Math.hypot(dx, dy) * z < 3) return;
      d.moved = true;
      const movable = d.startEls.filter((x) => !x.locked);
      if (!e.altKey) {
        const box = unionBounds(movable.map(bounds))!;
        const snap = snapMove({ ...box, x: box.x + dx, y: box.y + dy }, d.others, { w: doc.width, h: doc.height }, 6 / z);
        dx += snap.dx;
        dy += snap.dy;
        setGuides(snap.guides);
      } else setGuides([]);
      const byId = new Map(movable.map((x) => [x.id, x]));
      ed.updateElements([...byId.keys()], (el) => ({ ...el, x: byId.get(el.id)!.x + dx, y: byId.get(el.id)!.y + dy }), false);
      return;
    }
    if (d.kind === 'rotate') {
      const c = { x: d.el.x + d.el.w / 2, y: d.el.y + d.el.h / 2 };
      const rotation = rotationFromPointer(c, pt, e.shiftKey);
      ed.updateElements([d.el.id], (el) => ({ ...el, rotation }), false);
      return;
    }
    if (d.kind === 'crop') {
      const el = d.el;
      const full = imagePlacement(el);
      const k = (el.rotation * Math.PI) / 180;
      // Movimiento en coordenadas de la imagen (sin la rotación de la caja).
      const wx = pt.x - d.start.x;
      const wy = pt.y - d.start.y;
      const lx = wx * Math.cos(-k) - wy * Math.sin(-k);
      const ly = wx * Math.sin(-k) + wy * Math.cos(-k);
      const crop = clampCrop({ ...el.crop, x: el.crop.x - (el.flipX ? -lx : lx) / full.w, y: el.crop.y - (el.flipY ? -ly : ly) / full.h });
      ed.updateElements([el.id], (x) => ({ ...x, crop }) as DesignElement, false);
      return;
    }
    if (d.kind === 'resize') {
      const dx = pt.x - d.start.x;
      const dy = pt.y - d.start.y;
      if (d.startEls.length === 1) {
        const el = d.startEls[0];
        if (el.locked) return;
        const corner = d.handle.sx !== 0 && d.handle.sy !== 0;
        if (el.type === 'image' && el.src && !corner) {
          const next = resizeImageSide(el, d.handle, dx, dy);
          ed.updateElements([el.id], (x) => ({ ...x, ...next }) as DesignElement, false);
          return;
        }
        const keepAspect = corner && (e.shiftKey || el.type === 'image' || el.type === 'icon' || el.type === 'text');
        const box = resizeBox(el, d.handle, dx, dy, { keepAspect, min: el.type === 'line' ? 4 : 8 });
        if (el.type === 'text') {
          if (corner) {
            const k = box.w / el.w;
            ed.updateElements([el.id], (x) => ({ ...x, ...box, size: Math.max(4, Math.round(el.size * k * 10) / 10), letterSpacing: el.letterSpacing * k }) as DesignElement, false);
          } else ed.updateElements([el.id], (x) => ({ ...x, x: box.x, y: box.y, w: box.w }) as DesignElement, false);
          return;
        }
        if (el.type === 'line') {
          ed.updateElements([el.id], (x) => ({ ...x, x: box.x, y: box.y, w: box.w }) as DesignElement, false);
          return;
        }
        ed.updateElements([el.id], (x) => ({ ...x, ...box }) as DesignElement, false);
        return;
      }
      // Varios (o un grupo): escala pareja desde la esquina opuesta.
      const u = d.union;
      const ax = d.handle.sx < 0 ? u.x + u.w : u.x;
      const ay = d.handle.sy < 0 ? u.y + u.h : u.y;
      const kx = (u.w + d.handle.sx * dx) / u.w;
      const ky = (u.h + d.handle.sy * dy) / u.h;
      const k = Math.max(0.05, Math.abs(kx) > Math.abs(ky) ? kx : ky);
      const byId = new Map(d.startEls.filter((x) => !x.locked).map((x) => [x.id, x]));
      ed.updateElements(
        [...byId.keys()],
        (el) => {
          const s = byId.get(el.id)!;
          const next = { ...el, x: ax + (s.x - ax) * k, y: ay + (s.y - ay) * k, w: Math.max(1, s.w * k), h: Math.max(1, s.h * k) } as DesignElement;
          if (next.type === 'text' && s.type === 'text') {
            next.size = Math.max(4, s.size * k);
            next.letterSpacing = s.letterSpacing * k;
          }
          if (next.type === 'shape' && s.type === 'shape') next.radius = s.radius * k;
          return next;
        },
        false,
      );
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setGuides([]);
    if (!d) return;
    if (d.kind === 'marquee') {
      const pt = toPage(e.clientX, e.clientY);
      const box = { x: Math.min(d.start.x, pt.x), y: Math.min(d.start.y, pt.y), w: Math.abs(pt.x - d.start.x), h: Math.abs(pt.y - d.start.y) };
      setMarquee(null);
      if (box.w * viewRef.current.zoom > 4 || box.h * viewRef.current.zoom > 4) {
        const ids = page.elements.filter((x) => !x.hidden && intersects(bounds(x), box)).map((x) => x.id);
        ed.select(ids, d.additive);
      }
      return;
    }
    if (d.kind !== 'pan') ed.endGesture();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (readOnly || tool !== 'select') return;
    const hit = elementAt(e.target);
    if (!hit || hit.locked) return;
    if (hit.type === 'text') {
      ed.setSelected([hit.id]);
      setEditingTextId(hit.id);
    } else if (hit.type === 'image' && hit.src) {
      ed.setSelected([hit.id]);
      setCropId(hit.id);
    }
  };

  const onDrop = (e: ReactDragEvent) => {
    e.preventDefault();
    if (readOnly) return;
    const pt = toPage(e.clientX, e.clientY);
    const target = elementAt(e.target);
    const frameId = target && target.type === 'image' ? target.id : null;
    const ref = e.dataTransfer.getData('application/x-zs-design-file');
    if (ref) {
      try {
        onDropFileRef(JSON.parse(ref), pt, frameId);
      } catch {
        /* nada que soltar */
      }
      return;
    }
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (files.length) onDropFiles(files, pt, frameId);
  };

  const sel = page.elements.filter((x) => selectedSet.has(x.id));
  const z = view.zoom;
  const hs = 9 / z;
  const editing = editingTextId ? (page.elements.find((x) => x.id === editingTextId) as TextEl | undefined) : undefined;
  const cropEl = cropId ? (page.elements.find((x) => x.id === cropId) as ImageEl | undefined) : undefined;
  const hover = hoverId ? page.elements.find((x) => x.id === hoverId) : undefined;
  const singleBox = sel.length === 1 ? sel[0] : null;
  const union = sel.length > 1 ? unionBounds(sel.map(bounds)) : null;
  const outline = (el: DesignElement) => corners(el).map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <div
      ref={viewportRef}
      className={`dz-stage${tool === 'comment' ? ' is-comment' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      data-testid="design-stage"
      aria-label={stageLabel}
      role="application"
      tabIndex={0}
    >
      <div className="dz-stage-inner" style={{ transform: `translate(${view.panX}px, ${view.panY}px)` }}>
        <PageSvg
          svgRef={svgRef}
          doc={doc}
          page={page}
          displayWidth={doc.width * z}
          hiddenIds={editing ? new Set([editing.id]) : undefined}
          placeholderLabel={placeholderLabel}
          className="dz-page"
          data-testid="design-page"
        >
          {cropEl && cropEl.src && (
            <g transform={`translate(${cropEl.x} ${cropEl.y})${cropEl.rotation ? ` rotate(${cropEl.rotation} ${cropEl.w / 2} ${cropEl.h / 2})` : ''}`} pointerEvents="none">
              <g transform={cropEl.flipX || cropEl.flipY ? `translate(${cropEl.flipX ? cropEl.w : 0} ${cropEl.flipY ? cropEl.h : 0}) scale(${cropEl.flipX ? -1 : 1} ${cropEl.flipY ? -1 : 1})` : undefined}>
                {(() => {
                  const p = imagePlacement(cropEl);
                  return (
                    <>
                      <image href={fileHref(cropEl.src)} x={p.x} y={p.y} width={p.w} height={p.h} opacity={0.35} preserveAspectRatio="none" />
                      <rect x={p.x} y={p.y} width={p.w} height={p.h} fill="none" stroke={ACCENT} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
                    </>
                  );
                })()}
              </g>
            </g>
          )}
          {hover && !drag.current && <polygon points={outline(hover)} fill="none" stroke={ACCENT} strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
          {sel.map((el) => (
            <polygon key={el.id} points={outline(el)} fill="none" stroke={ACCENT} strokeWidth={sel.length > 1 ? 1 : 1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          ))}
          {union && <rect x={union.x} y={union.y} width={union.w} height={union.h} fill="none" stroke={ACCENT} strokeDasharray="4 3" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
          {!readOnly && !editing && !cropEl && sel.length > 0 && !sel.every((x) => x.locked) && (
            <SelectionHandles els={sel} single={singleBox} union={union} hs={hs} z={z} />
          )}
          {guides.map((g, i) =>
            g.axis === 'x' ? (
              <line key={i} x1={g.pos} x2={g.pos} y1={-20 / z} y2={doc.height + 20 / z} stroke={GUIDE} strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            ) : (
              <line key={i} y1={g.pos} y2={g.pos} x1={-20 / z} x2={doc.width + 20 / z} stroke={GUIDE} strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            ),
          )}
          {marquee && <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} fill="rgba(0,165,200,0.08)" stroke={ACCENT} strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
          {pins.map((p) => (
            <g
              key={p.id}
              data-pin={p.id}
              transform={`translate(${p.x} ${p.y}) scale(${1 / z})`}
              className={`dz-pin${p.active ? ' is-active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onPin(p.id);
              }}
              role="button"
              aria-label={`#${p.n}`}
            >
              <path d="M0 0 L0 -14 A14 14 0 1 1 14 0 Z" />
              <text x={7} y={-7} textAnchor="middle" dominantBaseline="central">
                {p.n}
              </text>
            </g>
          ))}
        </PageSvg>
        {editing && <TextEditor el={editing} zoom={z} ed={ed} onDone={() => setEditingTextId(null)} />}
      </div>
    </div>
  );
}

function SelectionHandles({ els, single, union, hs, z }: { els: DesignElement[]; single: DesignElement | null; union: Box | null; hs: number; z: number }) {
  const box = single ?? union;
  if (!box) return null;
  const rotation = single?.rotation ?? 0;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const handles = handlesFor(els);
  return (
    <g transform={rotation ? `rotate(${rotation} ${cx} ${cy})` : undefined}>
      {handles.map((h) => {
        const x = box.x + ((h.sx + 1) / 2) * box.w;
        const y = box.y + ((h.sy + 1) / 2) * box.h;
        const side = h.sx === 0 || h.sy === 0;
        const w = side && h.sy === 0 ? hs * 0.7 : side ? hs * 1.6 : hs;
        const hh = side && h.sx === 0 ? hs * 0.7 : side ? hs * 1.6 : hs;
        return (
          <rect
            key={`${h.sx},${h.sy}`}
            data-handle={`${h.sx},${h.sy}`}
            x={x - w / 2}
            y={y - hh / 2}
            width={w}
            height={hh}
            fill="#ffffff"
            stroke={ACCENT}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: cursorFor(h, rotation) } as CSSProperties}
          />
        );
      })}
      {single && single.type !== 'line' && (
        <g data-handle="rotate" style={{ cursor: 'grab' }}>
          <line x1={cx} x2={cx} y1={box.y} y2={box.y - 22 / z} stroke={ACCENT} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <circle cx={cx} cy={box.y - 26 / z} r={6 / z} fill="#ffffff" stroke={ACCENT} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        </g>
      )}
      {single && single.type === 'line' && (
        <g data-handle="rotate" style={{ cursor: 'grab' }}>
          <circle cx={cx} cy={box.y - 18 / z} r={6 / z} fill="#ffffff" stroke={ACCENT} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        </g>
      )}
    </g>
  );
}

/** Edición de un texto en el lienzo: un textarea encima, con la misma letra. */
function TextEditor({ el, zoom, ed, onDone }: { el: TextEl; zoom: number; ed: Editor; onDone: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ed.beginGesture();
    const t = ref.current;
    if (t) {
      t.focus();
      t.select();
    }
    return () => {
      // Un texto que quedó vacío se borra.
      const cur = ed.docRef.current.pages[ed.pageRef.current]?.elements.find((x) => x.id === el.id);
      if (cur && cur.type === 'text' && !cur.text.trim()) {
        ed.withPage((p) => ({ ...p, elements: p.elements.filter((x) => x.id !== el.id) }), false);
        ed.setSelected([]);
      }
      ed.endGesture();
    };
    // Solo al abrir y cerrar el editor de este elemento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el.id]);
  const style: CSSProperties = {
    left: el.x * zoom,
    top: el.y * zoom,
    width: el.w * zoom,
    minHeight: el.h * zoom,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    fontFamily: fontFamily(el.font),
    fontSize: el.size * zoom,
    fontWeight: el.weight,
    fontStyle: el.italic ? 'italic' : 'normal',
    textDecoration: el.underline ? 'underline' : 'none',
    textTransform: el.uppercase ? 'uppercase' : 'none',
    lineHeight: el.lineHeight,
    letterSpacing: el.letterSpacing * zoom,
    color: el.color,
    textAlign: el.align,
  };
  return (
    <textarea
      ref={ref}
      className="dz-text-editor"
      style={style}
      value={el.text}
      rows={Math.max(1, el.text.split('\n').length)}
      onChange={(e) => {
        const text = e.target.value;
        ed.updateElements([el.id], (x) => ({ ...x, text }) as DesignElement, false);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          onDone();
        }
      }}
      onBlur={onDone}
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="design-text-editor"
      aria-label="Text"
    />
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { OrgNode } from '@/lib/people';
import { Avatar } from './people-ui';

const W = 200;
const H = 64;
const GX = 24;
const GY = 56;

const GS = 12;
const INDENT = 28;
/** Desde estos reportes sin reportes propios, van en columna: un equipo grande no vuelve ilegible el resto. */
const STACK_MIN = 3;

interface Placed extends OrgNode {
  x: number;
  y: number;
  /** En columna bajo su manager. */
  stacked: boolean;
}

/**
 * Árbol ordenado: cada manager centrado sobre sus reportes, y los equipos de hojas
 * en columna para que el ancho no se dispare.
 */
export function layoutOrg(nodes: OrgNode[]): { placed: Placed[]; width: number; height: number } {
  const children = new Map<string | null, OrgNode[]>();
  for (const n of nodes) children.set(n.managerId, [...(children.get(n.managerId) ?? []), n]);
  for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  const seenSize = new Set<string>();
  type Size = { w: number; h: number; stack: boolean; kids: OrgNode[] };
  const sizes = new Map<string, Size>();
  const size = (n: OrgNode): Size => {
    const known = sizes.get(n.id);
    if (known) return known;
    seenSize.add(n.id);
    // Un ciclo no debería existir: si aparece, se corta acá.
    const kids = (children.get(n.id) ?? []).filter((k) => !seenSize.has(k.id));
    const inner = kids.map(size);
    let out: Size;
    if (!kids.length) out = { w: W, h: H, stack: false, kids };
    else if (kids.length >= STACK_MIN && inner.every((k) => !k.kids.length)) out = { w: W + INDENT, h: H + GS + kids.length * (H + GS) - GS, stack: true, kids };
    else out = { w: Math.max(W, inner.reduce((t, k) => t + k.w, 0) + GX * (kids.length - 1)), h: H + GY + Math.max(...inner.map((k) => k.h)), stack: false, kids };
    sizes.set(n.id, out);
    return out;
  };
  const placed: Placed[] = [];
  const place = (n: OrgNode, x: number, y: number, stacked: boolean): number => {
    const s = size(n);
    if (s.stack) {
      s.kids.forEach((k, i) => placed.push({ ...k, x: x + INDENT, y: y + H + GS + i * (H + GS), stacked: true }));
      placed.push({ ...n, x, y, stacked });
      return x;
    }
    if (!s.kids.length) {
      placed.push({ ...n, x, y, stacked });
      return x;
    }
    let cx = x;
    const xs: number[] = [];
    for (const k of s.kids) {
      const ks = size(k);
      const kx = place(k, cx, y + H + GY, false);
      xs.push(kx);
      cx += ks.w + GX;
    }
    const nx = (xs[0] + xs[xs.length - 1]) / 2;
    placed.push({ ...n, x: nx, y, stacked });
    return nx;
  };
  let cursor = 0;
  let maxH = 0;
  const roots = [...(children.get(null) ?? []), ...nodes.filter((n) => n.managerId && !nodes.some((m) => m.id === n.managerId))];
  for (const r of roots) {
    const s = size(r);
    place(r, cursor, 0, false);
    cursor += s.w + GX * 2;
    maxH = Math.max(maxH, s.h);
  }
  return { placed, width: Math.max(cursor - GX * 2, W), height: maxH || H };
}

/** La línea de un manager a su reporte. */
function linePath(m: Placed, n: Placed): string {
  if (n.stacked) return `M${m.x + 14} ${m.y + H} V${n.y + H / 2} H${n.x}`;
  const midY = m.y + H + GY / 2;
  return `M${m.x + W / 2} ${m.y + H} V${midY} H${n.x + W / 2} V${n.y}`;
}

const clampZoom = (z: number) => Math.max(0.1, Math.min(2.5, Math.round(z * 100) / 100));

export default function OrgChart({ nodes }: { nodes: OrgNode[] }) {
  const t = useTranslations('people');
  // Sin manager ni reportes no es parte del árbol: van aparte, para que abra en lo que importa.
  const { tree, loose } = useMemo(() => {
    const hasReports = new Set(nodes.map((n) => n.managerId).filter(Boolean));
    return { tree: nodes.filter((n) => n.managerId || hasReports.has(n.id)), loose: nodes.filter((n) => !n.managerId && !hasReports.has(n.id)) };
  }, [nodes]);
  const { placed, width, height } = useMemo(() => layoutOrg(tree), [tree]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 24, y: 24 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const view = useRef({ z: zoom, p: pan });
  view.current = { z: zoom, p: pan };
  const box = useRef<HTMLDivElement>(null);

  // "Ajustar": todo a la vista. Al abrir: legible, con la primera raíz centrada, y se recorre.
  const fit = useCallback((readable = false) => {
    const el = box.current;
    if (!el) return;
    const pad = 24;
    const phone = el.clientWidth < 640;
    const all = clampZoom(phone ? Math.min(1, (el.clientWidth - pad * 2) / width) : Math.min(1, (el.clientWidth - pad * 2) / width, (el.clientHeight - pad * 2) / height));
    const z = readable ? Math.max(all, phone ? 0.6 : 0.7) : all;
    setZoom(z);
    const root = placed.find((p) => !p.managerId);
    const fits = width * z <= el.clientWidth - pad * 2;
    const x = fits ? (el.clientWidth - width * z) / 2 : Math.min(pad, el.clientWidth / 2 - ((root?.x ?? 0) + W / 2) * z);
    setPan({ x, y: pad });
  }, [width, height, placed]);
  useEffect(() => fit(true), [fit]);

  // Zoom alrededor de un punto del recuadro: lo que está ahí se queda ahí.
  const zoomAt = useCallback((next: (z: number) => number, cx: number, cy: number) => {
    const { z, p } = view.current;
    const nz = clampZoom(next(z));
    setZoom(nz);
    setPan({ x: cx - ((cx - p.x) / z) * nz, y: cy - ((cy - p.y) / z) * nz });
  }, []);
  const zoomCenter = (delta: number) => {
    const el = box.current;
    if (el) zoomAt((z) => z + delta, el.clientWidth / 2, el.clientHeight / 2);
  };
  // Dos dedos: distancia y punto medio.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; x: number; y: number } | null>(null);
  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  // La rueda solo hace zoom con Ctrl o Cmd (y entonces no scrollea la página ni hace zoom del navegador).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt((z) => z - e.deltaY * 0.002, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [nodes.length, zoomAt]);

  const release = (e: RPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
    drag.current = null;
  };
  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      drag.current = null;
      pinch.current = spread();
      return;
    }
    if ((e.target as HTMLElement).closest('a')) return;
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const now = spread();
      const r = box.current?.getBoundingClientRect();
      const ratio = now.d / pinch.current.d;
      pinch.current = now;
      if (r) zoomAt((z) => z * ratio, now.x - r.left, now.y - r.top);
      return;
    }
    const d = drag.current;
    if (d) setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y });
  };

  const exportPng = () => {
    const scale = 2;
    const pad = 32;
    const canvas = document.createElement('canvas');
    canvas.width = (width + pad * 2) * scale;
    canvas.height = (height + pad * 2) * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width + pad * 2, height + pad * 2);
    ctx.translate(pad, pad);
    ctx.strokeStyle = '#8a8984';
    ctx.lineWidth = 1;
    for (const n of placed) {
      const m = n.managerId ? byId.get(n.managerId) : null;
      if (!m) continue;
      ctx.stroke(new Path2D(linePath(m, n)));
    }
    for (const n of placed) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#111111';
      ctx.fillRect(n.x, n.y, W, H);
      ctx.strokeRect(n.x + 0.5, n.y + 0.5, W - 1, H - 1);
      ctx.fillStyle = '#111111';
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.fillText(n.name.slice(0, 26), n.x + 12, n.y + 26, W - 24);
      ctx.fillStyle = '#55544f';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText([n.jobTitle, n.department].filter(Boolean).join(' · ').slice(0, 32), n.x + 12, n.y + 46, W - 24);
    }
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'org-chart.png';
    a.click();
  };

  return (
    <div className="app-page ui-page ppl-page">
      <PageHeader
        title={t('nav.org')}
        description={t('org.desc')}
        actions={
          tree.length ? (
            <button type="button" className="btn btn-secondary" onClick={exportPng}>
              {t('org.export')}
            </button>
          ) : undefined
        }
      />
      {nodes.length === 0 ? (
        <EmptyState product="people" title={t('org.emptyTitle')} body={t('org.emptyBody')} />
      ) : (
        <>
          {tree.length > 0 && (
            <>
          <div className="ppl-org-tools" role="group" aria-label={t('org.zoom')}>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => zoomCenter(-0.1)} aria-label={t('org.zoomOut')}>
              −
            </button>
            <span className="ppl-muted" aria-live="polite">
              {Math.round(zoom * 100)}%
            </span>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => zoomCenter(0.1)} aria-label={t('org.zoomIn')}>
              +
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => fit()}>
              {t('org.fit')}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setZoom(1);
                setPan({ x: 24, y: 24 });
              }}
            >
              {t('org.reset')}
            </button>
          </div>
          <div
            ref={box}
            className="ppl-org"
            data-testid="people-org"
            style={{ '--org-h': `${Math.round(height * zoom) + 48}px` } as CSSProperties}
            tabIndex={0}
            role="application"
            aria-label={t('org.canvas')}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={release}
            onPointerCancel={release}
            onKeyDown={(e) => {
              const step = 40;
              if (e.key === '0') fit();
              else if (e.key === '+' || e.key === '=') setZoom((z) => clampZoom(z + 0.1));
              else if (e.key === '-') setZoom((z) => clampZoom(z - 0.1));
              else if (e.key === 'ArrowLeft') setPan((p) => ({ ...p, x: p.x + step }));
              else if (e.key === 'ArrowRight') setPan((p) => ({ ...p, x: p.x - step }));
              else if (e.key === 'ArrowUp') setPan((p) => ({ ...p, y: p.y + step }));
              else if (e.key === 'ArrowDown') setPan((p) => ({ ...p, y: p.y - step }));
              else return;
              e.preventDefault();
            }}
          >
            <div className="ppl-org-stage" style={{ width, height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
              <svg className="ppl-org-lines" width={width} height={height} aria-hidden="true">
                {placed.map((n) => {
                  const m = n.managerId ? byId.get(n.managerId) : null;
                  if (!m) return null;
                  return <path key={n.id} d={linePath(m, n)} />;
                })}
              </svg>
              {placed.map((n) => (
                <Link
                  key={n.id}
                  href={`/app/people/${n.id}`}
                  className="ppl-org-node"
                  data-manager={n.managerId ?? ''}
                  data-name={n.name}
                  style={{ left: n.x, top: n.y, width: W, height: H }}
                >
                  <Avatar name={n.name} photo={n.photo} size={32} />
                  <span className="ppl-rowtext">
                    <span className="ppl-rowtitle ppl-ellipsis">{n.name}</span>
                    <span className="ppl-rowmeta ppl-ellipsis">{n.jobTitle || n.department}</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
          <p className="ppl-hint">{t('org.help')}</p>
            </>
          )}
          {tree.length === 0 && (
            <p className="ppl-note" data-testid="people-org-flat">
              <span>
                {nodes.length === 1 ? t('org.alone') : t('org.flat')} <Link href="/app/people">{t('org.openDirectory')}</Link>
              </span>
            </p>
          )}
          {loose.length > 0 && (
            <section className="ppl-org-loose" aria-labelledby="ppl-org-loose" data-testid="people-org-loose">
              <h2 id="ppl-org-loose" className="ppl-subtitle">
                {t('org.loose', { count: loose.length })}
              </h2>
              <ul className="ppl-org-loose-list">
                {loose.map((n) => (
                  <li key={n.id}>
                    <Link href={`/app/people/${n.id}`} data-name={n.name}>
                      <Avatar name={n.name} photo={n.photo} size={32} />
                      <span className="ppl-rowtext">
                        <span className="ppl-rowtitle ppl-ellipsis">{n.name}</span>
                        {(n.jobTitle || n.department) && <span className="ppl-rowmeta ppl-ellipsis">{n.jobTitle || n.department}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
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

interface Placed extends OrgNode {
  x: number;
  y: number;
}

/** Árbol ordenado: hojas una al lado de la otra, cada manager centrado sobre sus reportes. */
export function layoutOrg(nodes: OrgNode[]): { placed: Placed[]; width: number; height: number } {
  const children = new Map<string | null, OrgNode[]>();
  for (const n of nodes) {
    const k = n.managerId;
    children.set(k, [...(children.get(k) ?? []), n]);
  }
  for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  const placed: Placed[] = [];
  let cursor = 0;
  let depthMax = 0;
  const seen = new Set<string>();
  const place = (n: OrgNode, depth: number): number => {
    seen.add(n.id);
    depthMax = Math.max(depthMax, depth);
    const kids = (children.get(n.id) ?? []).filter((k) => !seen.has(k.id));
    let x: number;
    if (!kids.length) {
      x = cursor;
      cursor += W + GX;
    } else {
      const xs = kids.map((k) => place(k, depth + 1));
      x = (xs[0] + xs[xs.length - 1]) / 2;
    }
    placed.push({ ...n, x, y: depth * (H + GY) });
    return x;
  };
  for (const root of children.get(null) ?? []) place(root, 0);
  // Ciclos o huérfanos (no debería haber): al final, en una fila.
  for (const n of nodes) if (!seen.has(n.id)) place(n, 0);
  return { placed, width: Math.max(cursor - GX, W), height: (depthMax + 1) * (H + GY) - GY };
}

/** Alto máximo del recuadro en escritorio (el mismo que el tope de styles/people.css). */
const maxBoxHeight = () => Math.min(window.innerHeight * 0.7, 640);

const clampZoom = (z: number) => Math.max(0.2, Math.min(2.5, Math.round(z * 100) / 100));

export default function OrgChart({ nodes }: { nodes: OrgNode[] }) {
  const t = useTranslations('people');
  const { placed, width, height } = useMemo(() => layoutOrg(nodes), [nodes]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 24, y: 24 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const view = useRef({ z: zoom, p: pan });
  view.current = { z: zoom, p: pan };
  const box = useRef<HTMLDivElement>(null);

  // Ajustar a la pantalla: todo el organigrama visible y centrado (así abre).
  const fit = useCallback((readable = false) => {
    const el = box.current;
    if (!el) return;
    const pad = 24;
    const phone = el.clientWidth < 640;
    // En un teléfono la altura la da la página (el recuadro crece con el organigrama): cuenta solo el ancho.
    const all = clampZoom(phone ? Math.min(1, (el.clientWidth - pad * 2) / width) : Math.min(1, (el.clientWidth - pad * 2) / width, (maxBoxHeight() - pad * 2) / height));
    // Al abrir en un teléfono, nombres legibles aunque no entre todo: se recorre con el dedo.
    const z = readable && phone ? Math.max(all, 0.6) : all;
    setZoom(z);
    setPan({ x: Math.max(pad, (el.clientWidth - width * z) / 2), y: pad });
  }, [width, height]);
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
      const midY = m.y + H + GY / 2;
      ctx.beginPath();
      ctx.moveTo(m.x + W / 2, m.y + H);
      ctx.lineTo(m.x + W / 2, midY);
      ctx.lineTo(n.x + W / 2, midY);
      ctx.lineTo(n.x + W / 2, n.y);
      ctx.stroke();
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
          nodes.length ? (
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
            style={{ height: Math.round(height * zoom) + 48 }}
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
                  const midY = m.y + H + GY / 2;
                  return <path key={n.id} d={`M${m.x + W / 2} ${m.y + H} V${midY} H${n.x + W / 2} V${n.y}`} />;
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
          {!nodes.some((n) => n.managerId) && (
            <p className="ppl-note" data-testid="people-org-flat">
              {nodes.length === 1 ? t('org.alone') : t('org.flat')}{' '}
              <Link href="/app/people">{t('org.openDirectory')}</Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}

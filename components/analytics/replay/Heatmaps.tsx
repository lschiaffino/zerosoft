'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';
import { VIEWPORT_BUCKETS, type HeatPoint, type ViewportBucket } from '@/lib/analytics/heatmap-core';
import type { HeatmapPath, HeatmapResult } from '@/lib/analytics/heatmaps';
import RangeSelect from '../RangeSelect';
import { api, fmtNumber, fmtPercent } from '../client';

const RADIUS = 22;
/** Azul frío a rojo: la escala de densidad de un heatmap; va sobre la página de otro, no usa tokens del tema. */
const STOPS: Array<[number, [number, number, number]]> = [
  [0, [40, 80, 220]],
  [0.35, [30, 190, 170]],
  [0.6, [235, 215, 40]],
  [0.82, [245, 130, 30]],
  [1, [225, 30, 40]],
];

function paletteAt(v: number): [number, number, number] {
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i];
    const [p0, c0] = STOPS[i - 1];
    if (v <= p1) {
      const k = (v - p0) / (p1 - p0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

/** Dibuja la densidad: manchas en gris con alfa y después cada alfa se pasa a color. */
function draw(canvas: HTMLCanvasElement, points: HeatPoint[], maxCell: number, width: number, height: number) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !points.length) return;
  ctx.clearRect(0, 0, width, height);
  for (const p of points) {
    const x = p.x * width;
    const g = ctx.createRadialGradient(x, p.y, 0, x, p.y, RADIUS);
    const a = Math.max(0.12, Math.min(1, Math.sqrt(p.n / Math.max(1, maxCell))));
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - RADIUS, p.y - RADIUS, RADIUS * 2, RADIUS * 2);
  }
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const alpha = d[i + 3];
    if (!alpha) continue;
    const [r, g, b] = paletteAt(alpha / 255);
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = Math.min(210, alpha * 1.25 + 30);
  }
  ctx.putImageData(img, 0, 0);
}

/** Heatmap de una ruta: clics sobre la página real (si se deja enmarcar), elementos más clickeados y scroll. */
export default function Heatmaps({ projectId, initialPaths }: { projectId: string; initialPaths: HeatmapPath[] }) {
  const t = useTranslations('analyticsReplay.heatmaps');
  const locale = useLocale();
  const [range, setRange] = useState('-7d');
  const [paths, setPaths] = useState(initialPaths);
  const [path, setPath] = useState(initialPaths[0]?.path ?? '');
  const [bucket, setBucket] = useState<ViewportBucket>('desktop');
  const [result, setResult] = useState<HeatmapResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [framable, setFramable] = useState<boolean | null | 'checking'>('checking');
  const [showPage, setShowPage] = useState(true);
  const [boxWidth, setBoxWidth] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  // Al cambiar el rango cambian las rutas vistas.
  const firstRange = useRef(true);
  useEffect(() => {
    if (firstRange.current) {
      firstRange.current = false;
      return;
    }
    const ctl = new AbortController();
    api<{ paths: HeatmapPath[] }>(`/api/analytics/heatmaps?${new URLSearchParams({ project: projectId, range })}`, { signal: ctl.signal })
      .then((r) => {
        setPaths(r.paths);
        setPath((cur) => (r.paths.some((p) => p.path === cur) ? cur : (r.paths[0]?.path ?? '')));
      })
      .catch((err: unknown) => {
        if ((err as Error).name !== 'AbortError') setError(true);
      });
    return () => ctl.abort();
  }, [range, projectId]);

  useEffect(() => {
    if (!path) {
      setResult(null);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    const sp = new URLSearchParams({ project: projectId, range, path, viewport: bucket });
    api<{ result: HeatmapResult }>(`/api/analytics/heatmaps?${sp}`, { signal: ctl.signal })
      .then((r) => {
        setResult(r.result);
        setError(false);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError') return;
        setError(true);
        setLoading(false);
      });
    return () => ctl.abort();
  }, [path, range, bucket, projectId]);

  const frameUrl = result?.frameUrl ?? null;
  useEffect(() => {
    if (!frameUrl) {
      setFramable(null);
      return;
    }
    let gone = false;
    setFramable('checking');
    api<{ framable: boolean | null }>(`/api/analytics/heatmaps/frame?${new URLSearchParams({ project: projectId, url: frameUrl })}`)
      .then((r) => !gone && setFramable(r.framable))
      .catch(() => !gone && setFramable(null));
    return () => {
      gone = true;
    };
  }, [frameUrl, projectId]);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const o = new ResizeObserver(() => setBoxWidth(el.clientWidth));
    o.observe(el);
    setBoxWidth(el.clientWidth);
    return () => o.disconnect();
  }, [result === null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (result && canvas.current) draw(canvas.current, result.points, result.maxCell, result.width, result.docHeight);
  }, [result]);

  if (paths.length === 0 && range === '-7d' && !error) {
    return <EmptyState product="analytics" title={t('emptyTitle')} body={t('emptyBody')} />;
  }

  const scale = result && boxWidth ? Math.min(1, boxWidth / result.width) : 1;
  const frameRefused = framable === false;
  const frameShown = !!frameUrl && !frameRefused && showPage;

  return (
    <div className="an-persons" aria-busy={loading}>
      <div className="an-toolbar">
        <label className="an-replay-field">
          <span className="an-small an-muted">{t('page')}</span>
          <select className="select an-range an-replay-pathselect" value={path} onChange={(e) => setPath(e.target.value)} data-testid="an-heat-path">
            {paths.length === 0 && <option value="">{t('noPages')}</option>}
            {paths.map((p) => (
              <option key={p.path} value={p.path}>
                {p.path}
              </option>
            ))}
          </select>
        </label>
        <RangeSelect value={range} onChange={setRange} />
        <label className="an-replay-field">
          <span className="an-small an-muted">{t('viewport')}</span>
          <select className="select an-range" value={bucket} onChange={(e) => setBucket(e.target.value as ViewportBucket)} data-testid="an-heat-viewport">
            {VIEWPORT_BUCKETS.map((b) => (
              <option key={b} value={b}>
                {t(`bucket.${b}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="ui-check an-small">
          <input type="checkbox" checked={showPage} disabled={!frameUrl || frameRefused} onChange={(e) => setShowPage(e.target.checked)} /> {t('showPage')}
        </label>
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      )}
      {result && (
        <p className="an-small an-muted" role="status" data-testid="an-heat-summary">
          {t('summary', { clicks: fmtNumber(result.total, locale) })}
          {result.capped && ` ${t('capped')}`}
          {result.ignored > 0 && ` ${t('ignored', { n: result.ignored })}`}
          {frameUrl && (
            <>
              {' '}
              {t('showing')} <span className="an-mono an-replay-showurl">{frameUrl}</span>
            </>
          )}
        </p>
      )}
      {frameRefused && (
        <div className="an-callout" role="status" data-testid="an-heat-refused">
          <p>{t('frameRefused')}</p>
        </div>
      )}
      {!frameUrl && result && (
        <div className="an-callout" role="status">
          <p>{t('noFrame')}</p>
        </div>
      )}
      {framable === null && frameUrl && (
        <p className="an-small an-muted" role="status">
          {t('frameUnknown')}
        </p>
      )}
      {result && (
        <div className="an-heat-box" ref={box} data-testid="an-heat-box">
          <div className="an-heat-sizer" style={{ width: result.width * scale, height: result.docHeight * scale }}>
            <div className="an-heat-scaled" style={{ width: result.width, height: result.docHeight, transform: `scale(${scale})` }}>
              {frameShown && (
                // Página del cliente, sin acceso a esta: allow-scripts sin allow-same-origin, sin clics y sin mandar referrer.
                <iframe
                  key={frameUrl}
                  src={frameUrl ?? undefined}
                  title={t('frameTitle')}
                  sandbox="allow-scripts"
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  className="an-heat-frame"
                  tabIndex={-1}
                  data-testid="an-heat-frame"
                />
              )}
              <canvas ref={canvas} className="an-heat-canvas" role="img" aria-label={t('canvasLabel', { clicks: result.total })} data-testid="an-heat-canvas" />
            </div>
          </div>
        </div>
      )}
      {result && (
        <div className="an-person-grid an-heat-grid">
          <section className="an-panel" aria-labelledby="an-heat-el-h">
            <h2 id="an-heat-el-h" className="an-h3">
              {t('elements')}
            </h2>
            {result.elements.length === 0 ? (
              <p className="an-muted an-small">{t('noClicks')}</p>
            ) : (
              <div className="table-wrap table-stack">
                <table className="table table-compact an-table" data-testid="an-heat-elements">
                  <thead>
                    <tr>
                      <th scope="col">{t('tag')}</th>
                      <th scope="col">{t('text')}</th>
                      <th scope="col">{t('href')}</th>
                      <th scope="col">{t('count')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.elements.map((el) => (
                      <tr key={`${el.tag}|${el.text}|${el.href}`}>
                        <td className="an-mono">{el.tag}</td>
                        <td data-label={t('text')}>
                          <span className="an-replay-url">{el.text || <span className="an-muted">{t('noText')}</span>}</span>
                        </td>
                        <td className="an-muted" data-label={t('href')}>
                          <span className="an-replay-url">{el.href}</span>
                        </td>
                        <td data-label={t('count')}>{fmtNumber(el.count, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="an-panel" aria-labelledby="an-heat-scroll-h">
            <h2 id="an-heat-scroll-h" className="an-h3">
              {t('scroll')}
            </h2>
            {result.scroll.views === 0 ? (
              <p className="an-muted an-small">{t('noScroll')}</p>
            ) : (
              <>
                <p className="an-small an-muted">{t('scrollViews', { n: result.scroll.views })}</p>
                <ol className="an-heat-scroll" role="list" data-testid="an-heat-scroll">
                  {result.scroll.steps.map((s) => (
                    <li key={s.depth}>
                      <span className="an-small an-nowrap">{t('reached', { n: s.depth })}</span>
                      <span className="an-heat-bar" aria-hidden="true">
                        <span style={{ width: `${s.share * 100}%` }} />
                      </span>
                      <span className="an-small an-muted an-nowrap">{fmtPercent(s.share, locale)}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

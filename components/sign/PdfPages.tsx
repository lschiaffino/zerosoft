'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface PageSize {
  w: number;
  h: number;
}

/**
 * Páginas de un PDF dibujadas con pdf.js en canvas, sin capa de texto ni de
 * anotaciones y sin ejecutar nada del archivo (sin XFA ni scripting: pdf.js
 * solo ejecuta JavaScript del PDF en su visor con sandbox, que acá no se usa,
 * y desde la v5 no usa eval). Además el servidor ya sacó scripts y acciones.
 * Encima de cada página va `overlay(page, width, height)` para los campos.
 */
export default function PdfPages({
  src,
  pages,
  overlay,
  onPageClick,
  label,
}: {
  src: string;
  pages: PageSize[];
  overlay?: (page: number, width: number, height: number) => ReactNode;
  onPageClick?: (page: number, x: number, y: number) => void;
  label: string;
}) {
  const t = useTranslations('sign.viewer');
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(200, Math.min(900, Math.floor(el.clientWidth))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | null = null;
    setDoc(null);
    setError(false);
    (async () => {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      const res = await fetch(src, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const data = new Uint8Array(await res.arrayBuffer());
      const loading = pdfjs.getDocument({ data, enableXfa: false, disableAutoFetch: true, stopAtErrors: false });
      task = loading;
      const loaded = await loading.promise;
      if (!cancelled) setDoc(loaded);
    })().catch(() => {
      if (!cancelled) setError(true);
    });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [src]);

  return (
    <div ref={wrap} className="sg-pages" aria-label={label} aria-busy={!doc && !error}>
      {error && (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      )}
      {width > 0 &&
        // Páginas que no vinieron en `pages` (el certificado del PDF firmado) van en A4.
        (doc ? Array.from({ length: doc.numPages }, (_, i) => pages[i] ?? { w: 595.28, h: 841.89 }) : pages).map((p, i, all) => {
          const h = Math.round((width * p.h) / Math.max(1, p.w));
          return (
            <div key={i} className="sg-page" data-page={i + 1} style={{ width, height: h }}>
              <PdfCanvas doc={doc} index={i} width={width} height={h} />
              <div
                className="sg-page-overlay"
                onClick={(e) => {
                  if (!onPageClick || e.target !== e.currentTarget) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  onPageClick(i + 1, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
                }}
              >
                {overlay?.(i + 1, width, h)}
              </div>
              <span className="sg-page-num" aria-hidden>
                {i + 1} / {all.length}
              </span>
            </div>
          );
        })}
      {!doc && !error && <span className="sr-only">{t('loading')}</span>}
    </div>
  );
}

function PdfCanvas({ doc, index, width, height }: { doc: PDFDocumentProxy | null; index: number; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!doc || !ref.current) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    (async () => {
      const page = await doc.getPage(index + 1);
      if (cancelled || !ref.current) return;
      const base = page.getViewport({ scale: 1 });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (width / base.width) * ratio });
      const canvas = ref.current;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = page.render({ canvas, viewport, annotationMode: 0 } as unknown as Parameters<typeof page.render>[0]);
      await task.promise;
    })().catch(() => undefined);
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, index, width, height]);
  return <canvas ref={ref} className="sg-canvas" style={{ width, height }} aria-hidden />;
}

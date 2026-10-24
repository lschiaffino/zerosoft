'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

interface PdfPage {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
}
interface PdfDoc {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
}
declare global {
  interface Window {
    pdfjsLib?: {
      GlobalWorkerOptions: { workerSrc: string };
      getDocument: (src: string) => { promise: Promise<PdfDoc> };
    };
  }
}

function loadPdfJs(): Promise<NonNullable<Window['pdfjsLib']>> {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PDFJS;
    s.async = true;
    s.onload = () => (window.pdfjsLib ? resolve(window.pdfjsLib) : reject(new Error('pdfjs')));
    s.onerror = () => reject(new Error('pdfjs'));
    document.head.appendChild(s);
  });
}

/**
 * Visor público de un documento con seguimiento: dibuja el PDF con pdf.js,
 * cuenta los segundos con la pestaña visible en la página que más se ve y
 * manda pings cada 5 s (y uno al cerrar con sendBeacon). Si pdf.js no carga,
 * muestra el visor del navegador y cuenta solo el tiempo total.
 */
export default function DocViewer({ token, name }: { token: string; name: string }) {
  const t = useTranslations('crm.mediaPublic');
  const fileUrl = `/api/crm/d/${encodeURIComponent(token)}/file`;
  const trackUrl = `/api/crm/d/${encodeURIComponent(token)}/track`;
  const pagesRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'loading' | 'pdf' | 'fallback' | 'error'>('loading');
  const [pageCount, setPageCount] = useState(0);
  const [current, setCurrent] = useState(1);
  const state = useRef({ viewId: '', seconds: 0, pages: {} as Record<string, number>, pageCount: 0, current: 1 });
  const tRef = useRef(t);
  tRef.current = t;

  // Vista + pings.
  useEffect(() => {
    let stopped = false;
    const send = (beacon = false) => {
      const s = state.current;
      if (!s.viewId) return;
      const body = JSON.stringify({ viewId: s.viewId, seconds: s.seconds, pages: s.pages, pageCount: s.pageCount });
      if (beacon && navigator.sendBeacon) navigator.sendBeacon(trackUrl, new Blob([body], { type: 'application/json' }));
      else void fetch(trackUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
    };
    void fetch(trackUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { viewId?: string } | null) => {
        if (!stopped && d?.viewId) state.current.viewId = d.viewId;
      })
      .catch(() => undefined);
    const tick = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || !state.current.viewId) return;
      const s = state.current;
      s.seconds += 1;
      if (s.pageCount) s.pages[String(s.current)] = (s.pages[String(s.current)] ?? 0) + 1;
    }, 1000);
    const ping = window.setInterval(() => send(), 5000);
    const onHide = () => {
      if (document.visibilityState === 'hidden') send(true);
    };
    const onPageHide = () => send(true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      stopped = true;
      window.clearInterval(tick);
      window.clearInterval(ping);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      send(true);
    };
  }, [trackUrl]);

  // PDF.
  useEffect(() => {
    let cancelled = false;
    const observers: IntersectionObserver[] = [];
    const host0 = pagesRef.current;
    (async () => {
      let lib: NonNullable<Window['pdfjsLib']>;
      try {
        lib = await loadPdfJs();
      } catch {
        if (!cancelled) setMode('fallback');
        return;
      }
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      let pdf: PdfDoc;
      try {
        pdf = await lib.getDocument(fileUrl).promise;
      } catch {
        if (!cancelled) setMode('error');
        return;
      }
      if (cancelled) return;
      setPageCount(pdf.numPages);
      state.current.pageCount = pdf.numPages;
      setMode('pdf');
      const host = pagesRef.current;
      if (!host) return;
      const ratios = new Map<number, number>();
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) ratios.set(Number((e.target as HTMLElement).dataset.page), e.intersectionRatio);
          let best = state.current.current;
          let bestRatio = -1;
          for (const [p, r] of ratios) {
            if (r > bestRatio) {
              best = p;
              bestRatio = r;
            }
          }
          state.current.current = best;
          setCurrent(best);
        },
        { threshold: [0, 0.25, 0.5, 0.75, 1] },
      );
      observers.push(io);
      const width = Math.min(host.clientWidth || 800, 1000);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      for (let n = 1; n <= pdf.numPages && !cancelled; n++) {
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width / base.width) * ratio });
        const wrap = document.createElement('div');
        wrap.className = 'dv-page';
        wrap.dataset.page = String(n);
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = '100%';
        canvas.setAttribute('aria-label', tRef.current('pageLabel', { page: n, total: pdf.numPages }));
        canvas.setAttribute('role', 'img');
        wrap.appendChild(canvas);
        host.appendChild(wrap);
        io.observe(wrap);
        const ctx = canvas.getContext('2d');
        if (ctx) await page.render({ canvasContext: ctx, viewport }).promise.catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
      observers.forEach((o) => o.disconnect());
      if (host0) host0.innerHTML = '';
    };
  }, [fileUrl]);

  return (
    <div className="dv">
      <header className="dv-bar">
        <h1 className="dv-title">{name}</h1>
        {mode === 'pdf' && pageCount > 0 && (
          <span className="dv-count" data-testid="doc-page-count">
            {t('pageOf', { page: current, total: pageCount })}
          </span>
        )}
        <a className="dv-btn" href={fileUrl} download>
          {t('download')}
        </a>
      </header>
      {mode === 'loading' && <p className="dv-note">{t('loading')}</p>}
      {mode === 'error' && <p className="dv-note">{t('error')}</p>}
      {mode === 'fallback' && <iframe className="dv-frame" src={fileUrl} title={name} />}
      <div ref={pagesRef} className="dv-pages" data-testid="doc-pages" />
    </div>
  );
}

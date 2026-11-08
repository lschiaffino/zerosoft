'use client';

import { useEffect, useRef, useState } from 'react';

/** Primeras páginas ya dibujadas (por URL), para no bajar el PDF de nuevo al volver al chat. */
const cache = new Map<string, { src: string; pages: number } | null>();

/** Tope para dibujar la vista previa: un PDF más grande queda solo con el ícono. */
export const PDF_THUMB_MAX_BYTES = 6 * 1024 * 1024;

/**
 * La primera página de un PDF como imagen arriba de la tarjeta (como WhatsApp).
 * Se dibuja recién cuando la tarjeta entra en pantalla, con el mismo pdf.js
 * que usa Send. Si falla, no se muestra nada.
 */
export default function PdfThumb({ url, onPages }: { url: string; onPages?: (n: number) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [thumb, setThumb] = useState(() => cache.get(url) ?? null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || thumb || cache.has(url)) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [url, thumb]);

  useEffect(() => {
    if (!visible || cache.has(url)) return;
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | null = null;
    (async () => {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(String(res.status));
      const size = Number(res.headers.get('content-length') ?? 0);
      if (size > PDF_THUMB_MAX_BYTES) throw new Error('too_big');
      const data = new Uint8Array(await res.arrayBuffer());
      if (data.byteLength > PDF_THUMB_MAX_BYTES) throw new Error('too_big');
      const loading = pdfjs.getDocument({ data, enableXfa: false, disableAutoFetch: true, stopAtErrors: false });
      task = loading;
      const doc = await loading.promise;
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const scale = 640 / Math.max(1, base.width);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      // Como WhatsApp: solo la parte de arriba de la página.
      canvas.height = Math.round(Math.min(viewport.height, viewport.width * 0.5));
      await page.render({ canvas, viewport, annotationMode: 0, background: '#fff' } as unknown as Parameters<typeof page.render>[0]).promise;
      const out = { src: canvas.toDataURL('image/jpeg', 0.8), pages: doc.numPages };
      cache.set(url, out);
      if (!cancelled) setThumb(out);
    })().catch(() => {
      // Cancelado al salir del chat: se reintenta la próxima vez; si falló de verdad, no.
      if (!cancelled) cache.set(url, null);
    });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [visible, url]);

  useEffect(() => {
    if (thumb?.pages) onPages?.(thumb.pages);
  }, [thumb, onPages]);

  return (
    <span ref={ref} className={`wa-doc-thumb${thumb ? ' is-on' : ''}`} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {thumb && <img src={thumb.src} alt="" />}
    </span>
  );
}

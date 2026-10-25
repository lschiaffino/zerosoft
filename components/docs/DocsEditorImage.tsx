'use client';

import { useEffect, useState } from 'react';

/**
 * Vista previa local de lo recién subido (storage URL → blob: del archivo del
 * navegador). Hasta que la página se guarda, la ruta con permisos todavía no
 * conoce el bloque; con esto la imagen se ve en el momento.
 */
const previews = new Map<string, string>();

export function rememberUploadPreview(storageUrl: string, file: Blob): void {
  if (typeof URL === 'undefined' || !URL.createObjectURL) return;
  if (!previews.has(storageUrl)) previews.set(storageUrl, URL.createObjectURL(file));
}

/** blob: local de lo recién subido (video, audio, PDF), si lo hay. */
export function uploadPreview(storageUrl: string | undefined): string | undefined {
  return storageUrl ? previews.get(storageUrl) : undefined;
}

const RETRIES = 3;

/**
 * Imagen de un bloque en el editor. Sale de la ruta con permisos
 * (/api/docs/files o la de Notes), nunca de la URL del storage: en un
 * servidor propio sin Blob, `next start` no sirve lo subido a public/uploads
 * después del build. Si el bloque se pegó o se movió y la página todavía no
 * se guardó, la ruta responde 404 un momento: se reintenta.
 */
export default function DocsEditorImage({ storageUrl, href, alt }: { storageUrl: string; href: string; alt: string }) {
  const local = previews.get(storageUrl);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setAttempt(0);
    setFailed(false);
  }, [href]);
  const src = local ?? (attempt === 0 ? href : `${href}${href.includes('?') ? '&' : '?'}retry=${attempt}`);
  return (
    // URL de nuestro origen con permisos: next/image no suma nada acá.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="docs-image"
      src={src}
      alt={alt}
      draggable={false}
      data-failed={failed || undefined}
      onError={() => {
        if (local || attempt >= RETRIES) {
          setFailed(true);
          return;
        }
        window.setTimeout(() => setAttempt((n) => n + 1), 1200 * (attempt + 1));
      }}
    />
  );
}

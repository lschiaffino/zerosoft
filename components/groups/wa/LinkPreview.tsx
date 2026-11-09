'use client';

import { useEffect, useState } from 'react';

export interface LinkPreviewData {
  url: string;
  title: string;
  description?: string;
  site?: string;
  /** Imagen (data URL o la miniatura que mandó WhatsApp). */
  image?: string;
}

/** Caché del navegador por URL (una sola vez por sesión de página). */
const cache = new Map<string, Promise<LinkPreviewData | null>>();

function fetchPreview(url: string): Promise<LinkPreviewData | null> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(`/api/wa/link-preview?url=${encodeURIComponent(url)}`)
      .then(async (r) => (r.ok ? ((await r.json()) as { preview: LinkPreviewData }).preview : null))
      .catch(() => null);
    cache.set(url, p);
  }
  return p;
}

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Tarjeta de un link como la de WhatsApp: imagen, título, descripción y
 * dominio. Usa la vista previa que vino con el mensaje; si no hay, la pide
 * al servidor (que lee la página, no el navegador). Sin título, no se ve.
 */
export default function LinkPreview({ url, given }: { url: string; given?: LinkPreviewData | null }) {
  const [data, setData] = useState<LinkPreviewData | null>(given ?? null);
  useEffect(() => {
    if (given) {
      setData(given);
      return;
    }
    let alive = true;
    setData(null);
    void fetchPreview(url).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [url, given]);
  if (!data?.title) return null;
  return (
    <a className="wa-linkcard" href={data.url || url} target="_blank" rel="noopener noreferrer nofollow">
      {data.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.image} alt="" loading="lazy" />
      )}
      <span className="wa-linkcard-text">
        <strong>{data.title}</strong>
        {data.description && <span>{data.description}</span>}
        <small>{data.site && data.site !== domain(url) ? `${data.site} · ${domain(url)}` : domain(url)}</small>
      </span>
    </a>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useChatDisplay } from '@/components/chat-style/ChatStyle';
import { linkImageRatio, linkLayout } from '@/lib/chat-display';
import { LinkIcon } from './icons';
import { domainOf, fetchPreview, fromGiven, needsFetch, pickPreview, safeHref, safeImage, type LinkPreviewData } from './link-preview-data';

export type { LinkPreviewData } from './link-preview-data';

/**
 * Tarjeta de un link como la de WhatsApp. Con una imagen grande: la imagen
 * arriba a todo el ancho (dos en grilla si la página trae dos), el título,
 * la descripción y un pie con el dominio y el ícono del sitio. Con un logo
 * o una imagen chica: la miniatura al costado. Sin imagen: solo el texto.
 * La persona elige grande, compacta o ninguna en Visualización.
 *
 * Usa la vista previa que vino con el mensaje; si no hay (o la de WhatsApp
 * es una miniatura chica y se pidió la grande), la pide al servidor, que lee
 * la página y sirve la imagen desde nuestro dominio. Sin título, no se ve.
 * Todo el texto va como texto (React lo escapa); el href es solo http(s).
 */
export default function LinkPreview({ url, given }: { url: string; given?: LinkPreviewData | null }) {
  const { linkPreviews } = useChatDisplay();
  const base = useMemo(() => fromGiven(given), [given]);
  const [fetched, setFetched] = useState<LinkPreviewData | null>(null);
  const [broken, setBroken] = useState<Record<string, true>>({});
  const wantFetch = needsFetch(base, linkPreviews);
  useEffect(() => {
    setFetched(null);
    if (!wantFetch || !url) return;
    let alive = true;
    void fetchPreview(url).then((d) => alive && setFetched(d));
    return () => {
      alive = false;
    };
  }, [url, wantFetch]);
  const data = pickPreview(base, fetched);
  if (!data?.title) return null;
  const href = safeHref(data.url) || safeHref(url);
  if (!href) return null;
  const ok = (src: string) => (src && !broken[src] ? src : '');
  const image = ok(safeImage(data.image));
  const image2 = ok(safeImage(data.image2));
  const favicon = ok(safeImage(data.favicon));
  const layout = linkLayout({ image, imageWidth: data.imageWidth, imageHeight: data.imageHeight }, linkPreviews);
  if (layout === 'none') return null;
  const host = domainOf(href);
  const site = data.site && data.site.toLowerCase() !== host ? data.site : '';
  // Una imagen que no carga se saca (la tarjeta pasa a compacta o a solo texto).
  const fail = (src: string) => () => setBroken((b) => ({ ...b, [src]: true }));
  return (
    <a className={`wa-linkcard is-${layout}`} href={href} target="_blank" rel="noopener noreferrer nofollow" data-layout={layout}>
      {layout === 'large' && (
        <span className={`wa-linkcard-media${image2 ? ' is-grid' : ''}`} style={image2 ? undefined : { aspectRatio: String(linkImageRatio(data.imageWidth, data.imageHeight)) }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="" loading="lazy" decoding="async" onError={fail(image)} />
          {image2 && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image2} alt="" loading="lazy" decoding="async" onError={fail(image2)} />
          )}
        </span>
      )}
      {layout === 'compact' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="wa-linkcard-thumb" src={image} alt="" loading="lazy" decoding="async" onError={fail(image)} />
      )}
      <span className="wa-linkcard-text">
        <strong dir="auto">{data.title}</strong>
        {data.description && (
          <span className="wa-linkcard-desc" dir="auto">
            {data.description}
          </span>
        )}
        {/* El pie: el ícono del sitio (o el de link si no tiene) y el dominio, como WhatsApp. */}
        <span className="wa-linkcard-foot">
          {favicon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="wa-linkcard-fav" src={favicon} alt="" width={14} height={14} onError={fail(favicon)} />
          ) : (
            <LinkIcon size={12} />
          )}
          <span className="wa-linkcard-domain">{site ? `${site} · ${host}` : host}</span>
        </span>
      </span>
    </a>
  );
}

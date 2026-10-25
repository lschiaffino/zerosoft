'use client';

import { useState, type CSSProperties } from 'react';
import type { DocsLinkPreview } from '@/lib/docs-types';
import { embedFor } from '@/lib/docs-embeds';
import '@/styles/docs-blocks-shared.css';

/** Tarjeta de bookmark (también la usa la vista de lectura). */
export function BookmarkCard({ link }: { link: DocsLinkPreview }) {
  const [imgOk, setImgOk] = useState(true);
  const [iconOk, setIconOk] = useState(true);
  return (
    <a className="docs-bookmark" href={link.url} target="_blank" rel="noopener noreferrer" data-testid="docs-bookmark-card">
      <span className="docs-bookmark-text">
        <span className="docs-bookmark-title">{link.title || link.url}</span>
        {link.description && <span className="docs-bookmark-desc">{link.description}</span>}
        <span className="docs-bookmark-url">
          {link.favicon && iconOk && (
            // Ícono del sitio externo (URL validada en el servidor).
            // eslint-disable-next-line @next/next/no-img-element
            <img src={link.favicon} alt="" width={16} height={16} onError={() => setIconOk(false)} referrerPolicy="no-referrer" />
          )}
          <span>{link.url}</span>
        </span>
      </span>
      {link.image && imgOk && (
        <span className="docs-bookmark-image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={link.image} alt="" loading="lazy" onError={() => setImgOk(false)} referrerPolicy="no-referrer" />
        </span>
      )}
    </a>
  );
}

/** iframe de un embed (desde el link original; nunca desde algo guardado). */
export function EmbedFrame({ url, height, width }: { url: string; height?: number; width?: number }) {
  const info = embedFor(url);
  if (!info) return null;
  const style: CSSProperties = info.aspect && !height ? { aspectRatio: String(info.aspect) } : { height: height ?? info.height };
  return (
    <div className="docs-embed-frame" style={width ? { width: `${width}%` } : undefined}>
      <iframe
        src={info.src}
        srcDoc={info.srcdoc}
        title={info.label}
        sandbox={info.sandbox}
        allow={info.allow}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        style={style}
        allowFullScreen
      />
    </div>
  );
}


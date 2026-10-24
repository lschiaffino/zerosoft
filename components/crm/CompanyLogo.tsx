'use client';

import { useEffect, useRef, useState } from 'react';
import { companyInitials, companyLogoUrl } from '@/lib/crm-domain';

interface CompanyLogoProps {
  domain: string | null | undefined;
  name: string;
  size?: number;
}

/**
 * Logo de la empresa (favicon del sitio, cacheado en el server); sin dominio
 * o si el sitio no tiene, las iniciales. Decorativo: el nombre va al lado.
 */
export default function CompanyLogo({ domain, name, size = 20 }: CompanyLogoProps) {
  const src = companyLogoUrl(domain);
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  // Sin logo la API devuelve un PNG de 1×1 (o falla). Si eso pasó antes de
  // hidratar, onLoad/onError ya no llegan: al montar se mira el tamaño.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth <= 1) setFailed(true);
  }, [src]);
  const style = { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.42)) };
  if (!src || failed) {
    return (
      <span className="co-logo co-logo-initials" style={style} aria-hidden="true">
        {companyInitials(name)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- favicon servido por nuestra API, tamaño fijo
    <img
      ref={imgRef}
      className="co-logo"
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      style={style}
      onLoad={(e) => {
        if (e.currentTarget.naturalWidth <= 1) setFailed(true);
      }}
      onError={() => setFailed(true)}
    />
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { colorIndex, initials } from './format';
import { GroupIcon, Person } from './icons';

/**
 * Avatar redondo como en WhatsApp: la foto de perfil si la hay; si no (si no
 * carga o es un punto sin imagen), iniciales sobre un color apagado que sale
 * del nombre, o el ícono de grupo.
 */
export default function Avatar({
  name,
  kind,
  src,
  // Igual a --wa-avatar (styles/groups-wa.css): la columna de la fila en la lista.
  size = 44,
  seed,
}: {
  name: string;
  kind: 'dm' | 'group';
  src?: string;
  size?: number;
  /** Lo que fija el color (por defecto el nombre). */
  seed?: string;
}) {
  const [broken, setBroken] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  const text = initials(name);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  const tiny = (img: HTMLImageElement) => img.naturalWidth > 0 && img.naturalWidth < 8;
  useEffect(() => {
    setBroken(false);
    // Una foto en caché carga antes de que React escuche onLoad.
    const img = ref.current;
    if (img?.complete && (img.naturalWidth === 0 || tiny(img))) setBroken(true);
  }, [src]);
  if (src && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={ref}
        className="wa-avatar"
        src={src}
        alt=""
        width={size}
        height={size}
        style={style}
        loading="lazy"
        onError={() => setBroken(true)}
        onLoad={(e) => tiny(e.currentTarget) && setBroken(true)}
      />
    );
  }
  if (kind === 'group' || text === '#') {
    return (
      <span className={`wa-avatar is-empty${kind === 'group' ? ' is-group' : ''}`} style={style} aria-hidden="true">
        {kind === 'group' ? <GroupIcon size={Math.round(size * 0.5)} /> : <Person size={Math.round(size * 0.52)} />}
      </span>
    );
  }
  return (
    <span className={`wa-avatar wa-c${colorIndex(seed ?? name)}`} style={style} aria-hidden="true">
      {text}
    </span>
  );
}

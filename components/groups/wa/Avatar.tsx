'use client';

import { useState } from 'react';
import { colorIndex, initials } from './format';
import { GroupIcon, Person } from './icons';

/**
 * Avatar redondo como en WhatsApp: la foto de perfil si la hay; si no (o si
 * no carga), iniciales sobre un color estable, o el ícono de grupo.
 */
export default function Avatar({
  name,
  kind,
  src,
  size = 49,
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
  const text = initials(name);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  if (src && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="wa-avatar" src={src} alt="" width={size} height={size} style={style} loading="lazy" onError={() => setBroken(true)} />
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

'use client';

import DefaultLogo from './default/DefaultLogo';

/** `current` hereda el color del texto; `ink` y `white` fijan el tono. */
export type MarkTone = 'current' | 'ink' | 'white';

export interface LogoProps {
  /** `current` hereda el color del texto (chrome); `ink`/`white` lo fijan. */
  tone?: MarkTone;
  /** Alto en px de la marca. */
  height?: number;
  variant?: 'wordmark' | 'symbol';
  /** Nombre accesible; vacío lo vuelve decorativo. */
  title?: string;
  className?: string;
}

/**
 * El logo de zerosoft: el cero y "zerosoft.ai". Si algún día vuelve un tema
 * de marca con logo propio, este es el punto donde se despacha.
 */
export default function Logo(props: LogoProps) {
  return <DefaultLogo {...props} />;
}

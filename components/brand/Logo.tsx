'use client';

import type { MarkTone } from '@/lib/brand';
import { useBrand } from './BrandProvider';
import DefaultLogo from './default/DefaultLogo';
import SubteLogo from './subte/SubteLogo';

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
 * El logo de zerosoft según el tema de marca del request (BrandProvider).
 * Un tema nuevo suma acá su caso.
 */
export default function Logo(props: LogoProps) {
  const brand = useBrand();
  switch (brand) {
    case 'subte':
      return <SubteLogo {...props} title={props.title ?? 'zerosoft'} />;
    default:
      return <DefaultLogo {...props} />;
  }
}

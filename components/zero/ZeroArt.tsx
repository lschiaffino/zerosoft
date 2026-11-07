import type { CSSProperties } from 'react';
import { stillFrame } from '@/lib/zero-art/engine';
import type { FigureRef } from '@/lib/zero-art/catalog';
import { makeFigure } from '@/lib/zero-art/figures';
import ZeroArtClient from './ZeroArtClient';

/**
 * Una figura hecha de ceros. El primer cuadro sale del servidor como texto: se
 * ve sin JS y no mueve nada, porque la caja y la letra salen del CSS
 * (.zero-art). El movimiento se carga aparte, cuando la figura está por verse.
 * Toma el color del texto (currentColor). Decorativa: aria-hidden.
 */
export default function ZeroArt({ figure, className = '' }: { figure: FigureRef; className?: string }) {
  const f = makeFigure(figure);
  const style = { '--art-cols': f.cols, '--art-rows': f.rows } as CSSProperties;
  const cls = `zero-art ${f.draggable ? 'is-draggable' : ''} ${f.fluid ? 'is-fluid' : ''} ${className}`.replace(/\s+/g, ' ').trim();
  return (
    <ZeroArtClient figure={figure} className={cls} style={style}>
      <pre>{stillFrame(f)}</pre>
    </ZeroArtClient>
  );
}

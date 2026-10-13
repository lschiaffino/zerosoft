import type { ReactNode } from 'react';

/**
 * Marco de la vista de producto: un borde fino y la URL en mono arriba.
 * Sin botones de ventana ni sombras.
 */
export default function BrowserFrame({ url, children }: { url: string; children: ReactNode }) {
  return (
    <div className="bframe">
      <div className="bframe-bar">
        <span className="bframe-url">{url}</span>
      </div>
      <div className="bframe-body">{children}</div>
    </div>
  );
}

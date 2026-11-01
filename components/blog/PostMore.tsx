'use client';

import { useRef, type ReactNode } from 'react';

/**
 * "Ver más" del blog: un <details> (funciona sin JS). Al abrirse, el botón
 * desaparece, así que el foco pasa al primer post nuevo.
 */
export default function PostMore({ label, children }: { label: string; children: ReactNode }) {
  const body = useRef<HTMLDivElement>(null);
  return (
    <details
      className="blog-more"
      onToggle={(e) => {
        if (e.currentTarget.open) body.current?.querySelector<HTMLElement>('a.blog-card')?.focus();
      }}
    >
      <summary className="btn btn-outline">{label}</summary>
      <div className="blog-more-body" ref={body}>
        {children}
      </div>
    </details>
  );
}

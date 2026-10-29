'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DesignDoc } from '@/lib/design-model';
import PageSvg from './PageSvg';
import { G, Glyph } from './ui';

/** Presentar: las páginas a pantalla completa, con flechas, espacio y Esc. */
export default function Present({ doc, start, onClose, token }: { doc: DesignDoc; start: number; onClose: () => void; token?: string | null }) {
  const t = useTranslations('design.present');
  const [i, setI] = useState(start);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.focus();
    el?.requestFullscreen?.().catch(() => undefined);
    const measure = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    const onFs = () => {
      if (!document.fullscreenElement) onClose();
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('resize', measure);
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    };
  }, [onClose]);
  const n = doc.pages.length;
  const k = size.w && size.h ? Math.min((size.w - 48) / doc.width, (size.h - 96) / doc.height) : 0.1;
  return (
    <div
      ref={ref}
      className="dz-present"
      role="dialog"
      aria-modal="true"
      aria-label={t('label')}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
          e.preventDefault();
          setI((x) => Math.min(n - 1, x + 1));
        }
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') setI((x) => Math.max(0, x - 1));
      }}
      data-testid="design-present"
    >
      <PageSvg doc={doc} page={doc.pages[i]} displayWidth={Math.max(1, doc.width * k)} token={token} title={t('page', { n: i + 1, total: n })} />
      <div className="dz-present-bar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0} aria-label={t('prev')}>
          <Glyph d={G.back} />
        </button>
        <span className="data">
          {i + 1} / {n}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setI((x) => Math.min(n - 1, x + 1))} disabled={i === n - 1} aria-label={t('next')}>
          <span style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}>
            <Glyph d={G.back} />
          </span>
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          {t('exit')}
        </button>
      </div>
    </div>
  );
}

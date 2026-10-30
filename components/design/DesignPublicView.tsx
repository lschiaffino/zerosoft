'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DesignDoc } from '@/lib/design-model';
import PageSvg from './PageSvg';
import Present from './Present';
import { loadDocFonts } from './fonts';
import { resetTextLayout } from './textLayout';

/** Vista pública de un diseño: las páginas una debajo de la otra, a lo ancho disponible. */
export default function DesignPublicView({ name, doc, token }: { name: string; doc: DesignDoc; token: string }) {
  const t = useTranslations('design.public');
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [, setTick] = useState(0);
  const [presenting, setPresenting] = useState(false);
  useEffect(() => {
    const measure = () => setWidth(Math.min(doc.width, (ref.current?.clientWidth ?? 800) - 2));
    measure();
    window.addEventListener('resize', measure);
    void loadDocFonts(doc).then(() => {
      resetTextLayout();
      setTick((n) => n + 1);
    });
    return () => window.removeEventListener('resize', measure);
  }, [doc]);
  const close = useCallback(() => setPresenting(false), []);
  return (
    <main className="dz-public" data-testid="design-public">
      <header className="dz-public-head">
        <div>
          <h1 className="dz-public-title">{name}</h1>
          <p className="muted">
            {t('meta', { w: doc.width, h: doc.height, n: doc.pages.length })}
          </p>
        </div>
        {doc.pages.length > 1 && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPresenting(true)}>
            {t('present')}
          </button>
        )}
      </header>
      <div className="dz-public-pages" ref={ref}>
        {width > 0 &&
          doc.pages.map((p, i) => (
            <figure key={p.id} className="dz-public-page">
              <PageSvg doc={doc} page={p} displayWidth={width} token={token} title={t('page', { n: i + 1 })} />
            </figure>
          ))}
      </div>
      <footer className="dz-public-foot muted">{t('footer')}</footer>
      {presenting && <Present doc={doc} start={0} onClose={close} token={token} />}
    </main>
  );
}

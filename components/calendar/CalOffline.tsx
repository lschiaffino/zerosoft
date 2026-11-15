'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Cal sin conexión, en solo lectura. El service worker (public/sw.js) guarda
 * las vistas de Cal que la persona abrió y las sirve sin red; acá, mientras no
 * hay red, todo lo que edita queda deshabilitado (un <fieldset disabled> sin
 * caja alrededor de la página: botones, campos y selectores) y un aviso lo
 * explica. Los links siguen andando para moverse entre lo ya guardado.
 */
export default function CalOffline({ children }: { children: ReactNode }) {
  const t = useTranslations('calendar.offline');
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  return (
    <fieldset className="cal-offline-scope" disabled={offline} data-testid="cal-scope" data-readonly={offline ? 'true' : undefined}>
      {offline && (
        <div className="cal-offline-banner" role="status" data-testid="cal-offline-banner">
          <strong>{t('title')}</strong> <span>{t('body')}</span>
        </div>
      )}
      {children}
    </fieldset>
  );
}

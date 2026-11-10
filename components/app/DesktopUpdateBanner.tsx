'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { desktopBridge } from '@/lib/desktop-bridge';
import { desktopUpdateKind, type DesktopUpdateKind } from '@/lib/desktop-version';

const DISMISS_KEY = 'zs-desktop-update-dismissed';

/**
 * Dentro de la app de escritorio, si hay una versión más nueva publicada: un
 * aviso arriba de la página. Las versiones viejas (antes de la 0.3.1) no se
 * actualizan solas y su permiso de Accesibilidad puede no reconocerse: el
 * aviso lo dice y lleva a la descarga. Se puede cerrar (vuelve con la
 * siguiente versión).
 */
export default function DesktopUpdateBanner() {
  const t = useTranslations('settings.desktopUpdate');
  const [state, setState] = useState<{ kind: DesktopUpdateKind; latest: string; current: string } | null>(null);

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    let alive = true;
    fetch('/api/desktop/update/latest.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((feed: { version?: unknown } | null) => {
        if (!alive || !feed || typeof feed.version !== 'string') return;
        const latest = feed.version.replace(/^v/, '');
        const kind = desktopUpdateKind(bridge.version, latest);
        if (kind === 'none') return;
        try {
          if (window.localStorage.getItem(DISMISS_KEY) === latest) return;
        } catch {
          /* sin storage: se muestra */
        }
        setState({ kind, latest, current: bridge.version });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!state) return null;
  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, state.latest);
    } catch {
      /* nada que guardar */
    }
    setState(null);
  };
  return (
    <div className="zs-desk-update" role="status" data-testid="desktop-update-banner">
      <p>
        <strong>{t('title', { v: state.latest })}</strong> {t(state.kind === 'manual' ? 'manual' : 'auto', { current: state.current })}
      </p>
      <div className="zs-desk-update-actions">
        <Link className="btn btn-primary btn-sm" href="/download">
          {t('download')}
        </Link>
        <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss}>
          {t('dismiss')}
        </button>
      </div>
    </div>
  );
}

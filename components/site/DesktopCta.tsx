'use client';

import { useEffect, useState } from 'react';
import { detectDesktopOs, downloadHref, inDesktopShell, type DesktopOs, type DownloadPlacement } from '@/lib/desktop-os';

interface Props {
  from: DownloadPlacement;
  locale: string;
  labels: {
    /** Sin sistema detectado (antes de mirar, teléfono, Linux): lleva a /download. */
    generic: string;
    mac: string;
    win: string;
  };
  className?: string;
  testId?: string;
  /** En una pestaña nueva (el onboarding no se corta). */
  newTab?: boolean;
  /** Teléfono o sistema sin app: no mostrar nada en vez de llevar a /download. */
  hideWithoutApp?: boolean;
  /** Texto antes del link: se arma un párrafo (className va al párrafo, el link queda como link de texto). */
  lead?: string;
}

/**
 * Botón "Descargar la app" con el sistema de quien mira: en Mac o Windows
 * lleva al instalador, en el resto a /download (que dice qué hay y qué no).
 * Dentro de la app de escritorio no se muestra.
 */
export default function DesktopCta({ from, locale, labels, className = 'btn btn-secondary', testId, newTab, hideWithoutApp, lead }: Props) {
  const [os, setOs] = useState<DesktopOs | 'mobile' | 'other' | null>(null);
  const [shell, setShell] = useState(false);

  useEffect(() => {
    let alive = true;
    setShell(inDesktopShell());
    void detectDesktopOs().then((v) => {
      if (alive) setOs(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (shell) return null;
  const known = os === 'mac-arm' || os === 'mac-intel' || os === 'win' ? os : null;
  if (hideWithoutApp && !known) return null;
  const link = (
    <a
      className={lead ? undefined : className}
      href={downloadHref(from, { os: known, locale })}
      rel={newTab ? 'nofollow noopener' : 'nofollow'}
      target={newTab ? '_blank' : undefined}
      data-testid={testId}
      data-os={known ?? ''}
    >
      {known === 'win' ? labels.win : known ? labels.mac : labels.generic}
    </a>
  );
  return lead ? (
    <p className={className}>
      {lead} {link}
    </p>
  ) : (
    link
  );
}

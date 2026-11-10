'use client';

import { useEffect } from 'react';
import { desktopBridge } from '@/lib/desktop-bridge';
import { inDesktopApp } from '@/lib/desktop-detect';

/**
 * Dentro de la app de escritorio, avisa una vez que se abrió con esta cuenta:
 * así "Primeros pasos" y los emails saben que la persona ya la tiene. El layout
 * lo monta solo mientras el perfil no tiene desktopSeenAt; en el navegador no hace nada.
 */
export default function DesktopSeen() {
  useEffect(() => {
    if (!inDesktopApp()) return;
    try {
      if (sessionStorage.getItem('zs:desktop-seen') === '1') return;
      sessionStorage.setItem('zs:desktop-seen', '1');
    } catch {
      /* sin storage: se avisa igual (el servidor guarda la primera fecha) */
    }
    const bridge = desktopBridge();
    void fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'desktop', event: 'seen', platform: bridge?.platform, version: bridge?.version }),
    }).catch(() => {});
  }, []);
  return null;
}

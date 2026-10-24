'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { INSTALL_EVENT, getInstallPrompt, type InstallPromptEvent } from './installPrompt';

type Mode = 'loading' | 'installed' | 'prompt' | 'ios' | 'manual';

/**
 * "Instalar la app": con el aviso del navegador (Chrome, Edge, Android) un
 * botón; en iOS, los pasos de "Agregar a inicio"; ya instalada, se avisa.
 * ?install=1 (Cmd+K) la trae a la vista.
 */
export default function InstallAppPanel() {
  const t = useTranslations('crm');
  const [mode, setMode] = useState<Mode>('loading');
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    function refresh() {
      const p = getInstallPrompt();
      setPrompt(p);
      setMode(standalone ? 'installed' : p ? 'prompt' : ios ? 'ios' : 'manual');
    }
    refresh();
    function onInstalled() {
      setMode('installed');
    }
    window.addEventListener(INSTALL_EVENT, refresh);
    window.addEventListener('appinstalled', onInstalled);
    if (new URLSearchParams(location.search).get('install') === '1') {
      ref.current?.scrollIntoView({ block: 'center' });
      ref.current?.querySelector<HTMLElement>('button, a')?.focus();
    }
    return () => {
      window.removeEventListener(INSTALL_EVENT, refresh);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (!prompt || busy) return;
    setBusy(true);
    await prompt.prompt().catch(() => null);
    const choice = await prompt.userChoice.catch(() => null);
    setBusy(false);
    if (choice?.outcome === 'accepted') setMode('installed');
  }

  return (
    <section className="panel install-app" id="install-app" ref={ref} data-testid="install-app">
      <div className="panel-head">
        <p className="section-label">{t('mobile.installTitle')}</p>
      </div>
      <p className="muted">{t('mobile.installBody')}</p>
      {mode === 'installed' && <p className="install-app-state">{t('mobile.installed')}</p>}
      {mode === 'prompt' && (
        <div className="form-actions">
          <button type="button" className="btn btn-solid btn-small" onClick={install} disabled={busy}>
            {t('mobile.installCta')}
          </button>
        </div>
      )}
      {mode === 'ios' && (
        <ol className="install-app-steps">
          <li>{t('mobile.iosStep1')}</li>
          <li>{t('mobile.iosStep2')}</li>
          <li>{t('mobile.iosStep3')}</li>
        </ol>
      )}
      {mode === 'manual' && <p className="install-app-state">{t('mobile.installManual')}</p>}
    </section>
  );
}

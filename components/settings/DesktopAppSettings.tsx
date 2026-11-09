'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import { desktopBridge } from '@/lib/desktop-bridge';
import { desktopUpdateKind, type DesktopUpdateKind } from '@/lib/desktop-version';

/**
 * Ajustes › App de escritorio. Fuera de la app: para qué sirve y dónde se
 * baja. Dentro de la ventana principal de la app: la versión instalada, si
 * hay una más nueva y un botón que abre su ventana de Ajustes (⌘,).
 */
export default function DesktopAppSettings({ sections }: { sections: Array<{ key: string; label: string; help: string }> }) {
  const t = useTranslations('settings.desktopApp');
  const [app, setApp] = useState<{ version: string; openSettings: () => void } | null>(null);
  const [latest, setLatest] = useState<{ version: string; kind: DesktopUpdateKind } | null>(null);

  useEffect(() => {
    const b = desktopBridge();
    if (b) setApp({ version: b.version, openSettings: b.openSettings });
    fetch('/api/desktop/update/latest.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((feed: { version?: unknown } | null) => {
        if (feed && typeof feed.version === 'string') {
          const v = feed.version.replace(/^v/, '');
          setLatest({ version: v, kind: b ? desktopUpdateKind(b.version, v) : 'none' });
        }
      })
      .catch(() => undefined);
  }, []);

  return (
    <div className="st-stack" data-testid="desktop-app-settings">
      <FormSection title={t('title')} description={t('desc')}>
        <dl className="st-facts st-facts-row">
          <div>
            <dt>{t('installed')}</dt>
            <dd className="data">{app ? app.version : t('notHere')}</dd>
          </div>
          <div>
            <dt>{t('latest')}</dt>
            <dd className="data">{latest ? latest.version : '…'}</dd>
          </div>
        </dl>
        {app && latest && latest.kind !== 'none' && (
          <p className="st-callout">{t(latest.kind === 'manual' ? 'updateManual' : 'updateAuto', { v: latest.version })}</p>
        )}
        <div className="st-actions">
          {app ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => app.openSettings()}>
              {t('openSettings')}
            </button>
          ) : null}
          <a className={`btn btn-sm${app ? '' : ' btn-primary'}`} href="/download">
            {t('download')}
          </a>
        </div>
      </FormSection>
      <FormSection title={t('sectionsTitle')} description={t('sectionsDesc')}>
        <dl className="st-desktop-sections">
          {sections.map((s) => (
            <div key={s.key}>
              <dt className="st-strong">{s.label}</dt>
              <dd className="ui-help">{s.help}</dd>
            </div>
          ))}
        </dl>
      </FormSection>
    </div>
  );
}

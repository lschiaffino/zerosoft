import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

interface ExtensionPanelProps {
  /** Dirección de la app que se pega en las opciones de la extensión. */
  appUrl: string;
}

/**
 * Extensión de Chrome para Gmail (extensions/chrome): descarga del zip,
 * token personal e instalación paso a paso.
 */
export default function ExtensionPanel({ appUrl }: ExtensionPanelProps) {
  const t = useTranslations('crm.extension');
  return (
    <div className="crm-extension-panel" id="chrome-extension">
      <ul className="crm-extension-features">
        <li>{t('featureSidebar')}</li>
        <li>{t('featureLog')}</li>
        <li>{t('featureTrack')}</li>
      </ul>
      <div className="form-actions">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="btn btn-solid btn-small" href="/api/crm/extension/download" download>
          {t('download')}
        </a>
        <Link className="btn btn-ghost btn-small" href="/app/settings/workspace#api-keys">
          {t('createToken')}
        </Link>
      </div>
      <ol className="crm-extension-steps">
        <li>{t('step1')}</li>
        <li>
          {t('step2')} <code>chrome://extensions</code>
        </li>
        <li>{t('step3')}</li>
        <li>{t('step4')}</li>
        <li>
          {t('step5')} <code>{appUrl}</code>
        </li>
        <li>{t('step6')}</li>
      </ol>
      <p className="muted">{t('note')}</p>
    </div>
  );
}

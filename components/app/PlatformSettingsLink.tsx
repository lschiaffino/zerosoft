import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import SettingsSearch from './SettingsSearch';

/**
 * Cabecera de los ajustes de cada app: la búsqueda de Ajustes (encuentra
 * cualquier ajuste, de esta app o de otra) y "Ajustes de la plataforma", para
 * llegar a lo que comparte todo el workspace (miembros, API, uso de IA).
 */
export default async function PlatformSettingsLink({ locale, href = '/app/settings' }: { locale: string; href?: string }) {
  const t = await getTranslations({ locale, namespace: 'settings.products' });
  return (
    <>
      <SettingsSearch variant="header" />
      <Link href={href} className="btn btn-secondary btn-sm" data-testid="platform-settings-link">
        {t('platformLink')}
      </Link>
    </>
  );
}

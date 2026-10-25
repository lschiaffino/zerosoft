import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

/**
 * "Ajustes de la plataforma": va en la cabecera de los ajustes de cada app,
 * para llegar a lo que comparte todo el workspace (miembros, API, uso de IA).
 */
export default async function PlatformSettingsLink({ locale, href = '/app/settings' }: { locale: string; href?: string }) {
  const t = await getTranslations({ locale, namespace: 'settings.products' });
  return (
    <Link href={href} className="btn btn-secondary btn-sm" data-testid="platform-settings-link">
      {t('platformLink')}
    </Link>
  );
}

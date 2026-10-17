import { getTranslations } from 'next-intl/server';
import Icon from '@/components/app/icons';

/**
 * Cabecera del centro de ayuda público: el nombre del workspace como una
 * estación sobre su línea (el color del workspace) y, en los artículos, la
 * búsqueda. Es la marca del cliente: el logo de zerosoft no aparece acá.
 */
export default async function HelpHeader({
  locale,
  name,
  base,
  search = false,
}: {
  locale: string;
  name: string;
  base: string;
  search?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'docs.help' });
  return (
    <header className="help-head">
      <div className="help-head-inner">
        <a href={base} className="help-brand">
          <svg className="help-brand-glyph" viewBox="0 0 48 24" width="40" height="20" aria-hidden="true" focusable="false">
            <line x1="6" y1="12" x2="42" y2="12" stroke="var(--help-accent)" strokeWidth="8" strokeLinecap="round" />
            <circle cx="24" cy="12" r="8" fill="#ffffff" stroke="#111111" strokeWidth="3.6" />
          </svg>
          <span className="help-brand-name">{name}</span>
          <span className="help-brand-sub">{t('title')}</span>
        </a>
        {search && (
          <form action={base} method="get" className="help-search help-search-small" role="search">
            <span className="help-search-icon" aria-hidden="true">
              <Icon name="search" size={16} />
            </span>
            <input type="search" name="q" placeholder={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} className="input help-search-input" />
          </form>
        )}
      </div>
    </header>
  );
}

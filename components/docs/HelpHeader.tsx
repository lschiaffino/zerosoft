import { getTranslations } from 'next-intl/server';
import AccentGlyph from '@/components/brand/AccentGlyph';
import Icon from '@/components/app/icons';

/**
 * Cabecera del centro de ayuda público: el nombre del workspace con el cero
 * en su color y, en los artículos, la búsqueda. Es la marca del cliente: el logo de zerosoft no aparece acá.
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
          <AccentGlyph className="help-brand-glyph" color="var(--help-accent)" height={18} />
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

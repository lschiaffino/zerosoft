import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import BrandSymbol from '@/components/brand/BrandSymbol';
import { ZeroRule } from '@/components/zero/ZeroTexture';
import ZeroArt from '@/components/zero/ZeroArt';
import '@/styles/pages.css';

/**
 * 404 dentro de /[locale]: el cartel negro, el título de lectura y un solo botón.
 *
 * Sin generateMetadata: la metadata se resuelve antes que el layout fije el
 * idioma (setRequestLocale) y sin params next-intl lo buscaría en los headers,
 * lo que en una página estática (un /blog/tag/x que no existe) es un error 500.
 * El componente sí corre dentro del layout: el <title> va acá y React lo sube
 * al <head>.
 */
export default async function LocaleNotFound() {
  const t = await getTranslations('common.notFound');
  return (
    <main className="nf">
      <title>{`${t('meta')} · zerosoft`}</title>
      <div className="sign-band">
        <div className="container sign-inner">
          <BrandSymbol size={28} className="sign-mark" />
          <p className="sign-title">{t('sign')}</p>
        </div>
      </div>
      <div className="container">
        <ZeroArt figure={['notfound', '']} className="nf-art" />
        <header className="read-hero nf-hero">
          <h1 className="read-title">{t('title')}</h1>
          <p className="read-intro">{t('body')}</p>
          <div className="read-actions">
            <Link className="btn btn-primary btn-lg" href="/">
              {t('cta')}
            </Link>
          </div>
        </header>
        <ZeroRule className="nf-rule" />
      </div>
    </main>
  );
}

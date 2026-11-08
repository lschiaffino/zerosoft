import type { Metadata, ResolvingMetadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import BrandSymbol from '@/components/brand/BrandSymbol';
import { ZeroRule } from '@/components/zero/ZeroTexture';
import ZeroArt from '@/components/zero/ZeroArt';
import '@/styles/pages.css';

/**
 * El 404 no recibe params y la metadata se resuelve antes que el layout fije el
 * idioma: sin locale explícito next-intl lo buscaría en los headers, y en una
 * página estática (un /blog/tag/x que no existe) eso es un error 500. El idioma
 * sale de la metadata del layout padre (openGraph.locale, que arma con sus params).
 */
export async function generateMetadata(_props: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const og = (await parent).openGraph?.locale ?? '';
  const locale = og.startsWith('es') ? 'es' : og.startsWith('pt') ? 'pt' : 'en';
  const t = await getTranslations({ locale, namespace: 'common.notFound' });
  return { title: t('meta') };
}

/** 404 dentro de /[locale]: el cartel negro, el título de lectura y un solo botón. */
export default async function LocaleNotFound() {
  const t = await getTranslations('common.notFound');
  return (
    <main className="nf">
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

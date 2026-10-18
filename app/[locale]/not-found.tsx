import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import BrandSymbol from '@/components/brand/BrandSymbol';
import { ZeroRule } from '@/components/zero/ZeroTexture';
import '@/styles/pages.css';

export async function generateMetadata() {
  const t = await getTranslations('common.notFound');
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

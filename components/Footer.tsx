import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import LocaleSwitcher from './LocaleSwitcher';
import Icon from './site/Icon';
import { GITHUB_URL, PRODUCT_NAMES, SITE_PRODUCTS } from './site/catalog';

export default async function Footer({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'common.footer' });
  const tm = await getTranslations({ locale, namespace: 'common.meta' });

  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div className="footer-brand">
          <Link href="/" className="brand" aria-label="zerosoft.ai">
            <span className="brand-zero">0</span>
            <span className="brand-name">zerosoft.ai</span>
          </Link>
          <p>{tm('tagline')}</p>
          <p className="footer-tagline">{t('tagline')}</p>
          <a className="footer-gh" href={GITHUB_URL} target="_blank" rel="noreferrer">
            <Icon name="github" size={14} />
            {t('starCta')}
          </a>
        </div>

        <div className="footer-col">
          <h4>{t('colProducts')}</h4>
          <ul>
            {SITE_PRODUCTS.map((k) => (
              <li key={k}>
                <Link href={`/products/${k}`} className={`card-${k}`}>
                  <span className="footer-dot" aria-hidden="true" />
                  {PRODUCT_NAMES[k]}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/products">{t('allProducts')}</Link>
            </li>
          </ul>
        </div>

        <div className="footer-col">
          <h4>{t('colDevelopers')}</h4>
          <ul>
            <li><Link href="/docs">{t('apiDocs')}</Link></li>
            <li><Link href="/changelog">{t('changelog')}</Link></li>
            <li><Link href="/status">{t('status')}</Link></li>
            <li><a href={GITHUB_URL} target="_blank" rel="noreferrer">{t('github')}</a></li>
            <li>
              <a href={`${GITHUB_URL}#data-and-self-hosting`} target="_blank" rel="noreferrer">
                {t('selfHosting')}
              </a>
            </li>
          </ul>
        </div>

        <div className="footer-col">
          <h4>{t('colCompany')}</h4>
          <ul>
            <li><Link href="/#manifiesto">{t('manifesto')}</Link></li>
            <li><Link href="/blog">{t('blog')}</Link></li>
            <li><Link href="/videos">{t('videos')}</Link></li>
            <li><Link href="/feedback">{t('feedback')}</Link></li>
            <li><a href="mailto:hola@zerosoft.ai">{t('contact')}</a></li>
          </ul>
        </div>

        <div className="footer-col">
          <h4>{t('colLegal')}</h4>
          <ul>
            <li><Link href="/terms">{t('terms')}</Link></li>
            <li><Link href="/privacy">{t('privacy')}</Link></li>
            <li><Link href="/security">{t('security')}</Link></li>
          </ul>
        </div>
      </div>

      <div className="footer-bottom">
        <span>{t('copyright')}</span>
        <span className="footer-oss">
          <Icon name="code" size={14} />
          <a href={`${GITHUB_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
            {t('oss')}
          </a>
        </span>
        <LocaleSwitcher locale={locale} />
      </div>
    </footer>
  );
}

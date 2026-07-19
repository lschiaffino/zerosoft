import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import ZeroField from './ZeroField';

export default async function Footer({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'common.footer' });

  return (
    <footer className="site-footer">
      <div className="footer-zero-band" aria-hidden="true">
        <ZeroField align="center" sizeFactor={0.95} color="255,255,255" interactive={false} alpha={0.16} />
      </div>

      <div className="footer-grid">
        <div className="footer-brand">
          <Link href="/" className="brand" aria-label="zerosoft.ai">
            <span className="brand-zero">0</span>
            <span className="brand-name">zerosoft.ai</span>
          </Link>
          <p>{t('tagline')}</p>
        </div>

        <div className="footer-col">
          <h4>{t('colProduct')}</h4>
          <ul>
            <li><Link href="/products/link">Link</Link></li>
            <li><Link href="/products/track">Track</Link></li>
            <li><Link href="/products/crm">CRM</Link></li>
            <li><Link href="/products/cal">Cal</Link></li>
          </ul>
        </div>

        <div className="footer-col">
          <h4>{t('colResources')}</h4>
          <ul>
            <li><Link href="/blog">Blog</Link></li>
            <li><Link href="/docs">API Docs</Link></li>
            <li><Link href="/status">Status</Link></li>
          </ul>
        </div>

        <div className="footer-col">
          <h4>{t('colCompany')}</h4>
          <ul>
            <li><Link href="/#manifiesto">{t('manifesto')}</Link></li>
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
        <span>zerosoft.ai</span>
        <span className="footer-mid">{t('tagline')}</span>
        <span>{t('copyright')}</span>
      </div>
    </footer>
  );
}

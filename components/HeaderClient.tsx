'use client';

import { useState } from 'react';
import { signIn, signOut } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import LocaleSwitcher from './LocaleSwitcher';

interface HeaderClientProps {
  locale: string;
  user: { name: string | null; email: string; image: string | null } | null;
  labels: {
    products: string;
    blog: string;
    docs: string;
    signIn: string;
    dashboard: string;
    signOut: string;
  };
}

const PRODUCTS = [
  { key: 'link', num: '01', href: '/products/link' },
  { key: 'track', num: '02', href: '/products/track' },
  { key: 'crm', num: '03', href: '/products/crm' },
  { key: 'cal', num: '04', href: '/products/cal' },
] as const;

export default function HeaderClient({ locale, user, labels }: HeaderClientProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const tp = useTranslations('common.products');

  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="zerosoft.ai">
        <span className="brand-zero">0</span>
        <span className="brand-name">zerosoft.ai</span>
      </Link>

      <nav className="main-nav" aria-label="Principal">
        <LocaleSwitcher locale={locale} />

        <div
          className="nav-dropdown"
          onMouseEnter={() => setMenuOpen(true)}
          onMouseLeave={() => setMenuOpen(false)}
        >
          <Link className="nav-link" href="/products">
            <span className="nav-num">01</span>
            {labels.products}
          </Link>

          {menuOpen && (
            <div className="mega-menu">
              <div className="mega-menu-inner">
                {PRODUCTS.map((p) => (
                  <Link key={p.key} href={p.href} className="mega-item">
                    <span className="mega-num">{p.num}</span>
                    <span className="mega-name">
                      {p.key === 'crm' ? 'CRM' : p.key === 'cal' ? 'Cal' : p.key === 'link' ? 'Link' : 'Track'}
                    </span>
                    <span className="mega-tag">{tp(`${p.key}.tag`)}</span>
                    <span className="mega-status">{tp(`${p.key}.status`)}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        <Link className="nav-link" href="/blog">
          <span className="nav-num">02</span>
          {labels.blog}
        </Link>
        <Link className="nav-link" href="/docs">
          <span className="nav-num">03</span>
          {labels.docs}
        </Link>
        {user ? (
          <>
            <Link className="nav-cta nav-cta-solid" href="/app">
              {labels.dashboard}
            </Link>
            <button
              className="nav-cta"
              onClick={() => signOut({ callbackUrl: '/' })}
              title={user.email}
            >
              {labels.signOut}
            </button>
          </>
        ) : (
          <button className="nav-cta" onClick={() => signIn('google', { callbackUrl: `/${locale}/app` })}>
            {labels.signIn}
          </button>
        )}
      </nav>
    </header>
  );
}

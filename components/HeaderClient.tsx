'use client';

import { signIn, signOut } from 'next-auth/react';
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

export default function HeaderClient({ locale, user, labels }: HeaderClientProps) {
  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="zerosoft.ai">
        <span className="brand-zero">0</span>
        <span className="brand-name">zerosoft.ai</span>
      </Link>

      <nav className="main-nav" aria-label="Principal">
        <LocaleSwitcher locale={locale} />
        <Link className="nav-link" href="/products">
          <span className="nav-num">01</span>
          {labels.products}
        </Link>
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

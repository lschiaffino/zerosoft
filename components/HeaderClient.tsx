'use client';

import { useEffect, useRef, useState } from 'react';
import { signIn, signOut } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
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
  { key: 'chat', num: '05', href: '/products/chat' },
  { key: 'docs', num: '06', href: '/docs' },
] as const;

const PRODUCT_NAMES: Record<(typeof PRODUCTS)[number]['key'], string> = {
  link: 'Link',
  track: 'Track',
  crm: 'CRM',
  cal: 'Cal',
  chat: 'Chat',
  docs: 'Docs',
};

export default function HeaderClient({ locale, user, labels }: HeaderClientProps) {
  const [desktopOpen, setDesktopOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  /** Menú hamburguesa (≤860px): productos, blog, docs, idioma y salir. */
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const tp = useTranslations('common.products');

  const openDesktop = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setDesktopOpen(true);
  };

  const closeDesktop = () => {
    closeTimer.current = setTimeout(() => {
      setDesktopOpen(false);
    }, 350);
  };

  const toggleMobile = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    setMobileOpen((v) => !v);
  };

  // Esc closes whichever menu is open and returns focus to its trigger.
  const onDropdownKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || (!desktopOpen && !mobileOpen)) return;
    e.stopPropagation();
    const triggerSelector = mobileOpen
      ? '.nav-dropdown-trigger-mobile'
      : '.nav-dropdown-trigger-desktop';
    setDesktopOpen(false);
    setMobileOpen(false);
    const trigger = dropdownRef.current?.querySelector<HTMLElement>(triggerSelector);
    trigger?.focus();
  };

  // Keyboard mirror of onMouseLeave: close when focus leaves the dropdown.
  const onDropdownBlur = (e: React.FocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDesktopOpen(false);
    }
  };

  // Close menus when clicking outside the dropdown.
  useEffect(() => {
    if (!desktopOpen && !mobileOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.nav-dropdown')) {
        setDesktopOpen(false);
        setMobileOpen(false);
      }
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [desktopOpen, mobileOpen]);

  const megaItems = (
    <>
      {PRODUCTS.map((p) => (
        <Link key={p.key} href={p.href} className="mega-item">
          <span className="mega-num">{p.num}</span>
          <span className="mega-name">{PRODUCT_NAMES[p.key]}</span>
          <span className="mega-tag">{tp(`${p.key}.tag`)}</span>
          <span className="mega-status">{tp(`${p.key}.status`)}</span>
        </Link>
      ))}
    </>
  );

  return (
    <header className={`site-header${menuOpen ? ' menu-open' : ''}`}>
      <Link href="/" className="brand" aria-label="zerosoft.ai">
        <span className="brand-zero">0</span>
        <span className="brand-name">zerosoft.ai</span>
      </Link>

      <nav className="main-nav" aria-label="Principal">
        <LocaleSwitcher locale={locale} />

        <div
          ref={dropdownRef}
          className={`nav-dropdown${desktopOpen ? ' open' : ''}${mobileOpen ? ' mobile-open' : ''}`}
          onMouseEnter={openDesktop}
          onMouseLeave={closeDesktop}
          onKeyDown={onDropdownKeyDown}
          onBlur={onDropdownBlur}
        >
          {/* Desktop trigger: hover-activated */}
          <Link
            className="nav-link nav-dropdown-trigger-desktop"
            href="/products"
            aria-expanded={desktopOpen}
            aria-haspopup="true"
            aria-controls="mega-menu-desktop"
            onFocus={openDesktop}
          >
            <span className="nav-num">01</span>
            {labels.products}
          </Link>

          {/* Mobile trigger: click/touch-activated */}
          <button
            type="button"
            className="nav-link nav-dropdown-trigger-mobile"
            aria-expanded={mobileOpen}
            aria-haspopup="true"
            aria-controls="mega-menu-mobile"
            onClick={toggleMobile}
          >
            <span className="nav-num">01</span>
            {labels.products}
          </button>

          <div
            id="mega-menu-desktop"
            className="mega-menu mega-menu-desktop"
            onMouseEnter={openDesktop}
            onMouseLeave={closeDesktop}
          >
            <div className="mega-menu-inner">{megaItems}</div>
          </div>
          <div
            id="mega-menu-mobile"
            className="mega-menu mega-menu-mobile"
            onMouseEnter={openDesktop}
            onMouseLeave={closeDesktop}
          >
            <div className="mega-menu-inner">{megaItems}</div>
          </div>
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
            <Link className="nav-cta nav-cta-solid nav-cta-primary" href="/app">
              {labels.dashboard}
            </Link>
            <button
              className="nav-cta nav-cta-secondary"
              onClick={() => signOut({ callbackUrl: '/' })}
              title={user.email}
            >
              {labels.signOut}
            </button>
          </>
        ) : (
          <button
            className="nav-cta nav-cta-primary"
            onClick={() => signIn('google', { callbackUrl: `/${locale}/app` })}
          >
            {labels.signIn}
          </button>
        )}
        <button
          type="button"
          className="nav-burger"
          aria-label={labels.products}
          aria-expanded={menuOpen}
          aria-controls="mobile-panel"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span aria-hidden>{menuOpen ? '×' : '☰'}</span>
        </button>
      </nav>

      <div id="mobile-panel" className="mobile-panel" hidden={!menuOpen}>
        <p className="mobile-panel-label mono">{labels.products}</p>
        <div className="mobile-panel-products">{megaItems}</div>
        <div className="mobile-panel-links">
          <Link className="nav-link" href="/blog">
            <span className="nav-num">02</span>
            {labels.blog}
          </Link>
          <Link className="nav-link" href="/docs">
            <span className="nav-num">03</span>
            {labels.docs}
          </Link>
        </div>
        <div className="mobile-panel-foot">
          <LocaleSwitcher locale={locale} />
          {user && (
            <button className="nav-cta" onClick={() => signOut({ callbackUrl: '/' })}>
              {labels.signOut}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

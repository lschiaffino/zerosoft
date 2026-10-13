'use client';

import { useEffect, useRef, useState } from 'react';
import { signIn, signOut } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import LocaleSwitcher from './LocaleSwitcher';
import Icon from './site/Icon';
import { GITHUB_URL, PRODUCT_NAMES, SITE_PRODUCTS } from './site/catalog';

interface HeaderClientProps {
  locale: string;
  user: { name: string | null; email: string; image: string | null } | null;
  labels: {
    products: string;
    blog: string;
    docs: string;
    changelog: string;
    github: string;
    startFree: string;
    menu: string;
    signIn: string;
    dashboard: string;
    signOut: string;
  };
}

export default function HeaderClient({ locale, user, labels }: HeaderClientProps) {
  /** Mega menú de productos (desktop). */
  const [megaOpen, setMegaOpen] = useState(false);
  /** Panel hamburguesa (≤960px). */
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  const tp = useTranslations('common.products');
  const th = useTranslations('common.header');
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMenuOpen(false);
    setMegaOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Esc cierra cualquier menú abierto.
  useEffect(() => {
    if (!menuOpen && !megaOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (megaOpen) triggerRef.current?.focus();
      setMenuOpen(false);
      setMegaOpen(false);
    };
    const onDocClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.hd-dropdown')) setMegaOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onDocClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onDocClick);
    };
  }, [menuOpen, megaOpen]);

  const openMega = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setMegaOpen(true);
  };
  const closeMegaSoon = () => {
    closeTimer.current = setTimeout(() => setMegaOpen(false), 200);
  };
  // Espejo de mouseleave para teclado: cerrar cuando el foco sale del menú.
  const onDropdownBlur = (e: React.FocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setMegaOpen(false);
  };

  const productItems = (variant: 'mega' | 'panel') =>
    SITE_PRODUCTS.map((key) => (
      <Link key={key} href={`/products/${key}`} className={`hd-prod card-${key} hd-prod-${variant}`}>
        <span className="hd-prod-icon" aria-hidden="true">
          0
        </span>
        <span className="hd-prod-text">
          <span className="hd-prod-name">
            {PRODUCT_NAMES[key]}
            <span className="hd-prod-tag">{tp(`${key}.tag`)}</span>
          </span>
          <span className="hd-prod-desc">{th(`desc.${key}`)}</span>
        </span>
      </Link>
    ));

  return (
    <header className={`site-header${scrolled ? ' is-scrolled' : ''}${menuOpen ? ' menu-open' : ''}`}>
      <div className="hd-inner">
        <Link href="/" className="brand" aria-label="zerosoft.ai">
          <span className="brand-zero">0</span>
          <span className="brand-name">zerosoft.ai</span>
        </Link>

        <nav className="hd-nav" aria-label="Main">
          <div
            ref={dropdownRef}
            className={`hd-dropdown${megaOpen ? ' open' : ''}`}
            onMouseEnter={openMega}
            onMouseLeave={closeMegaSoon}
            onBlur={onDropdownBlur}
          >
            <button
              ref={triggerRef}
              type="button"
              className="hd-link hd-trigger"
              aria-expanded={megaOpen}
              aria-controls="hd-mega"
              onClick={() => setMegaOpen((v) => !v)}
            >
              {labels.products}
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </button>
            <div id="hd-mega" className="hd-mega" hidden={!megaOpen}>
              <div className="hd-mega-grid">{productItems('mega')}</div>
              <div className="hd-mega-side">
                <Link href="/products" className="hd-mega-cta">
                  <span className="hd-mega-cta-title">
                    {th('allProducts')} <Icon name="arrow" size={14} />
                  </span>
                  <span className="hd-mega-cta-desc">{th('allProductsDesc')}</span>
                </Link>
                <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hd-mega-cta hd-mega-cta-dark">
                  <span className="hd-mega-cta-title">
                    <Icon name="github" size={15} /> {th('selfHost')}
                  </span>
                  <span className="hd-mega-cta-desc mono">{th('selfHostDesc')}</span>
                </a>
              </div>
            </div>
          </div>
          <Link className="hd-link" href="/docs">
            {labels.docs}
          </Link>
          <Link className="hd-link" href="/blog">
            {labels.blog}
          </Link>
          <Link className="hd-link" href="/changelog">
            {labels.changelog}
          </Link>
          <a className="hd-link hd-gh" href={GITHUB_URL} target="_blank" rel="noreferrer">
            <Icon name="github" size={15} />
            {labels.github}
          </a>
        </nav>

        <div className="hd-right">
          <LocaleSwitcher locale={locale} />
          {user ? (
            <Link className="nav-cta nav-cta-solid" href="/app" title={user.email}>
              {labels.dashboard}
            </Link>
          ) : (
            <>
              <button
                type="button"
                className="hd-link hd-signin"
                onClick={() => signIn('google', { callbackUrl: `/${locale}/app` })}
              >
                {labels.signIn}
              </button>
              <Link className="nav-cta nav-cta-solid" href="/app">
                {labels.startFree}
              </Link>
            </>
          )}
          <button
            type="button"
            className="nav-burger"
            aria-label={labels.menu}
            aria-expanded={menuOpen}
            aria-controls="mobile-panel"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span aria-hidden>{menuOpen ? '×' : '☰'}</span>
          </button>
        </div>
      </div>

      <div id="mobile-panel" className="mobile-panel" hidden={!menuOpen}>
        <p className="mobile-panel-label mono">{labels.products}</p>
        <div className="mobile-panel-products">{productItems('panel')}</div>
        <div className="mobile-panel-links">
          <Link className="hd-link" href="/products">
            {th('allProducts')}
          </Link>
          <Link className="hd-link" href="/docs">
            {labels.docs}
          </Link>
          <Link className="hd-link" href="/blog">
            {labels.blog}
          </Link>
          <Link className="hd-link" href="/changelog">
            {labels.changelog}
          </Link>
          <a className="hd-link hd-gh" href={GITHUB_URL} target="_blank" rel="noreferrer">
            <Icon name="github" size={15} />
            {labels.github}
          </a>
        </div>
        <div className="mobile-panel-foot">
          <LocaleSwitcher locale={locale} />
          {user ? (
            <button className="nav-cta" onClick={() => signOut({ callbackUrl: '/' })}>
              {labels.signOut}
            </button>
          ) : (
            <button
              type="button"
              className="nav-cta"
              onClick={() => signIn('google', { callbackUrl: `/${locale}/app` })}
            >
              {labels.signIn}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { signIn, signOut } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import LocaleSwitcher from './LocaleSwitcher';
import Icon from './site/Icon';
import { AUDIENCE_PRODUCTS, GITHUB_URL, PRODUCT_NAMES, type Audience } from './site/catalog';
import Logo from './brand/Logo';
import ProductGlyph from './brand/ProductGlyph';

interface HeaderClientProps {
  locale: string;
  user: { name: string | null; email: string; image: string | null } | null;
  labels: {
    products: string;
    blog: string;
    docs: string;
    freeTools: string;
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
  const ts = useTranslations('common.home.suite');
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

  /** aria-current del link de la sección en la que estás. */
  const current = (href: string) => (pathname === href || pathname.startsWith(`${href}/`) ? ('page' as const) : undefined);

  /** Cuándo se abrió el menú por hover: un clic justo después no lo cierra. */
  const hoverOpenedAt = useRef(0);
  const openMega = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    if (!megaOpen) hoverOpenedAt.current = Date.now();
    setMegaOpen(true);
  };
  const toggleMega = () => {
    if (megaOpen && Date.now() - hoverOpenedAt.current < 600) return;
    hoverOpenedAt.current = 0;
    setMegaOpen((v) => !v);
  };
  const closeMegaSoon = () => {
    closeTimer.current = setTimeout(() => setMegaOpen(false), 200);
  };
  // Espejo de mouseleave para teclado: cerrar cuando el foco sale del menú.
  const onDropdownBlur = (e: React.FocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setMegaOpen(false);
  };

  const productItems = (variant: 'mega' | 'panel') =>
    (['teams', 'personal'] as const satisfies readonly Audience[]).map((a) => (
      <div key={a} className="hd-group">
        <p className="hd-group-title">{ts(`${a}Title`)}</p>
        {AUDIENCE_PRODUCTS[a].map((key) => (
          <Link key={key} href={`/products/${key}`} className={`hd-prod card-${key} hd-prod-${variant}`}>
            <ProductGlyph product={key} size={14} className="hd-prod-icon" />
            <span className="hd-prod-text">
              <span className="hd-prod-name">{PRODUCT_NAMES[key]}</span>
              <span className="hd-prod-desc">{th(`desc.${key}`)}</span>
            </span>
          </Link>
        ))}
      </div>
    ));

  return (
    <header className={`site-header${scrolled ? ' is-scrolled' : ''}${menuOpen ? ' menu-open' : ''}`}>
      <div className="hd-inner">
        <Link href="/" className="brand" aria-label="zerosoft.ai">
          <Logo tone="current" height={22} title="" />
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
              onClick={toggleMega}
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
                  <span className="hd-mega-cta-desc">{th('selfHostDesc')}</span>
                </a>
              </div>
            </div>
          </div>
          <Link className="hd-link" href="/tools" aria-current={current('/tools')}>
            {labels.freeTools}
          </Link>
          <Link className="hd-link" href="/docs" aria-current={current('/docs')}>
            {labels.docs}
          </Link>
          <Link className="hd-link" href="/blog" aria-current={current('/blog')}>
            {labels.blog}
          </Link>
          <Link className="hd-link" href="/changelog" aria-current={current('/changelog')}>
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
            <Link className="btn btn-chrome btn-sm" href="/app" title={user.email}>
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
              <Link className="btn btn-chrome btn-sm" href="/app">
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
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              {menuOpen ? (
                <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="2" />
              ) : (
                <path d="M2 5h16M2 10h16M2 15h16" stroke="currentColor" strokeWidth="2" />
              )}
            </svg>
          </button>
        </div>
      </div>

      <div id="mobile-panel" className="mobile-panel" hidden={!menuOpen}>
        <p className="mobile-panel-label">{labels.products}</p>
        <div className="mobile-panel-products">{productItems('panel')}</div>
        <div className="mobile-panel-links">
          <Link className="hd-link" href="/products" aria-current={current('/products')}>
            {th('allProducts')}
          </Link>
          <Link className="hd-link" href="/tools" aria-current={current('/tools')}>
            {labels.freeTools}
          </Link>
          <Link className="hd-link" href="/docs" aria-current={current('/docs')}>
            {labels.docs}
          </Link>
          <Link className="hd-link" href="/blog" aria-current={current('/blog')}>
            {labels.blog}
          </Link>
          <Link className="hd-link" href="/changelog" aria-current={current('/changelog')}>
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
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => signOut({ callbackUrl: '/' })}>
              {labels.signOut}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
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

import { getTranslations } from 'next-intl/server';
import { boardPath } from '@/lib/board-paths';
import { boardLoginHref, type BoardContext } from '@/lib/board-context';
import { authBaseUrl, siteUrl } from '@/lib/board-urls';
import type { BoardPerson } from '@/lib/board-session';
import Logo from '@/components/brand/Logo';

export type BoardSection = 'board' | 'roadmap' | 'changelog';

/**
 * Chrome mínimo del board: la banda negra con el wordmark, Ideas / Roadmap /
 * Changelog y login. Reemplaza al header de marketing (ver ChromeGate y board-public.css).
 */
export default async function BoardChrome({
  ctx,
  person,
  active,
  returnPath = '',
}: {
  ctx: BoardContext;
  person: BoardPerson | null;
  active: BoardSection | null;
  returnPath?: string;
}) {
  const t = await getTranslations({ locale: ctx.locale, namespace: 'feedbackBoard.nav' });
  const home = ctx.onSurface ? `${siteUrl()}/${ctx.locale}` : `/${ctx.locale}`;
  const links: Array<{ key: BoardSection; href: string }> = [
    { key: 'board', href: boardPath(ctx.locale, ctx.onSurface) },
    { key: 'roadmap', href: boardPath(ctx.locale, ctx.onSurface, '/roadmap') },
    { key: 'changelog', href: boardPath(ctx.locale, ctx.onSurface, '/changelog') },
  ];
  const appHref = ctx.onSurface ? `${authBaseUrl()}/${ctx.locale}/app` : `/${ctx.locale}/app`;
  return (
    <header className="bp-head">
      <div className="bp-wrap bp-head-inner">
        <a className="bp-logo" href={home} aria-label={t('home')}>
          <Logo tone="white" height={20} title="" className="bp-logo-word" />
          <Logo tone="white" variant="symbol" height={24} title="" className="bp-logo-symbol" />
          <span className="bp-logo-sub">{t('sub')}</span>
        </a>
        <nav className="bp-nav" aria-label={t('label')}>
          {links.map((l) => (
            <a key={l.key} href={l.href} aria-current={active === l.key ? 'page' : undefined}>
              {t(l.key)}
            </a>
          ))}
        </nav>
        <div className="bp-head-end">
          {person ? (
            <a className="bp-user" href={appHref} title={person.email}>
              {person.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={person.image} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className="bp-avatar" aria-hidden="true">
                  {(person.name ?? person.email).slice(0, 1).toUpperCase()}
                </span>
              )}
              <span>{person.name ?? person.email}</span>
            </a>
          ) : (
            <a className="btn btn-invert btn-sm" href={boardLoginHref(ctx, returnPath)}>
              {t('signIn')}
            </a>
          )}
        </div>
      </div>
    </header>
  );
}

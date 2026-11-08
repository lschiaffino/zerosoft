import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { isAdminEmail } from '@/lib/feedback';
import { lifecycleMode, listLifecycleSends } from '@/lib/lifecycle/scheduler';
import { renderLifecycleEmail, sampleRenderInput } from '@/lib/lifecycle/templates';
import { LIFECYCLE_TEMPLATES, type LifecycleLocale, type LifecycleTemplate } from '@/lib/lifecycle/types';
import { siteUrl } from '@/lib/board-urls';
import AdminNav, { LinkGroup } from '@/components/app/AdminNav';
import { sendLifecycleTest } from './actions';

export const dynamic = 'force-dynamic';

type Search = { template?: string; lang?: string; theme?: string; width?: string; sent?: string; error?: string };

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings' });
  return { title: `${t('admin.lifecycle.emails')} · ${t('title')}`, robots: { index: false } };
}

/**
 * Admin › Emails: vista previa de cada plantilla de ciclo de vida con datos
 * de ejemplo (idioma, claro/oscuro, 600 o 390 px), "mandármelo" para verla en
 * un cliente real y el log de envíos. Solo ADMIN_EMAILS; para el resto, 404.
 */
export default async function LifecycleAdminPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<Search> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const me = user.actingUser ?? user;
  if (!isAdminEmail(me.email)) notFound();
  const t = await getTranslations({ locale, namespace: 'settings.admin.lifecycle' });

  const template: LifecycleTemplate = (LIFECYCLE_TEMPLATES as readonly string[]).includes(sp.template ?? '') ? (sp.template as LifecycleTemplate) : 'welcome';
  const lang: LifecycleLocale = sp.lang === 'es' || sp.lang === 'pt' || sp.lang === 'en' ? sp.lang : (locale as LifecycleLocale);
  const theme = sp.theme === 'dark' ? 'dark' : 'light';
  const width = sp.width === '390' ? 390 : 600;
  const email = renderLifecycleEmail({ ...sampleRenderInput(template, lang, siteUrl()), theme });
  const mode = lifecycleMode();
  const sends = await listLifecycleSends(100);

  const href = (patch: Partial<Search>) => {
    const q = new URLSearchParams({ template, lang, theme, width: String(width), ...patch } as Record<string, string>);
    return `/app/settings/lifecycle?${q.toString()}`;
  };

  return (
    <div className="st-stack">
      <AdminNav locale={locale} current="lifecycle" description={t('emailsDesc')} />
      <p className={`st-lc-mode st-lc-mode-${mode}`} data-testid="lifecycle-mode">
        {t(`mode.${mode}`)}
      </p>
      <div className="st-lc">
        <nav className="st-lc-templates" aria-label={t('template')}>
          <ul>
            {LIFECYCLE_TEMPLATES.map((k) => (
              <li key={k}>
                <Link href={href({ template: k })} aria-current={k === template ? 'page' : undefined} prefetch={false} className="st-lc-template">
                  {k}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="st-lc-main">
          <div className="st-lc-bar">
            <LinkGroup label={t('language')} items={(['en', 'es', 'pt'] as const).map((l) => ({ key: l, href: href({ lang: l }), label: l.toUpperCase(), active: l === lang }))} />
            <LinkGroup
              label={t('theme')}
              items={(['light', 'dark'] as const).map((k) => ({ key: k, href: href({ theme: k }), label: t(k), active: k === theme }))}
            />
            <LinkGroup label={t('width')} items={(['600', '390'] as const).map((w) => ({ key: w, href: href({ width: w }), label: `${w}px`, active: Number(w) === width }))} />
          </div>
          <dl className="st-lc-meta">
            <div>
              <dt>{t('subject')}</dt>
              <dd>{email.subject}</dd>
            </div>
            <div>
              <dt>{t('preheader')}</dt>
              <dd>{email.preheader}</dd>
            </div>
          </dl>
          <div className={`st-lc-frame st-lc-frame-${theme}`}>
            <iframe title={t('previewTitle')} srcDoc={email.html} width={width} height={860} style={{ width: `min(${width}px, 100%)` }} sandbox="" data-testid="lifecycle-preview" />
          </div>
          <details className="st-lc-text">
            <summary>{t('textVersion')}</summary>
            <pre>{email.text}</pre>
          </details>
          <form action={sendLifecycleTest} className="st-lc-send">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="mailLocale" value={lang} />
            <input type="hidden" name="template" value={template} />
            <input type="hidden" name="theme" value={theme} />
            <input type="hidden" name="width" value={String(width)} />
            <button type="submit" className="btn btn-sm">
              {t('sendTest')}
            </button>
            <span className="ui-help" role="status">
              {sp.sent ? t('testSent', { email: me.email }) : sp.error ? t('testFailed', { error: sp.error.slice(0, 120) }) : t('sendTestHelp', { email: me.email })}
            </span>
          </form>
        </div>
      </div>
      <section className="st-lc-log" aria-labelledby="lc-log">
        <h2 id="lc-log" className="ui-section-title">
          {t('log')}
        </h2>
        {sends.length === 0 ? (
          <p className="st-empty-line">{t('logEmpty')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>{t('colWhen')}</th>
                  <th>{t('colTo')}</th>
                  <th>{t('colTemplate')}</th>
                  <th>{t('colLocale')}</th>
                  <th>{t('colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {sends.map((s) => (
                  <tr key={s.id}>
                    <td className="data">{(s.sentAt ?? s.createdAt).slice(0, 16).replace('T', ' ')}</td>
                    <td className="data st-lc-email">{s.email}</td>
                    <td className="data">{s.template}</td>
                    <td>{s.locale}</td>
                    <td title={s.error ?? undefined}>
                      {t(`status.${s.status as 'sent'}`)}
                      {s.attempts > 1 ? ` (${s.attempts})` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

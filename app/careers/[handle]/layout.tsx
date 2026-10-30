import type { CSSProperties, ReactNode } from 'react';
import { publishedCareers } from '@/lib/hiring/careers';
import { careersStrings } from '@/lib/hiring/careers-i18n';
import '@/styles/careers.css';

export const dynamic = 'force-dynamic';

/**
 * Página de empleos pública de Hiring (/careers/<handle>). Su propio <html>:
 * el idioma de la página, tema claro y la marca del workspace (nombre, logo y
 * color). Sin el chrome del sitio ni de la app.
 */
export default async function CareersLayout(props: { children: ReactNode; params: Promise<{ handle: string }> }) {
  const { handle } = await props.params;
  const c = await publishedCareers(handle);
  const locale = c?.locale ?? 'en';
  const t = careersStrings(locale);
  const style = { '--cr-accent': c?.color ?? '#111111' } as CSSProperties;
  return (
    <html lang={locale} data-theme="light">
      <body className="cr" style={style}>
        <a className="cr-skip" href="#cr-main">
          {t.skip}
        </a>
        {c && (
          <header className="cr-header">
            <a href={`/careers/${c.settings.handle}`} className="cr-brand">
              {c.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.logoUrl} alt="" className="cr-logo" />
              )}
              <span>{c.company}</span>
            </a>
          </header>
        )}
        <main id="cr-main" className="cr-main">
          {props.children}
        </main>
        <footer className="cr-footer">{t.poweredBy}</footer>
      </body>
    </html>
  );
}

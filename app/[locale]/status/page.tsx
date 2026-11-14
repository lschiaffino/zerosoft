import { headers } from 'next/headers';
import { unstable_cache } from 'next/cache';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { staticPageMetadata } from '@/lib/seo-pages';
import DefaultLogo from '@/components/brand/default/DefaultLogo';
import { siteUrl } from '@/lib/board-urls';
import { surfaceForHost } from '@/lib/host-rewrite';
import { PUBLIC_COMPONENTS, type ComponentStatus } from '@/lib/status/components';
import { publicStatus, type PublicIncident, type PublicStatus } from '@/lib/status/store';
import { dayBars, durationParts, overallStatus, uptimePct } from '@/lib/status/view';
import '@/styles/status.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return staticPageMetadata('status', locale);
}

/**
 * Lo que lee la página: 4 filas de status_public, las de status_components y
 * hasta 30 incidentes públicos. Cacheado 30 s entre instancias, así una visita
 * más no es una lectura más en Turso. STATUS_PAGE_NO_CACHE=1 (e2e) lo saltea.
 */
const cachedStatus = unstable_cache(() => publicStatus(), ['status-public-v1'], { revalidate: 30 });

async function loadStatus(): Promise<PublicStatus | null> {
  try {
    return process.env.STATUS_PAGE_NO_CACHE === '1' ? await publicStatus() : await cachedStatus();
  } catch {
    // Sin base no hay historial, pero la página igual responde (nunca un 500 en la página de estado).
    return null;
  }
}

/**
 * status.zerosoft.ai (y /status): el estado de cada servicio con 90 días de
 * barras, los incidentes en curso con su línea de tiempo y los anteriores.
 * Solo nombres públicos y textos por tipo: nada de hosts, instancias, errores
 * ni métricas (ver lib/status/store.ts publicStatus).
 */
export default async function StatusPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'pages.status' });
  const onSurface = surfaceForHost((await headers()).get('host')) === 'status';
  const site = onSurface ? `${siteUrl()}/${locale}` : `/${locale}`;

  const data = await loadStatus();
  const now = data ? Date.parse(data.generatedAt) : Date.now();
  const today = Math.floor(now / 86_400_000);
  // Si la base no contesta, la página no tiene historial, pero sí sabe algo: las apps no pueden leer sus datos.
  const components = PUBLIC_COMPONENTS.map(
    (id) => data?.components.find((c) => c.id === id) ?? { id, status: (id === 'apps' ? 'down' : 'unknown') as ComponentStatus, days: [] },
  );
  const overall = overallStatus(components.map((c) => c.status));

  const dayFmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  // Todo en UTC (la página se cachea igual para todos), con la zona a la vista.
  const timeFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC', timeZoneName: 'short' });
  const clockFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
  const pctFmt = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const duration = (ms: number) => {
    const d = durationParts(ms);
    return t(d.unit, { n: d.n });
  };
  const componentName = (id: string) => t(`components.${id}.name` as never);

  const incident = (i: PublicIncident) => {
    const start = Date.parse(i.startedAt);
    const end = i.resolvedAt ? Date.parse(i.resolvedAt) : now;
    return (
      <article className="st-incident" key={i.id} data-testid="status-incident" data-state={i.state} data-severity={i.severity}>
        <header className="st-incident-head">
          <h3 className="st-incident-title">
            <span className={`st-dot st-dot-${i.state === 'open' ? i.severity : 'up'}`} aria-hidden />
            {t(`incidentTitle.${i.severity}`, { component: componentName(i.publicId) })}
          </h3>
          <p className="st-incident-when">
            <time dateTime={i.startedAt}>{t('started', { time: timeFmt.format(start) })}</time>
            <span aria-hidden> · </span>
            {i.state === 'open' ? t('ongoing', { duration: duration(end - start) }) : t('resolvedAfter', { duration: duration(end - start) })}
          </p>
        </header>
        {i.notes.length > 0 && (
          <ol className="st-timeline" aria-label={t('timeline')}>
            {[...i.notes].reverse().map((n, idx) => (
              <li key={`${n.at}-${idx}`} className="st-note" data-kind={n.kind}>
                <time dateTime={n.at} className="st-note-time">
                  {timeFmt.format(Date.parse(n.at))}
                </time>
                <p className="st-note-text">
                  {n.kind === 'note' && n.text ? n.text : t(`kinds.${n.kind}` as never)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </article>
    );
  };

  return (
    <div className="st-root">
      <header className="st-head">
        <div className="st-wrap st-head-inner">
          <a className="st-home" href={site} aria-label={t('backToSite')}>
            <DefaultLogo height={20} title="" />
          </a>
          <span className="st-head-label">{t('title')}</span>
        </div>
      </header>

      <main className="st-wrap st-main">
        <h1 className="st-visually-hidden">{t('meta.title')}</h1>
        <section className={`st-banner st-banner-${overall}`} data-testid="status-banner" data-state={overall} aria-live="polite">
          <span className={`st-dot st-dot-${overall}`} aria-hidden />
          <p className="st-banner-text">{t(`banner.${overall}`)}</p>
        </section>
        <p className="st-updated">{t('updated', { time: clockFmt.format(now) })}</p>

        {data && data.open.length > 0 && (
          <section className="st-section" aria-labelledby="st-current" data-testid="status-current">
            <h2 id="st-current" className="st-h2">
              {t('current')}
            </h2>
            {data.open.map(incident)}
          </section>
        )}

        <section className="st-section" aria-labelledby="st-components">
          <h2 id="st-components" className="st-h2">
            {t('componentsTitle')}
          </h2>
          <ul className="st-components">
            {components.map((c) => {
              const bars = dayBars(c.days, today);
              const pct = uptimePct(bars);
              return (
                <li key={c.id} className="st-component" data-testid={`status-component-${c.id}`} data-state={c.status}>
                  <div className="st-component-top">
                    <div className="st-component-name">
                      <h3>{componentName(c.id)}</h3>
                      <p>{t(`components.${c.id}.desc` as never)}</p>
                    </div>
                    <span className={`st-state st-state-${c.status}`}>
                      <span className={`st-dot st-dot-${c.status}`} aria-hidden />
                      {t(`state.${c.status}`)}
                    </span>
                  </div>
                  <ol className="st-bars" aria-label={pct == null ? t('noUptime') : t('uptime', { pct: pctFmt.format(pct) })}>
                    {bars.map((b) => {
                      const date = dayFmt.format(b.day * 86_400_000);
                      const label =
                        b.tone === 'none'
                          ? t('dayNone', { date })
                          : b.tone === 'up'
                            ? t('dayOk', { date })
                            : t('dayIssues', { date, down: b.down, degraded: b.degraded });
                      return <li key={b.day} className={`st-bar st-bar-${b.tone}`} title={label} aria-label={label} />;
                    })}
                  </ol>
                  <div className="st-bars-legend">
                    <span>{t('daysAgo')}</span>
                    <span data-testid="status-uptime">{pct == null ? t('noUptime') : t('uptime', { pct: pctFmt.format(pct) })}</span>
                    <span>{t('today')}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="st-section" aria-labelledby="st-past" data-testid="status-past">
          <h2 id="st-past" className="st-h2">
            {t('past')}
          </h2>
          {data && data.past.length > 0 ? data.past.map(incident) : <p className="st-empty">{t('noPast')}</p>}
        </section>

        <p className="st-contact">{t('contact')}</p>
      </main>
    </div>
  );
}

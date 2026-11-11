import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { pageMetadata } from '@/lib/seo';
import { DESKTOP_PRIVACY as F, factsLocale, sourceUrl } from '@/lib/desktop-privacy';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = F.page[factsLocale(locale)];
  return pageMetadata({ locale, path: F.path, title: t.title, description: t.description });
}

function Source({ code, label }: { code: string[]; label: string }) {
  return (
    <span className="dp-src">
      {label}:{' '}
      {code.map((c, i) => (
        <span key={c}>
          {i > 0 && ', '}
          <a href={sourceUrl(c)} rel="noopener">
            {c.split('/').pop()}
          </a>
        </span>
      ))}
    </span>
  );
}

/**
 * /download/privacy: qué ve, guarda y manda la app de escritorio. Los hechos
 * salen de desktop/privacy-facts.json, la misma lista que muestra la app en
 * Ajustes › Privacidad y datos, y cada uno enlaza al archivo que lo hace.
 */
export default async function DesktopPrivacyPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const l = factsLocale(locale);
  const t = F.page[l];
  const host = (h: string) => (h === 'server' ? t.yourServer : h === 'update' ? `${t.yourServer}, GitHub Releases` : '');
  const plain = (items: typeof F.never) => (
    <ul className="dp-plain">
      {items.map((i) => (
        <li key={i.id}>
          {i[l]} <Source code={i.code} label={t.source} />
        </li>
      ))}
    </ul>
  );

  return (
    <main className="container">
      <header className="read-hero">
        <h1 className="read-title">{t.title}</h1>
        <p className="read-meta">{t.updated}</p>
        <p className="read-intro">{t.intro}</p>
      </header>

      <div className="read-body dl-body dp-body">
        <section className="dl-section" aria-labelledby="dp-permissions">
          <h2 id="dp-permissions" className="dl-h2">
            {t.permissions}
          </h2>
          <p className="status-desc dl-p">{t.permissionsLead}</p>
          <ul className="status-rows">
            {F.permissions.map((p) => (
              <li className="dl-row" key={p.id} data-fact={`permission-${p.id}`}>
                <span className="status-name">{p[l].name}</span>
                <span className="status-desc">
                  {p[l].why} <Source code={p.code} label={t.source} />
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="dl-section" aria-labelledby="dp-stores">
          <h2 id="dp-stores" className="dl-h2">
            {t.stores}
          </h2>
          <p className="status-desc dl-p">{t.storesLead}</p>
          <ul className="status-rows">
            {F.stores.map((s) => (
              <li className="dl-row" key={s.id} data-fact={`store-${s.id}`}>
                <span className="status-name">{s[l].name}</span>
                <span className="status-desc">
                  {s[l].what}
                  <span className="dp-line">
                    {t.kept}: {s[l].kept}
                  </span>
                  <span className="dp-line">{s.content ? t.content : t.metadata}</span>
                  {s.mac && (
                    <span className="dp-line">
                      {t.mac}: <code className="dp-code">{s.mac}</code>
                    </span>
                  )}
                  {s.win && (
                    <span className="dp-line">
                      {t.win}: <code className="dp-code">{s.win}</code>
                    </span>
                  )}
                  <Source code={s.code} label={t.source} />
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="dl-section" aria-labelledby="dp-network">
          <h2 id="dp-network" className="dl-h2">
            {t.network}
          </h2>
          <p className="status-desc dl-p">{t.networkLead}</p>
          <ul className="status-rows">
            {F.network.map((n) => (
              <li className="dl-row" key={n.id} data-fact={`network-${n.id}`}>
                <span className="status-name">{n[l].feature}</span>
                <span className="status-desc">
                  {n[l].sent}
                  <span className="dp-line">
                    {t.when}: {n[l].when}
                  </span>
                  {host(n.host) && (
                    <span className="dp-line">
                      {t.to}: {host(n.host)}
                      {n.endpoint && (
                        <>
                          {' '}
                          <code className="dp-code">{n.endpoint}</code>
                        </>
                      )}
                    </span>
                  )}
                  <Source code={n.code} label={t.source} />
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="dl-section" aria-labelledby="dp-indicators">
          <h2 id="dp-indicators" className="dl-h2">
            {t.indicators}
          </h2>
          {plain(F.indicators)}
        </section>

        <section className="dl-section" aria-labelledby="dp-never">
          <h2 id="dp-never" className="dl-h2">
            {t.never}
          </h2>
          {plain(F.never)}
        </section>

        <section className="dl-section" aria-labelledby="dp-controls">
          <h2 id="dp-controls" className="dl-h2">
            {t.controls}
          </h2>
          <ul className="status-rows">
            {F.controls.map((c) => (
              <li className="dl-row" key={c.id} data-fact={`control-${c.id}`}>
                <span className="status-name">{c[l].name}</span>
                <span className="status-desc">
                  {c[l].help} <Source code={c.code} label={t.source} />
                </span>
              </li>
            ))}
          </ul>
          <p className="status-desc dl-p">{t.inApp}</p>
        </section>

        <section className="dl-section" aria-labelledby="dp-events">
          <h2 id="dp-events" className="dl-h2">
            {t.events}
          </h2>
          <p className="status-desc dl-p">{t.eventsLead.replace('{n}', String(F.limits.activityEvents)).replace('{d}', String(F.limits.activityDays))}</p>
          {plain(F.events)}
        </section>

        <section className="dl-section" aria-labelledby="dp-security">
          <h2 id="dp-security" className="dl-h2">
            {t.security}
          </h2>
          {plain(F.security)}
        </section>

        <section className="dl-section" aria-labelledby="dp-open">
          <h2 id="dp-open" className="dl-h2">
            {t.limitsTitle}
          </h2>
          {plain(F.open)}
          <p className="status-desc dl-p">
            {t.report} <Link href="/security">/security</Link>
          </p>
        </section>
      </div>
    </main>
  );
}

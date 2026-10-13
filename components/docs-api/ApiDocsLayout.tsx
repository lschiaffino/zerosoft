'use client';

import { useTranslations } from 'next-intl';
import EndpointSection from './EndpointSection';
import { API_BASE_URL, API_ROOT_URL, API_SECTIONS, API_ENDPOINTS } from '@/lib/api-docs';

const AUTH_TOKEN = 'zs_live_9f3k...';

export default function ApiDocsLayout() {
  const t = useTranslations('pages.docs');

  const sections = API_SECTIONS.map((section) => ({
    ...section,
    endpoints: API_ENDPOINTS.filter((ep) => ep.sectionId === section.id),
  }));

  return (
    <main className="api-docs">
      <aside className="api-docs-sidebar">
        <nav className="api-docs-nav" aria-label={t('navLabel')}>
          {sections.map((section) => (
            <div key={section.id} className="api-docs-nav-section">
              <a href={`#section-${section.id}`} className="api-docs-nav-section-title">
                {t(section.titleKey)}
              </a>
              {section.endpoints.length > 0 && (
                <ul className="api-docs-nav-list">
                  {section.endpoints.map((ep) => (
                    <li key={ep.id}>
                      <a href={`#${ep.id}`} className="api-docs-nav-link">
                        <span className={`method-dot method-${ep.method.toLowerCase()}`} />
                        {t(ep.titleKey)}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </nav>
      </aside>

      <div className="api-docs-content">
        <section className="api-docs-hero">
          <p className="section-label">{t('label')}</p>
          <h1 className="doc-title">
            {t('title')}
            <br />
            <span className="dim">{t('titleDim')}</span>
          </h1>
          <p className="doc-intro">{t('intro')}</p>
          <p className="doc-intro">
            <a className="btn btn-ghost btn-small" href="/api/v1/openapi.json" download="zerosoft-openapi.json">
              {t('openapiCta')}
            </a>
          </p>
        </section>

        <div className="api-docs-body">
          <section className="api-docs-base">
            <p className="code-label">{t('baseLabel')}</p>
            <pre className="code-block">
              <code>{API_BASE_URL}</code>
            </pre>
          </section>

          {sections.map((section) => (
            <section key={section.id} id={`section-${section.id}`} className="api-docs-section">
              <h2>{t(section.titleKey)}</h2>
              {section.descKey && <p>{t(section.descKey)}</p>}
              {section.id === 'auth' && (
                <>
                  <pre className="code-block">
                    <code>Authorization: Bearer {AUTH_TOKEN}</code>
                  </pre>
                  <p>{t('authNote')}</p>
                </>
              )}
              {section.endpoints.map((endpoint) => (
                <EndpointSection
                  key={endpoint.id}
                  endpoint={endpoint}
                  baseUrl={API_BASE_URL}
                  rootUrl={API_ROOT_URL}
                  authToken={AUTH_TOKEN}
                />
              ))}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}

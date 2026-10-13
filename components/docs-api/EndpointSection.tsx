'use client';

import { useTranslations } from 'next-intl';
import CodeTabs from './CodeTabs';
import { endpointScope, type ApiEndpoint } from '@/lib/api-docs';

interface EndpointSectionProps {
  endpoint: ApiEndpoint;
  baseUrl: string;
  rootUrl: string;
  authToken: string;
}

export default function EndpointSection({ endpoint, baseUrl, rootUrl, authToken }: EndpointSectionProps) {
  const t = useTranslations('pages.docs');

  return (
    <section id={endpoint.id} className="endpoint-section">
      <div className="endpoint-section-head">
        <h3 className="endpoint-section-title">{t(endpoint.titleKey)}</h3>
        <div className="endpoint-line">
          <span className={`method method-${endpoint.method.toLowerCase()}`}>{endpoint.method}</span>
          <code className="endpoint-path">{endpoint.path}</code>
        </div>
      </div>

      <p className="endpoint-desc">{t(endpoint.descKey)}</p>
      {endpointScope(endpoint) && (
        <p className="endpoint-scope">
          <span className="code-label">{t('scopeLabel')}</span> <code>{endpointScope(endpoint)}</code>
        </p>
      )}

      {endpoint.params && endpoint.params.length > 0 && (
        <div className="params-table-wrap">
          <table className="params-table">
            <thead>
              <tr>
                <th>{t('paramName')}</th>
                <th>{t('paramType')}</th>
                <th>{t('paramRequired')}</th>
                <th>{t('paramDescription')}</th>
              </tr>
            </thead>
            <tbody>
              {endpoint.params.map((param) => (
                <tr key={param.name}>
                  <td>
                    <code>{param.name}</code>
                  </td>
                  <td>{param.type}</td>
                  <td>{param.required ? t('requiredYes') : t('requiredNo')}</td>
                  <td>{t(param.descriptionKey)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CodeTabs
        method={endpoint.method}
        path={endpoint.path}
        baseUrl={baseUrl}
        rootUrl={rootUrl}
        request={endpoint.request}
        authToken={authToken}
      />

      {endpoint.request !== undefined && (
        <div className="json-block-wrap">
          <p className="code-label">{t('request')}</p>
          <pre className="code-block">
            <code>{JSON.stringify(endpoint.request, null, 2)}</code>
          </pre>
        </div>
      )}

      {endpoint.response !== undefined && (
        <div className="json-block-wrap">
          <p className="code-label">
            {t('response')} · {endpoint.responseStatus ?? 200}
          </p>
          <pre className="code-block">
            <code>{JSON.stringify(endpoint.response, null, 2)}</code>
          </pre>
        </div>
      )}
    </section>
  );
}

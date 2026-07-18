import { getTranslations, setRequestLocale } from 'next-intl/server';
import '@/styles/pages.css';

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }) {
  const t = await getTranslations({ locale, namespace: 'pages.docs' });
  return { title: t('meta.title'), description: t('meta.description') };
}

function Code({ lines }: { lines: string[] }) {
  return (
    <pre>
      <code>{lines.join('\n')}</code>
    </pre>
  );
}

function CodeNote({ text, placeholder, code }: { text: string; placeholder: string; code: string }) {
  const [before, after = ''] = text.split(placeholder);
  return (
    <>
      {before}
      <code>{code}</code>
      {after}
    </>
  );
}

const CRM_ROWS = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15'] as const;

export default async function DocsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'pages.docs' });
  const raw = (key: string) => t.raw(key) as string[];
  const errors = ['e1', 'e2', 'e3', 'e4', 'e5'] as const;
  return (
    <main>
      <section className="doc-hero container">
        <p className="section-label">{t('label')}</p>
        <h1 className="doc-title">
          {t('title')}
          <br />
          <span className="dim">{t('titleDim')}</span>
        </h1>
        <p className="doc-intro">{t('intro')}</p>
      </section>

      <div className="doc-body container">
        <div className="prose">
          <p className="code-label">{t('baseLabel')}</p>
          <Code lines={raw('codeBase')} />

          <h2>{t('authTitle')}</h2>
          <p>{t('authP1')}</p>
          <Code lines={raw('codeAuth')} />
          <p>{t('authP2')}</p>
          <p>{t('authP3')}</p>

          <h2>{t('endpointsTitle')}</h2>

          <h3>{t('createTitle')}</h3>
          <p>{t('createDesc')}</p>
          <div className="endpoint-head">
            <span className="method">POST</span>
            <span className="endpoint-path">/api/v1/links</span>
          </div>
          <p className="code-label">{t('request')}</p>
          <Code lines={raw('codeCreateReq')} />
          <p className="code-label">{t('response')} · 201</p>
          <Code lines={raw('codeCreateRes')} />

          <h3>{t('listTitle')}</h3>
          <p>{t('listDesc')}</p>
          <div className="endpoint-head">
            <span className="method">GET</span>
            <span className="endpoint-path">/api/v1/links?page=1&pageSize=10</span>
          </div>
          <p className="code-label">{t('request')}</p>
          <Code lines={raw('codeListReq')} />
          <p className="code-label">{t('response')} · 200</p>
          <Code lines={raw('codeListRes')} />

          <h3>{t('statsTitle')}</h3>
          <p>{t('statsDesc')}</p>
          <div className="endpoint-head">
            <span className="method">GET</span>
            <span className="endpoint-path">/api/v1/links/{'{id}'}/stats</span>
          </div>
          <p className="code-label">{t('request')}</p>
          <Code lines={raw('codeStatsReq')} />
          <p className="code-label">{t('response')} · 200</p>
          <Code lines={raw('codeStatsRes')} />

          <h2>{t('crmTitle')}</h2>
          <p>{t('crmP')}</p>
          <h3>{t('crmExample')}</h3>
          <div className="endpoint-head">
            <span className="method">POST</span>
            <span className="endpoint-path">/api/v1/crm/contacts</span>
          </div>
          <p className="code-label">{t('request')}</p>
          <Code lines={raw('codeCrmReq')} />
          <p className="code-label">{t('response')} · 201</p>
          <Code lines={raw('codeCrmRes')} />
          <h3>{t('crmEndpoints')}</h3>
          <table className="table">
            <thead>
              <tr>
                <th>{t('crmThMethod')}</th>
                <th>{t('crmThPath')}</th>
                <th>{t('crmThWhat')}</th>
              </tr>
            </thead>
            <tbody>
              {CRM_ROWS.map((r) => (
                <tr key={r}>
                  <td className="mono">{t(`${r}m`)}</td>
                  <td>
                    <code>{t(`${r}p`)}</code>
                  </td>
                  <td>{t(`${r}d`)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>{t('errorsTitle')}</h2>
          <p>{t('errorsP')}</p>
          <Code lines={raw('codeError')} />
          <table className="table">
            <thead>
              <tr>
                <th>{t('thCode')}</th>
                <th>{t('thHttp')}</th>
                <th>{t('thMeaning')}</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((e) => (
                <tr key={e}>
                  <td>
                    <code>{t(`${e}code`)}</code>
                  </td>
                  <td className="mono">{t(`${e}http`)}</td>
                  <td>{t(`${e}desc`)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>{t('notesTitle')}</h2>
          <ul>
            <li>
              <CodeNote text={t.raw('n1') as string} placeholder="{pattern}" code="[A-Za-z0-9_-]{2,32}" />
            </li>
            <li>
              <CodeNote text={t.raw('n2') as string} placeholder="{example}" code="https://<your-domain>/<slug>" />
            </li>
            <li>{t('n3')}</li>
          </ul>

          <h2>{t('soonTitle')}</h2>
          <p>{t('soonP')}</p>
        </div>
      </div>
    </main>
  );
}

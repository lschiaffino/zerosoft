import { getTranslations, setRequestLocale } from 'next-intl/server';
import '@/styles/pages.css';

interface LegalSection {
  h: string;
  p?: string[];
  ul?: string[];
}

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }) {
  const t = await getTranslations({ locale, namespace: 'legal.terms' });
  return { title: t('meta.title'), description: t('meta.description') };
}

export default async function TermsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'legal.terms' });
  const sections = Object.entries(t.raw('sections') as Record<string, LegalSection>);

  return (
    <main>
      <section className="doc-hero container">
        <p className="section-label">{t('label')}</p>
        <h1 className="doc-title">{t('title')}</h1>
        <p className="doc-updated">{t('updated')}</p>
        <p className="doc-intro">{t('intro')}</p>
      </section>

      <div className="doc-body container">
        <nav className="panel legal-toc" aria-label={t('tocTitle')}>
          <ol>
            {sections.map(([id, s]) => (
              <li key={id}>
                <a href={`#${id}`}>{s.h}</a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="prose">
          {sections.map(([id, s]) => (
            <div key={id} id={id}>
              <h2>{s.h}</h2>
              {(s.p ?? []).map((para, i) => (
                <p key={i}>{para}</p>
              ))}
              {s.ul && (
                <ul>
                  {s.ul.map((li, i) => (
                    <li key={i}>{li}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

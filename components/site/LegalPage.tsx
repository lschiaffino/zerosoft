import { getTranslations } from 'next-intl/server';

interface LegalSection {
  h: string;
  p?: string[];
  ul?: string[];
}

export type LegalDoc = 'terms' | 'privacy' | 'security';

export async function legalMetadata(locale: string, doc: LegalDoc) {
  const t = await getTranslations({ locale, namespace: `legal.${doc}` });
  return { title: t('meta.title'), description: t('meta.description') };
}

/**
 * Términos, privacidad y seguridad: el mismo documento con otro texto. Título
 * en señalética, índice en una placa esmaltada y una columna de lectura.
 */
export default async function LegalPage({ locale, doc }: { locale: string; doc: LegalDoc }) {
  const t = await getTranslations({ locale, namespace: `legal.${doc}` });
  const sections = Object.entries(t.raw('sections') as Record<string, LegalSection>);

  return (
    <main className="container">
      <header className="read-hero">
        <h1 className="read-title">{t('title')}</h1>
        <p className="read-meta">{t('updated')}</p>
        <p className="read-intro">{t('intro')}</p>
      </header>

      <div className="read-body">
        <nav className="legal-toc" aria-label={t('tocTitle')}>
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

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { staticPageMetadata } from '@/lib/seo-pages';
import { staticPageText } from '@/lib/seo-pages';
import { absoluteUrl, breadcrumbLd, graphLd, jsonLdString, localePath } from '@/lib/seo';
import ApiDocsLayout from '@/components/docs-api/ApiDocsLayout';
import '@/styles/api-docs.css';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return staticPageMetadata('docs', locale);
}

export default async function DocsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const {
    locale
  } = params;

  setRequestLocale(locale);
  const { title, description } = await staticPageText('docs', locale);
  const ld = graphLd([
    breadcrumbLd(locale, [
      { name: 'zerosoft', path: '' },
      { name: title, path: '/docs' },
    ]),
    { '@type': 'TechArticle', headline: title, description, url: absoluteUrl(localePath(locale, '/docs')), inLanguage: locale },
  ]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(ld) }} />
      <ApiDocsLayout />
    </>
  );
}

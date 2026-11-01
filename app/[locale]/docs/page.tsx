import { getTranslations, setRequestLocale } from 'next-intl/server';
import { staticPageMetadata } from '@/lib/seo-pages';
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
  return <ApiDocsLayout />;
}

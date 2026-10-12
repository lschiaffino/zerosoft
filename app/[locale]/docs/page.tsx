import { getTranslations, setRequestLocale } from 'next-intl/server';
import ApiDocsLayout from '@/components/docs-api/ApiDocsLayout';
import '@/styles/api-docs.css';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const {
    locale
  } = params;

  const t = await getTranslations({ locale, namespace: 'pages.docs' });
  return { title: t('meta.title'), description: t('meta.description') };
}

export default async function DocsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const {
    locale
  } = params;

  setRequestLocale(locale);
  return <ApiDocsLayout />;
}

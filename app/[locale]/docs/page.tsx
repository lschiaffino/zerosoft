import { getTranslations, setRequestLocale } from 'next-intl/server';
import ApiDocsLayout from '@/components/docs-api/ApiDocsLayout';
import '@/styles/api-docs.css';

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }) {
  const t = await getTranslations({ locale, namespace: 'pages.docs' });
  return { title: t('meta.title'), description: t('meta.description') };
}

export default async function DocsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <ApiDocsLayout />;
}

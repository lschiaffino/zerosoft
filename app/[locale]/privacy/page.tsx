import { setRequestLocale } from 'next-intl/server';
import LegalPage, { legalMetadata } from '@/components/site/LegalPage';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return legalMetadata(locale, 'privacy');
}

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  return <LegalPage locale={locale} doc="privacy" />;
}

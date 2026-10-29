import InsightPage, { generateMetadata } from '../[id]/page';

export const dynamic = 'force-dynamic';
export { generateMetadata };

/** Insight nuevo (/insights/new?kind=funnel): el mismo editor, sin guardar todavía. */
export default async function NewInsightPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ kind?: string }> }) {
  const { locale } = await props.params;
  return InsightPage({ params: Promise.resolve({ locale, id: 'new' }), searchParams: props.searchParams });
}

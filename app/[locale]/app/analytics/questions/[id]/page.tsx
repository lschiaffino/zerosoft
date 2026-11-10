import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import QuestionEditor from '@/components/bi/QuestionEditor';
import { biPage } from '@/lib/bi/page';
import { getQuestion, listDatabases } from '@/lib/bi/store';
import { sourceSchema } from '@/lib/bi/run';
import { biAiAvailable } from '@/lib/bi/ai';

export async function generateMetadata(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const { viewer } = await biPage(locale);
  const q = await getQuestion(viewer, id);
  return { title: q ? `${q.name} · Analytics` : 'Analytics' };
}

export default async function Page(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  setRequestLocale(locale);
  const { viewer, isAdmin } = await biPage(locale);
  const question = await getQuestion(viewer, id);
  if (!question) notFound();
  const [databases, schema, ai] = await Promise.all([listDatabases(viewer), sourceSchema(viewer, question.source).catch(() => []), biAiAvailable()]);
  return <QuestionEditor key={question.id} question={question} databases={databases} initialSchema={schema} isAdmin={isAdmin} aiAvailable={ai} initialMode="builder" initialAsk={null} collectionId={question.collectionId} />;
}

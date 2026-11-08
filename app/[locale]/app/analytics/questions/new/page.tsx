import { getTranslations, setRequestLocale } from 'next-intl/server';
import QuestionEditor from '@/components/bi/QuestionEditor';
import { biPage } from '@/lib/bi/page';
import { listDatabases } from '@/lib/bi/store';
import { zsSchema } from '@/lib/bi/zs-tables';
import { biAiAvailable } from '@/lib/bi/ai';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'bi' });
  return { title: `${t('home.newQuestion')} · Analytics` };
}

/** Pregunta nueva: constructor (o SQL con ?mode=sql, o lo que se preguntó con ?ask=). */
export default async function Page(props: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const { viewer, isAdmin } = await biPage(locale);
  const [databases, schema, ai] = await Promise.all([listDatabases(viewer), zsSchema(viewer), biAiAvailable()]);
  return (
    <QuestionEditor
      question={null}
      databases={databases}
      initialSchema={schema}
      isAdmin={isAdmin}
      aiAvailable={ai}
      initialMode={sp.mode === 'sql' ? 'sql' : 'builder'}
      initialAsk={sp.ask?.slice(0, 1000) || null}
      collectionId={sp.collection || null}
    />
  );
}

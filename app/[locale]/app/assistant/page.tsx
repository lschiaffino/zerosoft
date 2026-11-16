import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { pathWithQuery } from '@/lib/return-path';
import AssistantPage from '@/components/assistant/AssistantPage';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'assistant' });
  return { title: t('page.title'), description: t('page.description') };
}

/**
 * Chat a página completa con el historial de charlas (?c=<id> abre una, ?q= pregunta).
 * Como Inbox y Lines, ocupa el alto de la ventana: la ventana no scrollea, el
 * historial scrollea solo y la charla es el scroll principal (styles/assistant.css).
 */
export default async function AssistantRoute(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ c?: string; q?: string }>;
}) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  await requireUser(locale, pathWithQuery(`/${locale}/app/assistant`, sp));
  const id = typeof sp.c === 'string' && /^[\w-]{1,64}$/.test(sp.c) ? sp.c : null;
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, 4000) || null : null;
  return <AssistantPage initialId={id} initialPrompt={q} />;
}

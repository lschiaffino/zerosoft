import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { getDesign, markOpened } from '@/lib/design';
import { designActorOf } from '@/lib/design-http';
import DesignEditor from '@/components/design/DesignEditor';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ comment?: string }> };

const load = cache(async (locale: string, id: string) => {
  const user = await requireUser(locale);
  const actor = designActorOf(user);
  const design = await getDesign(actor, id);
  return design ? { design, actor } : null;
});

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, id } = await props.params;
  const got = await load(locale, id);
  return { title: `${got?.design.name ?? 'Design'} · Design` };
}

/** El editor de un diseño (como Canva). */
export default async function DesignEditorPage(props: Props) {
  const { locale, id } = await props.params;
  const { comment } = await props.searchParams;
  setRequestLocale(locale);
  const got = await load(locale, id);
  if (!got) notFound();
  await markOpened(got.actor, id).catch(() => undefined);
  return <DesignEditor key={got.design.id} initial={got.design} canEditBrand={got.actor.admin} commentId={typeof comment === 'string' ? comment : null} />;
}

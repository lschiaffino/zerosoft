import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { libraryData } from '@/lib/rec-app';
import RecLibrary from '@/components/rec/RecLibrary';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; spaceId: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, spaceId } = await props.params;
  const data = await libraryData(locale, { kind: 'space', spaceId });
  return { title: `${data?.space?.name ?? 'Rec'} · Rec` };
}

/** Rec: un espacio con sus miembros. Quien no es miembro recibe un 404. */
export default async function RecSpacePage(props: Props) {
  const { locale, spaceId } = await props.params;
  setRequestLocale(locale);
  const data = await libraryData(locale, { kind: 'space', spaceId });
  if (!data?.space) notFound();
  const s = data.space;
  return (
    <RecLibrary
      key={s.id}
      scope={{ kind: 'space', space: { id: s.id, name: s.name, canManage: s.canManage, members: s.members } }}
      initialVideos={data.videos}
      initialFolders={data.folders}
      initialSpaces={data.spaces}
      baseUrl={data.baseUrl}
    />
  );
}

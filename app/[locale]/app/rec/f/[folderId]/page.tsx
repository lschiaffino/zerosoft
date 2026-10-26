import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { libraryData } from '@/lib/rec-app';
import RecLibrary from '@/components/rec/RecLibrary';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; folderId: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, folderId } = await props.params;
  const data = await libraryData(locale, { kind: 'folder', folderId });
  return { title: `${data?.folder?.name ?? 'Rec'} · Rec` };
}

/** Rec: una carpeta (personal o del workspace). */
export default async function RecFolderPage(props: Props) {
  const { locale, folderId } = await props.params;
  setRequestLocale(locale);
  const data = await libraryData(locale, { kind: 'folder', folderId });
  if (!data?.folder) notFound();
  const f = data.folder;
  return (
    <RecLibrary
      key={f.id}
      scope={{ kind: 'folder', folder: { id: f.id, name: f.name, space: f.space, created_by: f.created_by } }}
      initialVideos={data.videos}
      initialFolders={data.folders}
      baseUrl={data.baseUrl}
    />
  );
}

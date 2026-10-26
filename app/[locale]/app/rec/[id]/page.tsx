import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { actorOf } from '@/lib/rec-http';
import { getVideoRow, listFolders, toDto } from '@/lib/rec';
import { recBaseUrl } from '@/lib/rec-page';
import { blobUploadEnabled } from '@/lib/rec-upload';
import { BLOB_PART_BYTES, LOCAL_PART_BYTES } from '@/lib/rec-schema';
import RecDetail from '@/components/rec/RecDetail';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const v = await getVideoRow(actorOf(user), id);
  return { title: `${v?.title ?? 'Video'} · Rec` };
}

/** Un video de Rec: reproductor, compartir, comentarios, transcripción, analítica y edición. */
export default async function RecVideoPage(props: Props) {
  const { locale, id } = await props.params;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const actor = actorOf(user);
  const v = await getVideoRow(actor, id);
  if (!v || v.status !== 'ready') notFound();
  const folders = await listFolders(actor);
  return (
    <RecDetail
      key={v.id}
      initial={toDto(v, actor)}
      folders={folders.map((f) => ({ id: f.id, name: f.name, space: f.space, created_by: f.created_by }))}
      baseUrl={recBaseUrl()}
      uploadMode={blobUploadEnabled() ? 'blob' : 'local'}
      partBytes={blobUploadEnabled() ? BLOB_PART_BYTES : LOCAL_PART_BYTES}
    />
  );
}

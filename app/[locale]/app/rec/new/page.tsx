import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { actorOf } from '@/lib/rec-http';
import { getFolder } from '@/lib/rec';
import { getSpace } from '@/lib/rec-admin';
import { recBaseUrl } from '@/lib/rec-page';
import { transcriptionConfigured } from '@/lib/rec-ai';
import RecRecordPage from '@/components/rec/RecRecordPage';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'rec.record' });
  return { title: `${t('title')} · Rec` };
}

/** Grabar: ?folder=<id> o ?space=workspace dicen dónde queda el video. */
export default async function RecNewPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ folder?: string; space?: string; spaceId?: string; replyTo?: string; parent?: string; at?: string }> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const folder = sp.folder ? await getFolder(actorOf(user), sp.folder) : null;
  const inSpace = !folder && sp.spaceId ? await getSpace(actorOf(user), sp.spaceId) : null;
  return (
    <RecRecordPage
      folderId={folder?.id ?? null}
      space={folder?.space ?? (inSpace || sp.space === 'workspace' ? 'workspace' : 'personal')}
      spaceId={inSpace?.id ?? null}
      baseUrl={recBaseUrl()}
      transcriptionOn={transcriptionConfigured()}
      replyTo={
        sp.replyTo && /^[\w-]{1,64}$/.test(sp.replyTo)
          ? {
              shareId: sp.replyTo,
              parentId: sp.parent && /^[\w-]{1,64}$/.test(sp.parent) ? sp.parent : null,
              atSec: sp.at && /^\d{1,5}(\.\d)?$/.test(sp.at) ? Number(sp.at) : null,
            }
          : null
      }
    />
  );
}

import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { getSessionDetail, listCustomTemplates, voiceOwner } from '@/lib/voice';
import { contactLabel } from '@/lib/voice-integrations';
import { listFolders } from '@/lib/voice-library';
import { getShare } from '@/lib/voice-share';
import { transcribeProvider, transcriptionConfigured } from '@/lib/voice-transcribe';
import { voiceAiAvailable } from '@/lib/voice-ai';
import { voiceBlobAccess, voiceBlobEnabled, voiceBlobPrefix, voiceImportMaxBytes } from '@/lib/voice-blob';
import MeetingView from '@/components/voice/MeetingView';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'voice' });
  return { title: t('meta.meeting') };
}

export default async function VoiceMeetingPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  setRequestLocale(locale);
  const user = await requireUser(locale, `/${locale}/app/voice/meetings/${id}`);
  const owner = voiceOwner(user);
  const detail = await getSessionDetail(owner, id);
  if (!detail || detail.kind !== 'meeting') notFound();
  const [templates, contact, ai, folders, share] = await Promise.all([
    listCustomTemplates(owner),
    contactLabel(owner.workspaceId, detail.contactId),
    voiceAiAvailable(),
    listFolders(owner),
    getShare(owner, id),
  ]);
  return (
    <MeetingView
      key={detail.id}
      initial={{ ...detail, contact, share }}
      templates={templates}
      folders={folders}
      transcription={transcriptionConfigured()}
      ai={ai}
      blobPrefix={voiceBlobEnabled() ? voiceBlobPrefix(owner.personId) : null}
      blobAccess={voiceBlobAccess()}
      importMaxBytes={voiceImportMaxBytes(transcribeProvider(), voiceBlobEnabled())}
    />
  );
}

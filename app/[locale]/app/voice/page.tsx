import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listSessions, voiceOwner } from '@/lib/voice';
import { listLinkableBookings } from '@/lib/voice-integrations';
import { transcribeProvider, transcriptionConfigured } from '@/lib/voice-transcribe';
import { voiceAiAvailable } from '@/lib/voice-ai';
import { voiceBlobAccess, voiceBlobEnabled, voiceBlobPrefix, voiceImportMaxBytes } from '@/lib/voice-blob';
import MeetingsHome from '@/components/voice/MeetingsHome';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'voice' });
  return { title: t('meta.title') };
}

export default async function VoicePage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const user = await requireUser(locale, `/${locale}/app/voice`);
  const owner = voiceOwner(user);
  const [sessions, bookings, ai] = await Promise.all([
    listSessions(owner, { kind: 'meeting' }),
    listLinkableBookings(owner).catch(() => []),
    voiceAiAvailable(),
  ]);
  return (
    <MeetingsHome
      initialSessions={sessions}
      bookings={bookings}
      transcription={transcriptionConfigured()}
      ai={ai}
      blobPrefix={voiceBlobEnabled() ? voiceBlobPrefix(owner.personId) : null}
      blobAccess={voiceBlobAccess()}
      importMaxBytes={voiceImportMaxBytes(transcribeProvider(), voiceBlobEnabled())}
    />
  );
}

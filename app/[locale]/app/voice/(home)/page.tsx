import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listSessions, voiceOwner } from '@/lib/voice';
import { listCalendarEvents } from '@/lib/voice-calendar';
import { listFolders } from '@/lib/voice-library';
import { listSharedWithMe } from '@/lib/voice-share';
import { googleCalendarConnected } from '@/lib/google-calendar';
import { outlookCalendarConnected } from '@/lib/outlook-calendar';
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

export default async function VoicePage(props: { params: Promise<{ locale: string }>; searchParams?: Promise<{ folder?: string; view?: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const sp = (await props.searchParams) ?? {};
  const user = await requireUser(locale, `/${locale}/app/voice`);
  const owner = voiceOwner(user);
  const folders = await listFolders(owner);
  const view = sp.view === 'shared' ? 'shared' : 'all';
  // Una carpeta que no es de la persona (o se borró) no filtra: se ven todas.
  const folder = view === 'all' && sp.folder && folders.some((f) => f.id === sp.folder) ? sp.folder : null;
  const [sessions, shared, events, ai, google, outlook] = await Promise.all([
    view === 'all' ? listSessions(owner, { kind: 'meeting', folderId: folder }) : Promise.resolve([]),
    view === 'shared' ? listSharedWithMe(owner) : Promise.resolve([]),
    listCalendarEvents(owner).catch(() => []),
    voiceAiAvailable(),
    googleCalendarConnected(owner.personId).catch(() => false),
    outlookCalendarConnected(owner.personId).catch(() => false),
  ]);
  return (
    <MeetingsHome
      initialSessions={sessions}
      events={events}
      calendarsConnected={google || outlook}
      folders={folders}
      initialFolder={folder}
      initialView={view}
      initialShared={shared}
      transcription={transcriptionConfigured()}
      ai={ai}
      blobPrefix={voiceBlobEnabled() ? voiceBlobPrefix(owner.personId) : null}
      blobAccess={voiceBlobAccess()}
      importMaxBytes={voiceImportMaxBytes(transcribeProvider(), voiceBlobEnabled())}
    />
  );
}
